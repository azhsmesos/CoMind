const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");
const { Store } = require("../dist-electron/electron/store");
const { Service } = require("../dist-electron/electron/service");
const { Voice } = require("../dist-electron/electron/voice");
const {
  QwenAsr,
  AsrError,
  asrError,
} = require("../dist-electron/electron/qwen-asr");
const { parseQuestion } = require("../dist-electron/electron/voice-questions");
const { voiceEndpoint } = require("../dist-electron/shared/voice");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await sleep(5);
  }
  assert.ok(check(), "condition timed out");
}
const cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s).toString("base64"),
  decrypt: (s) => Buffer.from(s, "base64").toString(),
};
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-voice-"));
  const file = path.join(dir, "state.json");
  const store = new Store(file, cipher);
  store.saveModel({
    id: "model",
    name: "test",
    provider: "deepseek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiKey: "test-answer-key",
  });
  store.saveVoice("workspace-test", "test-speech-key");
  const generated = [];
  const decisions = [];
  const clients = [];
  const service = new Service(
    store,
    () => {},
    async (...args) => {
      generated.push(args[1]);
      if (options.generate) return options.generate(...args);
      return { summary: args[1], code: "", kind: "answer" };
    },
  );
  const audio = {
    stopped: 0,
    async start(frame, error) {
      this.frame = frame;
      this.error = error;
      if (options.captureFail) throw new Error("permission denied");
    },
    stop() {
      this.stopped++;
    },
  };
  const voice = new Voice(
    service,
    audio,
    (callbacks) => {
      const client = {
        callbacks,
        closed: false,
        async connect() {},
        send() {},
        close() {
          this.closed = true;
        },
      };
      clients.push(client);
      return client;
    },
    async (model, context, text, signal) => {
      decisions.push({ context, text });
      return options.detect
        ? options.detect(model, context, text, signal)
        : {
            kind: text.includes("?")
              ? "question"
              : text.includes("我想问")
                ? "incomplete"
                : "statement",
            question: text,
          };
    },
    () => {},
    5,
    [5, 5, 5],
  );
  const say = (text, id = String(Math.random())) =>
    clients
      .at(-1)
      .callbacks.event({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: id,
        transcript: text,
      });
  t.after(() => {
    voice.dispose();
    service.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    service,
    voice,
    audio,
    generated,
    decisions,
    clients,
    say,
    file,
  };
}
test("voice credentials are encrypted, blank edits preserve key, invalid edits do not overwrite, state never contains key", (t) => {
  const { store, service, file } = setup(t);
  assert.equal(store.voiceKey(), "test-speech-key");
  store.saveVoice("workspace-test", "");
  assert.throws(() => store.saveVoice("evil.host/path", "other"));
  assert.throws(() => store.saveVoice("workspace-test", "Bearer sk-test"));
  assert.equal(store.voiceKey(), "test-speech-key");
  assert.ok(!JSON.stringify(service.state()).includes("test-speech-key"));
  assert.ok(!fs.readFileSync(file, "utf8").includes("test-speech-key"));
  assert.equal(new Store(file, cipher).voiceKey(), "test-speech-key");
  assert.match(
    voiceEndpoint("workspace-test"),
    /^wss:\/\/workspace-test\.cn-beijing/,
  );
});
test("transcripts are incremental, paginated, linked, recovered and absent from state broadcasts", (t) => {
  const { store, service, file } = setup(t);
  const session = service.create();
  for (let i = 0; i < 125; i++)
    store.transcripts.append(session.id, {
      id: String(i),
      at: new Date().toISOString(),
      text: "record-" + i,
      kind: "speech",
    });
  const page = store.transcripts.page(session.id);
  assert.equal(page.items.length, 50);
  assert.equal(page.before, 75);
  store.transcripts.append(session.id, {
    ...page.items[0],
    roundId: "round-1",
  });
  assert.equal(store.transcripts.page(session.id).total, 125);
  assert.equal(store.transcripts.get(session.id, "75").roundId, "round-1");
  assert.ok(!JSON.stringify(service.state()).includes("record-124"));
  assert.match(store.transcripts.markdown(session.id), /round-1/);
  const again = new Store(file, cipher);
  assert.equal(again.transcripts.page(session.id, 75).items[0].id, "25");
  store.transcripts.delete(session.id);
  assert.equal(store.transcripts.page(session.id).total, 0);
});
test("statement only transcribes; incomplete phrases merge; final revisions dedupe; changed followup is answered", async (t) => {
  const x = setup(t);
  await x.voice.start();
  x.say("今天讨论缓存");
  await until(() => x.decisions.length === 1);
  assert.equal(x.generated.length, 0);
  x.say("我想问一下");
  await until(() => x.decisions.length === 2);
  assert.equal(x.generated.length, 0);
  x.say("缓存怎么设计?", "question-1");
  x.say("缓存怎么设计?", "question-1");
  await until(() => x.generated.length === 1);
  assert.match(x.generated[0], /我想问一下\n缓存/);
  x.say("我想问一下\n缓存怎么设计?");
  await until(() => x.decisions.length === 4);
  assert.equal(x.generated.length, 1);
  x.say("并发十万时缓存怎么设计?");
  await until(() => x.generated.length === 2);
  assert.equal(x.store.transcripts.page(x.store.data.activeSessionId).total, 5);
});
test("new speech while classifying waits for completion and does not answer a truncated question", async (t) => {
  let release;
  let first = true;
  const x = setup(t, {
    detect: async (_m, _c, text) => {
      if (first) {
        first = false;
        await new Promise((r) => (release = r));
      }
      return { kind: "question", question: text };
    },
  });
  await x.voice.start();
  x.say("如何排序?");
  await until(() => !!release);
  x.clients[0].callbacks.event({
    type: "input_audio_buffer.speech_started",
    item_id: "b",
  });
  release();
  await sleep(20);
  assert.equal(x.generated.length, 0);
  x.say("要求原地实现?", "b");
  await until(() => x.generated.length === 1);
  assert.match(x.generated[0], /如何排序\?\n要求原地实现/);
});
test("voice questions are serial, manual requests take priority, and stop fences late generated answers", async (t) => {
  const gates = [];
  const x = setup(t, {
    generate: (...args) =>
      new Promise((r) =>
        gates.push({ text: args[1], signal: args[5], resolve: r }),
      ),
  });
  await x.voice.start();
  x.say("第一题?");
  await until(() => gates.length === 1);
  x.say("第二题?");
  await until(() => x.service.runtime.voice.queued === 1);
  assert.equal(gates[0].signal.aborted, false);
  const manual = x.service.add("手动优先");
  await until(() => gates.length === 2);
  assert.equal(gates[0].signal.aborted, true);
  gates[0].resolve({ summary: "stale" });
  await sleep(20);
  assert.equal(gates.length, 2);
  gates[1].resolve({ summary: "manual" });
  await manual;
  await until(() => gates.length === 3);
  x.voice.stop();
  assert.equal(gates[2].signal.aborted, true);
  gates[2].resolve({ summary: "late" });
  await sleep(20);
  assert.ok(
    !x.service
      .session(x.store.data.activeSessionId)
      .rounds.some((r) => r.answer?.summary === "late"),
  );
});
test("stop, session switch and auto-off discard late classification; capture failure stops resources", async (t) => {
  let release;
  const x = setup(t, { detect: () => new Promise((r) => (release = r)) });
  await x.voice.start();
  x.say("要取消的问题?");
  await until(() => !!release);
  x.voice.stop();
  release({ kind: "question", question: "late?" });
  await sleep(20);
  assert.equal(x.generated.length, 0);
  const old = x.clients[0];
  old.callbacks.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "late",
    transcript: "late",
  });
  assert.equal(x.store.transcripts.page(x.store.data.activeSessionId).total, 1);
  await x.voice.start();
  x.voice.auto(false);
  x.say("仅转写?");
  await sleep(20);
  assert.equal(x.generated.length, 0);
  const y = setup(t, { captureFail: true });
  await assert.rejects(y.voice.start(), /permission/);
  assert.equal(y.service.runtime.voice.status, "error");
  assert.ok(y.audio.stopped > 0);
});
test("disconnect records gap, retries exactly three times and fatal errors stop immediately", async (t) => {
  const x = setup(t);
  await x.voice.start();
  for (let i = 1; i <= 3; i++) {
    x.clients.at(-1).callbacks.disconnected(new AsrError("断线"));
    await until(() => x.clients.length === i + 1);
  }
  x.clients.at(-1).callbacks.disconnected(new AsrError("断线"));
  assert.equal(x.service.runtime.voice.status, "error");
  assert.equal(x.clients.length, 4);
  assert.equal(
    x.store.transcripts
      .page(x.store.data.activeSessionId)
      .items.filter((r) => r.kind === "gap").length,
    3,
  );
  await x.voice.start();
  x.clients.at(-1).callbacks.disconnected(asrError(401));
  assert.equal(x.service.runtime.voice.status, "error");
  await sleep(30);
  assert.equal(x.clients.length, 5);
});
test("question classification rejects malformed or empty output", () => {
  assert.throws(() => parseQuestion('{"kind":"question","question":""}'));
  assert.throws(() => parseQuestion('{"kind":"run-command","question":"x"}'));
  assert.deepEqual(parseQuestion('{"kind":"statement","question":""}'), {
    kind: "statement",
    question: "",
  });
});
test("Qwen WebSocket uses official event schema, auth, PCM, partial/final events; ignores late frames on stop", async (t) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  t.after(() => server.close());
  let socket;
  const messages = [];
  let auth;
  server.on("connection", (ws, req) => {
    socket = ws;
    auth = req.headers.authorization;
    ws.on("message", (raw) => {
      const message = JSON.parse(raw);
      messages.push(message);
      if (message.type === "session.update")
        ws.send(JSON.stringify({ type: "session.updated" }));
    });
  });
  const events = [];
  const errors = [];
  const client = new QwenAsr(
    { event: (e) => events.push(e), disconnected: (e) => errors.push(e) },
    () => `ws://127.0.0.1:${server.address().port}`,
  );
  t.after(() => client.close());
  await client.connect("test", "secret-key");
  assert.equal(auth, "Bearer secret-key");
  assert.equal(messages[0].session.turn_detection.silence_duration_ms, 800);
  client.send(new Uint8Array(3200));
  await until(() => messages.length === 2);
  assert.equal(Buffer.from(messages[1].audio, "base64").length, 3200);
  socket.send(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.text",
      text: "前缀",
      stash: "后缀",
    }),
  );
  socket.send(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "1",
      transcript: "最终",
    }),
  );
  await until(() => events.length === 2);
  client.close();
  await sleep(20);
  assert.equal(errors.length, 0);
});
test("PCM worklet downmixes and resamples 48 kHz to fixed PCM16 frames without audible playback", () => {
  let Processor;
  const output = [];
  const context = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => output.push(m) };
      }
    },
    sampleRate: 48000,
    registerProcessor: (_n, p) => (Processor = p),
    ArrayBuffer,
    DataView,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/pcm-worklet.js"), "utf8"),
    context,
  );
  const processor = new Processor();
  const left = new Float32Array(4800).fill(0.5),
    right = new Float32Array(4800).fill(0.5),
    silent = new Float32Array(4800).fill(1);
  processor.process([[left, right]], [[silent]]);
  assert.equal(output.length, 1);
  assert.equal(output[0].pcm.byteLength, 3200);
  assert.equal(new DataView(output[0].pcm).getInt16(0, true), 16384);
  assert.ok(silent.every((x) => x === 0));
});

