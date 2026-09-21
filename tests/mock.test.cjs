const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../dist-electron/electron/store");
const { Service } = require("../dist-electron/electron/service");
const {
  MockInterview,
  parseMockAnalysis,
  aggregateReport,
  mockMarkdown,
  validateSetup,
} = require("../dist-electron/electron/mock-interview");
const { MockVoice } = require("../dist-electron/electron/mock-voice");
const {
  MOCK_DIMENSIONS,
  MOCK_RUBRICS,
  mockBand,
  dimensionScore,
} = require("../dist-electron/shared/mock");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f) {
  for (let i = 0; i < 200 && !f(); i++) await sleep(10);
  assert(f(), "condition timed out");
}
const config = {
  resume: "我负责订单服务。延迟从100ms降至50ms。",
  jd: "后端工程师，负责高并发系统",
  role: "后端工程师",
  level: "P6",
  minutes: 30,
  mode: "text",
};
const cipher = {
  available: () => true,
  encrypt: (v) => Buffer.from(v).toString("base64"),
  decrypt: (v) => Buffer.from(v, "base64").toString(),
};
function analysis(answer = "我使用缓存优化订单查询") {
  return {
    dimensions: MOCK_DIMENSIONS.map((d, i) => ({
      id: d.id,
      status: i < 2 ? "scored" : "insufficient",
      score: i < 2 ? 80 : null,
      evidence: i < 2 ? answer : "",
      reason: "评价理由",
    })),
    improvement: "补充收益统计口径",
    reference: [
      "背景与业务目标(S)",
      "任务与难点(T)",
      "个人行动及技术取舍(A)",
      "业务结果与技术指标(R)",
    ].map((heading) => ({
      heading,
      text: "我负责订单服务，具体指标口径待补充。",
    })),
    metrics: [
      {
        name: "延迟",
        baseline: "100ms",
        result: "50ms",
        period: "待补充",
        scope: "待补充",
        evidence: "延迟从100ms降至50ms。",
      },
    ],
    missing: ["统计时间范围"],
  };
}
function fixture(t, call) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-mock-test-"));
  const file = path.join(dir, "state.json"),
    store = new Store(file, cipher);
  store.saveModel({
    id: "test",
    name: "test",
    provider: "custom",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:1",
    model: "fake",
    apiKey: "SECRET",
  });
  store.saveVoice("workspace", "ASR_SECRET");
  const service = new Service(store, () => {});
  let count = 0;
  const mock = new MockInterview(
    service,
    call ||
      (async (_model, system, user) => {
        if (system.includes("判断口述")) return '{"complete":true}';
        if (system.includes("分析当前题"))
          return JSON.stringify(analysis(JSON.parse(user).actualResponse));
        if (system.includes("总结整场"))
          return JSON.stringify({
            summary: "整体有基础",
            strengths: ["思路清晰"],
            weaknesses: ["缺少数据"],
            nextSteps: ["补全口径"],
          });
        return JSON.stringify({
          question: "问题" + ++count,
          category: "experience",
          followup: false,
        });
      }),
  );
  const id = mock.create(config);
  t.after(() => {
    mock.dispose();
    service.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, service, mock, id, s: mock.session(id), file };
}
test("all difficulty rubrics, input bounds, score boundaries and applicability", () => {
  for (const level of Object.keys(MOCK_RUBRICS))
    assert.equal(validateSetup({ ...config, level }).level, level);
  assert.throws(() => validateSetup({ ...config, level: "toString" }));
  assert.throws(() => validateSetup({ ...config, resume: "" }));
  assert.throws(() => validateSetup({ ...config, minutes: 60 }));
  assert.deepEqual([null, 59, 60, 79, 80, 100].map(mockBand), [
    "missing",
    "poor",
    "fair",
    "fair",
    "good",
    "good",
  ]);
  assert.equal(
    dimensionScore([
      { id: "technical", status: "scored", score: 80 },
      { id: "business", status: "na", score: null },
    ]),
    80,
  );
  assert.equal(
    dimensionScore([{ id: "metrics", status: "insufficient", score: null }]),
    null,
  );
});
test("text interview, immutable setup, duplicate submit, private snapshots and report export", async (t) => {
  const { mock, s, id, service } = fixture(t);
  config.role = "后端工程师";
  await mock.start(id);
  const turn = s.turns[0];
  mock.draft(id, turn.id, "我使用缓存优化订单查询");
  await mock.submit(id, turn.id);
  await mock.submit(id, turn.id);
  assert.equal(s.turns.length, 2);
  assert.equal(s.turns[0].status, "answered");
  assert.equal(s.turns[0].analysis, undefined);
  assert.equal(service.state().sessions.length, 0);
  assert(!JSON.stringify(service.state()).includes("SECRET"));
  mock.end(id);
  await mock.report(id);
  assert.equal(s.report.status, "complete");
  assert.equal(s.report.answered, 1);
  assert.equal(s.report.total, 2);
  assert.equal(s.report.overallScore, 80);
  assert.match(mockMarkdown(s), /背景与业务目标/);
  assert.match(mockMarkdown(s), /未作答/);
  assert.equal(s.turns[1].analysis, undefined);
});
test("pause fences late model responses and resume retries missing question", async (t) => {
  let release;
  const { mock, s, id } = fixture(
    t,
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const work = mock.start(id);
  mock.pause(id);
  release('{"question":"迟到的问题","category":"technical","followup":false}');
  await work;
  assert.equal(s.status, "paused");
  assert.equal(s.turns.length, 0);
  mock.call = async () =>
    '{"question":"重新开始的问题","category":"technical","followup":false}';
  await mock.start(id);
  assert.equal(s.turns.length, 1);
});
test("followups are capped at two and scoring groups them under their main question", async (t) => {
  let count = 0;
  const { mock, s, id } = fixture(t, async () =>
    JSON.stringify({
      question: "问题" + ++count,
      category: "technical",
      followup: count > 1,
    }),
  );
  await mock.start(id);
  await mock.submit(id, s.turns[0].id, "回答");
  await mock.submit(id, s.turns[1].id, "回答");
  await assert.rejects(mock.submit(id, s.turns[2].id, "回答"), /追问已达上限/);
  assert.equal(s.turns.length, 3);
  assert.equal(s.turns[2].parentId, s.turns[0].id);
  s.turns.forEach((turn, i) => {
    turn.analysis = { score: [60, 80, 100][i] };
  });
  assert.deepEqual(aggregateReport(s), {
    answered: 1,
    total: 1,
    overallScore: 80,
  });
});
test("time limit finishes after current submission; skip preserves draft without scoring", async (t) => {
  const { mock, s, id } = fixture(t);
  await mock.start(id);
  mock.draft(id, s.turns[0].id, "草稿");
  s.elapsedMs = 30 * 60000;
  await mock.skip(id);
  assert.equal(s.status, "completed");
  assert.equal(s.turns[0].draft, "草稿");
  await mock.report(id);
  assert.equal(s.report.overallScore, null);
  assert.equal(s.report.answered, 0);
});
test("report rejects invented numeric claims, invalid quotes and unsupported metric values", async (t) => {
  const { mock, s, id } = fixture(t);
  await mock.start(id);
  await mock.submit(id, s.turns[0].id, "我使用缓存优化订单查询");
  const turn = s.turns[0];
  assert.equal(
    parseMockAnalysis(JSON.stringify(analysis()), s, turn).score,
    80,
  );
  const invented = analysis();
  invented.reference[0].text = "我将收益提高了99%";
  assert.throws(
    () => parseMockAnalysis(JSON.stringify(invented), s, turn),
    /未提供的数字/,
  );
  const quote = analysis();
  quote.dimensions[0].evidence = "虚构原话";
  assert.throws(
    () => parseMockAnalysis(JSON.stringify(quote), s, turn),
    /引用不在/,
  );
  const metric = analysis();
  metric.metrics[0].result = "99ms";
  assert.throws(
    () => parseMockAnalysis(JSON.stringify(metric), s, turn),
    /必须摘录/,
  );
});
test("partial report failure preserves successful turns and retry only fills missing work", async (t) => {
  const { mock, s, id } = fixture(t);
  await mock.start(id);
  await mock.submit(id, s.turns[0].id, "我使用缓存优化订单查询");
  await mock.submit(id, s.turns[1].id, "我使用缓存优化订单查询");
  mock.end(id);
  let count = 0;
  const original = mock.call;
  mock.call = async (...args) => {
    if (args[1].includes("分析当前题") && ++count === 2) return "invalid JSON";
    return original(...args);
  };
  await mock.report(id);
  assert.equal(s.report.status, "partial");
  assert(s.turns[0].analysis);
  assert(s.turns[1].analysisError);
  count = 0;
  mock.call = async (...args) => {
    if (args[1].includes("分析当前题")) count++;
    return original(...args);
  };
  await mock.report(id);
  assert.equal(count, 1);
  assert.equal(s.report.status, "complete");
});
test("restart pauses interview, preserves draft, old stores gain empty collection", async (t) => {
  const { mock, store, s, id, file } = fixture(t);
  await mock.start(id);
  mock.draft(id, s.turns[0].id, "尚未提交");
  const restored = new Store(file, cipher);
  assert.equal(restored.data.mockInterviews[0].status, "paused");
  assert.equal(restored.data.mockInterviews[0].turns[0].draft, "尚未提交");
  assert.equal(restored.data.mockInterviews[0].runningSince, undefined);
  delete store.data.mockInterviews;
  store.save();
  assert.deepEqual(new Store(file, cipher).data.mockInterviews, []);
  store.data.mockInterviews = [s];
});
async function voiceFixture(t, options = {}) {
  const f = fixture(t);
  await f.mock.start(f.id);
  let cb,
    stopped = 0;
  const audio = {
    async start(frame, error) {
      this.frame = frame;
      this.error = error;
      if (options.deny) throw new Error("麦克风拒绝");
    },
    stop() {
      stopped++;
    },
  };
  const voice = new MockVoice(
    f.mock,
    audio,
    (callbacks) => {
      cb = callbacks;
      return { async connect() {}, close() {}, send() {} };
    },
    20,
    40,
    100,
  );
  t.after(() => voice.stop());
  await voice.listen(f.id).catch((e) => {
    if (!options.deny) throw e;
  });
  return {
    ...f,
    audio,
    voice,
    emit: (e) => cb.event(e),
    disconnect: () => cb.disconnected(new Error("断线")),
    stopped: () => stopped,
  };
}
function finalEvent(text = "我使用缓存优化订单查询", item_id = "item") {
  return {
    type: "conversation.item.input_audio_transcription.completed",
    item_id,
    transcript: text,
  };
}
test("microphone final transcripts deduplicate and auto submit after completion countdown", async (t) => {
  const f = await voiceFixture(t);
  f.emit(finalEvent());
  f.emit(finalEvent());
  await until(() => f.s.turns[0].status === "answered");
  assert.equal(f.s.turns[0].answer, "我使用缓存优化订单查询");
  assert.equal(f.service.runtime.mock.mic, "off");
  assert.equal(f.s.turns.length, 2);
});
test("continued speech or continue button cancels countdown", async (t) => {
  const f = await voiceFixture(t);
  f.emit(finalEvent());
  await until(() => f.service.runtime.mock.countdown);
  f.emit({ type: "input_audio_buffer.speech_started", item_id: "more" });
  await sleep(100);
  assert.equal(f.s.turns[0].status, "waiting");
  f.emit(finalEvent("补充口径", "more"));
  await until(() => f.service.runtime.mock.countdown);
  f.voice.continue();
  await sleep(100);
  assert.equal(f.s.turns[0].status, "waiting");
});
test("manual submit drains late final transcript before closing ASR", async (t) => {
  const f = await voiceFixture(t);
  f.emit({ type: "input_audio_buffer.speech_started", item_id: "late" });
  f.emit({
    type: "conversation.item.input_audio_transcription.text",
    item_id: "late",
    text: "部分",
  });
  const submit = f.voice.submit(f.id, f.s.turns[0].id);
  setTimeout(() => f.emit(finalEvent("完整的最后一句", "late")), 40);
  await submit;
  assert.equal(f.s.turns[0].answer, "完整的最后一句");
});
test("microphone denial, disconnect and stop retain text and allow text fallback", async (t) => {
  const denied = await voiceFixture(t, { deny: true });
  assert.equal(denied.service.runtime.mock.mic, "off");
  assert.match(denied.service.runtime.mock.error, /麦克风拒绝/);
  const f = await voiceFixture(t);
  f.emit({
    type: "conversation.item.input_audio_transcription.text",
    item_id: "partial",
    text: "我的回答草稿",
  });
  f.disconnect();
  assert.equal(f.s.turns[0].draft, "我的回答草稿");
  await f.voice.submit(f.id, f.s.turns[0].id);
  assert.equal(f.s.turns[0].status, "answered");
});
test("blank audio never submits; completeness failure preserves draft", async (t) => {
  const f = await voiceFixture(t);
  f.emit(finalEvent(""));
  await sleep(100);
  assert.equal(f.s.turns[0].status, "waiting");
  f.mock.completeAnswer = async () => {
    throw new Error("timeout");
  };
  f.emit(finalEvent("继续想一想", "new"));
  await until(() => f.service.runtime.mock.error);
  assert.equal(f.s.turns[0].status, "waiting");
  assert.match(f.service.runtime.mock.error, /自动结束判断/);
});
test("normal meeting and mock microphone are mutually exclusive", async (t) => {
  const { mock, id, service } = fixture(t);
  await mock.start(id);
  service.runtime.voice.status = "listening";
  const voice = new MockVoice(mock, {
    async start() {
      assert.fail();
    },
    stop() {},
  });
  await assert.rejects(voice.listen(id), /停止工作台/);
});
test("older final transcript cannot erase newer partial speech", async (t) => {
  const f = await voiceFixture(t);
  f.emit({ type: "input_audio_buffer.speech_started", item_id: "old" });
  f.emit({ type: "input_audio_buffer.speech_started", item_id: "new" });
  f.emit({
    type: "conversation.item.input_audio_transcription.text",
    item_id: "new",
    text: "还有一段新回答",
  });
  f.emit(finalEvent("第一段完成", "old"));
  assert.equal(f.service.runtime.mock.partial, "还有一段新回答");
  await sleep(100);
  assert.equal(f.s.turns[0].status, "waiting");
  f.voice.stop();
  assert.equal(f.s.turns[0].draft, "第一段完成\n还有一段新回答");
});
test("manual finalization timeout keeps partial text editable and never submits silently", async (t) => {
  const f = await voiceFixture(t);
  f.emit({ type: "input_audio_buffer.speech_started", item_id: "pending" });
  f.emit({
    type: "conversation.item.input_audio_transcription.text",
    item_id: "pending",
    text: "未完成转写",
  });
  await assert.rejects(f.voice.submit(f.id, f.s.turns[0].id), /超时/);
  assert.equal(f.s.turns[0].status, "waiting");
  assert.equal(f.s.turns[0].draft, "未完成转写");
  assert.equal(f.service.runtime.mock.mic, "off");
});
test("draft preserves word boundaries and blank submit does not advance", async (t) => {
  const { mock, s, id } = fixture(t);
  await mock.start(id);
  mock.draft(id, s.turns[0].id, "cache ");
  assert.equal(s.turns[0].draft, "cache ");
  mock.draft(id, s.turns[0].id, " ");
  await assert.rejects(mock.submit(id, s.turns[0].id), /请先回答/);
  assert.equal(s.turns.length, 1);
});
test("cancelled finalization cannot submit or stop a newly resumed microphone", async t => {
  const f = await voiceFixture(t);
  f.mock.draft(f.id, f.s.turns[0].id, "原回答");
  const submitted = f.voice.submit(f.id, f.s.turns[0].id);
  const rejection = assert.rejects(submitted, /提交已取消/);
  f.voice.stop();
  f.mock.pause(f.id);
  await f.mock.start(f.id);
  await f.voice.listen(f.id);
  await rejection;
  assert.equal(f.s.turns[0].status, "waiting");
  assert.equal(f.service.runtime.mock.mic, "listening");
});