test("queue overflow pauses automatic answering, keeps ten pending questions and continues transcription", async (t) => {
  let release;
  const x = setup(t, { generate: () => new Promise((r) => (release = r)) });
  await x.voice.start();
  x.say("blocked?");
  await until(() => !!release);
  for (let i = 0; i < 11; i++) {
    x.say("question " + i + "?");
    await until(() => x.decisions.length >= i + 2);
    await sleep(8);
  }
  assert.equal(x.service.runtime.voice.autoAnswer, false);
  assert.equal(x.service.runtime.voice.queued, 10);
  x.say("继续转写");
  await sleep(10);
  assert.equal(
    x.store.transcripts.page(x.store.data.activeSessionId).total,
    13,
  );
  release({ summary: "late" });
});
test("session switch releases capture and rejects old final events", async (t) => {
  const x = setup(t);
  await x.voice.start();
  const id = x.store.data.activeSessionId;
  x.store.data.activeSessionId = null;
  x.service.create();
  await until(() => x.service.runtime.voice.status === "stopped");
  x.clients[0].callbacks.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "late",
    transcript: "旧发言",
  });
  assert.equal(x.store.transcripts.page(id).total, 0);
  assert.ok(x.audio.stopped > 0);
});
test("old utterance final does not close a newer utterance that is still speaking", async (t) => {
  const x = setup(t);
  await x.voice.start();
  x.clients[0].callbacks.event({
    type: "input_audio_buffer.speech_started",
    item_id: "new",
  });
  x.say("先前的问题?", "old");
  await sleep(30);
  assert.equal(x.generated.length, 0);
  x.say("加上新条件?", "new");
  await until(() => x.generated.length === 1);
  assert.match(x.generated[0], /加上新条件/);
});
