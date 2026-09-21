const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { Store } = require("../dist-electron/electron/store");
const {
  Service,
  sessionMarkdown,
} = require("../dist-electron/electron/service");
const {
  callModel,
  parseAnswer,
  parseEvaluation,
} = require("../dist-electron/electron/llm");
const { DomServer } = require("../dist-electron/electron/DomServer");
const { PRESETS } = require("../dist-electron/shared/types");
const answer = Object.fromEntries(
  [
    "summary",
    "problem",
    "clarify",
    "approach",
    "code",
    "walkthrough",
    "time_complexity",
    "space_complexity",
  ].map((k) => [k, "真实测试回答 " + k]),
);
const cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s).toString("base64"),
  decrypt: (s) => Buffer.from(s, "base64").toString(),
};
test("Fn function keys normalize, duplicate shortcuts rejected, old preferences gain screenshot key", async (t) => {
  const {
    normalizeShortcut,
    validatePreferences,
  } = require("../dist-electron/electron/service");
  assert.equal(normalizeShortcut("Fn + F1"), "F1");
  assert.equal(normalizeShortcut("fn+f12"), "F12");
  assert.throws(() => normalizeShortcut("Fn+A"), /Fn/);
  const store = setup(t);
  delete store.data.preferences.shortcuts.screenshot;
  for (const key of ["scrollUp", "scrollDown", "scrollLeft", "scrollRight"])
    delete store.data.preferences.shortcuts[key];
  store.data.preferences.shortcuts.penetration = "Control+Alt+F7";
  store.save();
  const restored = new Store(store["file"], cipher);
  assert.equal(
    restored.data.preferences.shortcuts.screenshot,
    "CommandOrControl+Shift+S",
  );
  assert.equal(
    restored.data.preferences.shortcuts.scrollUp,
    "CommandOrControl+Alt+Up",
  );
  assert.equal(
    restored.data.preferences.shortcuts.scrollDown,
    "CommandOrControl+Alt+Down",
  );
  assert.equal(
    restored.data.preferences.shortcuts.scrollLeft,
    "CommandOrControl+Alt+Left",
  );
  assert.equal(
    restored.data.preferences.shortcuts.scrollRight,
    "CommandOrControl+Alt+Right",
  );
  assert.equal(
    restored.data.preferences.shortcuts.penetration,
    "Control+Alt+F7",
  );
  const service = new Service(restored, () => {});
  const preferences = structuredClone(restored.data.preferences);
  preferences.shortcuts.screenshot = "Fn+F2";
  await service.execute({ type: "preferences:save", preferences });
  assert.equal(restored.data.preferences.shortcuts.screenshot, "F2");
  preferences.shortcuts.screenshot = preferences.shortcuts.overlay;
  assert.throws(() => validatePreferences(preferences), /相同快捷键/);
});
test("new scroll defaults preserve existing custom shortcuts and explicit disabling", (t) => {
  const store = setup(t);
  delete store.data.preferences.shortcuts.scrollDown;
  store.data.preferences.shortcuts.screenshot = "CommandOrControl+Alt+Down";
  store.data.preferences.shortcuts.scrollUp = "";
  store.save();
  const restored = new Store(store["file"], cipher);
  assert.equal(
    restored.data.preferences.shortcuts.screenshot,
    "CommandOrControl+Alt+Down",
  );
  assert.equal(restored.data.preferences.shortcuts.scrollDown, "");
  assert.equal(restored.data.preferences.shortcuts.scrollUp, "");
});
test("screenshots use actual multimodal wire format for both protocols", async (t) => {
  const requests = [];
  const base = await server(t, (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.endsWith("/messages")
            ? { content: [{ type: "text", text: "vision" }] }
            : { choices: [{ message: { content: "vision" } }] },
        ),
      );
    });
  });
  const image =
    "data:image/jpeg;base64," +
    Buffer.from("synthetic-image").toString("base64");
  for (const protocol of ["openai", "anthropic"])
    assert.equal(
      await callModel(
        { protocol, baseUrl: base, model: "vision-test", apiKey: "synthetic" },
        "system",
        "question",
        new AbortController().signal,
        image,
      ),
      "vision",
    );
  assert.deepEqual(requests[0].messages[1].content[1], {
    type: "image_url",
    image_url: { url: image },
  });
  assert.deepEqual(requests[1].messages[0].content[0], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: image.split(",")[1],
    },
  });
  assert.equal(requests[1].messages[0].content[1].text, "question");
});
test("screenshot failures retain image for retry and restart; recognized question replaces placeholder", async (t) => {
  const store = setup(t);
  model(store);
  const image = "data:image/png;base64,aGVsbG8=";
  let fail = true;
  const service = new Service(
    store,
    () => {},
    async (...args) => {
      assert.equal(args[6], image);
      if (fail) throw new Error("vision unavailable");
      return { ...answer, problem: "识别出来的题目" };
    },
  );
  await assert.rejects(
    service.add("截图题目", "screenshot", undefined, image),
    /vision unavailable/,
  );
  const session = store.data.sessions[0],
    round = session.rounds[0];
  assert.equal(round.status, "error");
  assert.equal(
    new Store(store["file"], cipher).data.sessions[0].rounds[0].image,
    image,
  );
  fail = false;
  await service.answer(session.id, round.id);
  assert.equal(round.question, "识别出来的题目");
  assert.equal(round.status, "done");
  await service.execute({ type: "session:pause", id: session.id });
  await assert.rejects(
    service.add("截图", "screenshot", undefined, image),
    /继续会话/,
  );
  assert.equal(session.rounds.length, 1);
});
test("bad image input rejected before a session or request is created", async (t) => {
  const store = setup(t);
  const service = new Service(store, () => {});
  await assert.rejects(
    service.add("截图", "screenshot", undefined, "https://not-an-image"),
    /截图格式/,
  );
  assert.equal(store.data.sessions.length, 0);
});
test("image-incompatible model errors are actionable", async (t) => {
  const base = await server(t, (_req, res) => {
    res.writeHead(400);
    res.end("{}");
  });
  await assert.rejects(
    callModel(
      { protocol: "openai", baseUrl: base, model: "text-only", apiKey: "test" },
      "s",
      "u",
      new AbortController().signal,
      "data:image/png;base64,aGVsbG8=",
    ),
    /支持视觉输入/,
  );
});
function setup(t, available = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-core-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Store(path.join(dir, "state.json"), {
    ...cipher,
    available: () => available,
  });
}
function model(store) {
  store.saveModel({
    id: "test",
    name: "测试",
    provider: "deepseek",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "fixture",
    apiKey: "test-secret-only",
  });
}
test("DeepSeek defaults persist, preserve credentials on edit and allow custom model IDs", (t) => {
  const store = setup(t);
  const config = {
    id: "deepseek",
    ...PRESETS.deepseek,
    provider: "deepseek",
    protocol: "openai",
    model: " ",
    apiKey: "synthetic-deepseek-key",
  };
  store.saveModel(config);
  const restored = new Store(store["file"], cipher);
  assert.equal(restored.models()[0].model, "deepseek-flash");
  assert.equal(restored.models()[0].baseUrl, "https://api.deepseek.com");
  assert.equal(restored.data.activeModelId, "deepseek");
  restored.saveModel({ ...config, model: "custom-model-id", apiKey: "" });
  assert.equal(restored.models()[0].model, "custom-model-id");
  assert.equal(restored.key("deepseek"), "synthetic-deepseek-key");
  assert.ok(
    !JSON.stringify(restored.snapshot({})).includes("synthetic-deepseek-key"),
  );
  assert.throws(
    () => store.saveModel({ ...config, provider: "custom", model: "" }),
    /模型 ID/,
  );
});
test("DeepSeek text and screenshot rounds use the official endpoint, bearer auth and vision blocks", async (t) => {
  const store = setup(t);
  store.saveModel({
    id: "deepseek",
    ...PRESETS.deepseek,
    provider: "deepseek",
    protocol: "openai",
    apiKey: "synthetic-deepseek-key",
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({
      url,
      headers: options.headers,
      body: JSON.parse(options.body),
    });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              reasoning_content: "This is not the answer",
              content: JSON.stringify(answer),
            },
          },
        ],
      }),
    );
  });
  const service = new Service(store, () => {});
  await service.add("解释哈希表");
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await service.add("请识别截图", "screenshot", undefined, image);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, "https://api.deepseek.com/chat/completions");
    assert.equal(
      request.headers.Authorization,
      "Bearer synthetic-deepseek-key",
    );
    assert.equal(request.body.model, "deepseek-flash");
    assert.equal(request.body.stream, false);
    assert.equal(typeof request.body.messages[0].content, "string");
  }
  assert.equal(
    JSON.parse(requests[0].body.messages[1].content).question,
    "解释哈希表",
  );
  const vision = requests[1].body.messages[1];
  assert.equal(vision.role, "user");
  assert.equal(vision.content[0].type, "text");
  assert.equal(JSON.parse(vision.content[0].text).question, "请识别截图");
  assert.deepEqual(vision.content[1], {
    type: "image_url",
    image_url: { url: image },
  });
  assert.deepEqual(
    store.data.sessions[0].rounds.map((r) => r.status),
    ["done", "done"],
  );
  assert.equal(store.data.sessions[0].rounds[1].question, answer.problem);
  assert.deepEqual(store.data.sessions[0].rounds[1].answer, answer);
});
test("malformed DeepSeek keys cannot overwrite a saved working credential", (t) => {
  const store = setup(t);
  const config = {
    id: "deepseek",
    ...PRESETS.deepseek,
    provider: "deepseek",
    protocol: "openai",
    apiKey: "synthetic-original-key",
  };
  store.saveModel(config);
  for (const apiKey of [
    "Bearer sk-test",
    '"sk-test"',
    "sk-***123",
    "sk-…123",
    "sk-...123",
    "sk-\u200Btest",
    "sk-test\ninside",
  ]) {
    assert.throws(() => store.saveModel({ ...config, apiKey }), /API Key 格式/);
    assert.equal(store.key(config.id), config.apiKey);
  }
  store.saveModel({ ...config, apiKey: "  synthetic-replacement-key\n" });
  assert.equal(store.key(config.id), "synthetic-replacement-key");
});
test("DeepSeek distinguishes authentication from forbidden access without exposing server response or key", async (t) => {
  let status = 401;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("secret-server-response", { status }),
  );
  t.mock.method(console, "warn", () => {});
  const config = {
    ...PRESETS.deepseek,
    provider: "deepseek",
    protocol: "openai",
    apiKey: "synthetic-private-key",
  };
  for (const code of [401, 403]) {
    status = code;
    await assert.rejects(
      callModel(config, "s", "u", new AbortController().signal),
      (e) => {
        assert.match(e.message, new RegExp(`HTTP ${code}`));
        assert.match(
          e.message,
          code === 401 ? /DeepSeek.*重新填写/ : /访问被拒绝/,
        );
        assert.ok(!e.message.includes(config.apiKey));
        assert.ok(!e.message.includes("secret-server-response"));
        return true;
      },
    );
  }
  assert.deepEqual(
    console.warn.mock.calls.map((c) => c.arguments),
    [["[llm] 模型请求失败 · HTTP 401"], ["[llm] 模型请求失败 · HTTP 403"]],
  );
});
test("DeepSeek reports insufficient balance and actionable vision errors without leaking response data", async (t) => {
  let status = 402;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("secret-response", { status }),
  );
  const config = {
    ...PRESETS.deepseek,
    provider: "deepseek",
    protocol: "openai",
    apiKey: "synthetic",
  };
  await assert.rejects(
    callModel(config, "s", "u", new AbortController().signal),
    /余额不足/,
  );
  status = 400;
  await assert.rejects(
    callModel(
      config,
      "s",
      "u",
      new AbortController().signal,
      "data:image/png;base64,aGVsbG8=",
    ),
    (e) =>
      /deepseek-flash/.test(e.message) &&
      /截图已保留/.test(e.message) &&
      !e.message.includes("secret"),
  );
});
async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        s.closeAllConnections();
        s.close(r);
      }),
  );
  return `http://127.0.0.1:${s.address().port}`;
}
test("credentials encrypted on disk, omitted from public snapshot, recover after restart", (t) => {
  const store = setup(t);
  model(store);
  const data = store.snapshot({});
  assert.equal(data.models[0].hasKey, true);
  assert.ok(!JSON.stringify(data).includes("test-secret"));
  assert.ok(!JSON.stringify(data).includes("credential"));
  assert.ok(!JSON.stringify(store.data).includes("test-secret"));
  const file = path.join(store["file"]);
  const recovered = new Store(file, cipher);
  assert.equal(recovered.key("test"), "test-secret-only");
});
test("unavailable cipher keeps keys only in memory", (t) => {
  const store = setup(t, false);
  model(store);
  assert.equal(store.key("test"), "test-secret-only");
  assert.deepEqual(store.data.credentials, {});
  const next = new Store(store["file"], { ...cipher, available: () => false });
  assert.equal(next.key("test"), "");
});
test("unreadable store backed up without silently deleting original content", (t) => {
  const store = setup(t);
  fs.writeFileSync(store["file"], "{broken");
  const next = new Store(store["file"], cipher);
  assert.match(next.warning, /备份/);
  assert.ok(
    fs
      .readdirSync(path.dirname(store["file"]))
      .some((f) => f.includes(".unreadable-")),
  );
});
test("strict answer shape and non-fabricated reference-only evaluation", () => {
  assert.deepEqual(
    parseAnswer("```json\n" + JSON.stringify(answer) + "\n```"),
    answer,
  );
  assert.throws(() => parseAnswer("{}"), /缺少字段/);
  assert.throws(() => parseAnswer("text"), /格式错误/);
  const e = parseEvaluation(
    JSON.stringify({
      overallScore: 99,
      summary: "参考分析",
      strengths: [],
      weaknesses: [],
      qaAnalysis: [],
    }),
    false,
  );
  assert.equal(e.overallScore, null);
  assert.throws(
    () => parseEvaluation(JSON.stringify({ ...e, overallScore: 200 }), true),
    /评分格式/,
  );
});
test("provider presets and both protocols use the correct wire format; reasoning ignored", async (t) => {
  const seen = [];
  const base = await server(t, (req, res) => {
    let text = "";
    req.on("data", (b) => (text += b));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(text) });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.endsWith("/messages")
            ? {
                content: [
                  { type: "thinking", thinking: "not-an-answer" },
                  { type: "text", text: "ANSWER" },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      content: "ANSWER",
                      reasoning_content: "not-an-answer",
                    },
                  },
                ],
              },
        ),
      );
    });
  });
  for (const provider of ["doubao", "deepseek", "glm"]) {
    assert.ok(PRESETS[provider].baseUrl.startsWith("https://"));
    const result = await callModel(
      {
        provider,
        protocol: "openai",
        baseUrl: base + "/v1",
        model: "fixture",
        apiKey: "key",
      },
      "system",
      "user",
      new AbortController().signal,
    );
    assert.equal(result, "ANSWER");
  }
  await callModel(
    { protocol: "anthropic", baseUrl: base, model: "fixture", apiKey: "key" },
    "system",
    "user",
    new AbortController().signal,
  );
  assert.equal(seen[0].url, "/v1/chat/completions");
  assert.equal(seen[0].headers.authorization, "Bearer key");
  assert.equal(seen[0].body.thinking, undefined);
  assert.equal(seen[3].url, "/v1/messages");
  assert.equal(seen[3].headers["x-api-key"], "key");
  assert.equal(seen[3].body.system, "system");
});
test("HTTP errors redact server bodies and keys", async (t) => {
  let status = 401;
  const base = await server(t, (_req, res) => {
    res.statusCode = status;
    res.end("secret-data-do-not-echo");
  });
  for (const [code, pattern] of [
    [401, /鉴权/],
    [403, /鉴权/],
    [404, /不可用/],
    [429, /受限/],
    [500, /暂时/],
    [400, /参数/],
  ]) {
    status = code;
    await assert.rejects(
      callModel(
        { protocol: "openai", baseUrl: base, apiKey: "key", model: "m" },
        "s",
        "u",
        new AbortController().signal,
      ),
      pattern,
    );
  }
});
test("request abort does not hang", async (t) => {
  const base = await server(t, () => {});
  const c = new AbortController();
  const p = callModel(
    { protocol: "openai", baseUrl: base, apiKey: "key", model: "m" },
    "s",
    "u",
    c.signal,
  );
  c.abort();
  await assert.rejects(p, /取消/);
});
test("cancel and new generation fence off stale response", async (t) => {
  const store = setup(t);
  model(store);
  const pending = [];
  const service = new Service(
    store,
    () => {},
    () => new Promise((r) => pending.push(r)),
  );
  const creating = service.add("题目");
  const s = store.data.sessions[0],
    r = s.rounds[0];
  service.cancelRound(s.id, r.id);
  const newer = service.answer(s.id, r.id);
  pending[0]({ ...answer, summary: "stale" });
  await creating;
  assert.notEqual(r.answer?.summary, "stale");
  pending[1]({ ...answer, summary: "fresh" });
  await newer;
  assert.equal(r.answer.summary, "fresh");
  assert.equal(r.status, "done");
});
test("paused capture queues, resume processes and end prevents late writes", async (t) => {
  const store = setup(t);
  model(store);
  const service = new Service(
    store,
    () => {},
    async () => answer,
  );
  const s = service.create();
  await service.execute({ type: "session:pause", id: s.id });
  await service.capture({
    title: "题",
    url: "https://example.com",
    text: "题目一",
  });
  assert.equal(s.rounds.length, 0);
  assert.equal(s.pending.length, 1);
  await service.execute({ type: "session:resume", id: s.id });
  assert.equal(s.rounds[0].answer.summary, answer.summary);
  assert.equal(s.pending.length, 0);
  await service.execute({ type: "session:end", id: s.id });
  assert.equal(store.data.activeSessionId, null);
  assert.equal(s.status, "completed");
  assert.match(sessionMarkdown(s), /题目一/);
});
test("ending a session invalidates an in-flight response", async (t) => {
  const store = setup(t);
  model(store);
  let resolve;
  const service = new Service(
    store,
    () => {},
    () => new Promise((r) => (resolve = r)),
  );
  const pending = service.add("test");
  const s = store.data.sessions[0];
  await service.execute({ type: "session:end", id: s.id });
  resolve(answer);
  await pending;
  assert.equal(s.rounds[0].answer, undefined);
  assert.equal(s.status, "completed");
});
test("missing model preserves question and reports actionable error", async (t) => {
  const store = setup(t);
  const service = new Service(store, () => {});
  await assert.rejects(service.add("保留问题"), /模型/);
  assert.equal(store.data.sessions[0].rounds[0].question, "保留问题");
  assert.equal(store.data.sessions[0].rounds[0].status, "error");
});
test("DOM service first pairing, recovery, port probing, origin/token and empty-page checks", async (t) => {
  const data = { extensionToken: "test-token", extensionPaired: false };
  const payloads = [];
  const origin = "chrome-extension://" + "a".repeat(32);
  const srv = new DomServer((p) => payloads.push(p), {
    get: () => data,
    update: (p) => Object.assign(data, p),
  });
  const port = await srv.start();
  assert.ok(port >= 4123 && port <= 4134);
  t.after(() => srv.stop());
  const second = new DomServer(() => {}, {
    get: () => data,
    update: (p) => Object.assign(data, p),
  });
  const other = await second.start();
  t.after(() => second.stop());
  assert.notEqual(port, other);
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, tokenOrigin = origin) =>
    fetch(base + url, {
      method: "POST",
      headers: { Origin: tokenOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await (await fetch(base + "/healthz")).json()).app, "comind");
  assert.equal((await post("/pair", {}, "https://evil.example")).status, 403);
  assert.equal((await post("/pair", {})).status, 200);
  assert.equal(data.extensionPaired, true);
  assert.equal((await post("/pair", {})).status, 410);
  srv.armPairing();
  assert.equal((await post("/pair", {})).status, 200);
  assert.equal((await post("/pair", {})).status, 410);
  assert.equal((await post("/dom?t=wrong", { text: "q" })).status, 401);
  assert.equal((await post("/dom?t=test-token", { text: "  " })).status, 400);
  assert.equal(
    (
      await post("/dom?t=test-token", {
        text: "题目",
        title: "Test",
        url: "https://example.com",
      })
    ).status,
    200,
  );
  assert.equal(payloads.length, 1);
  assert.equal(
    (await fetch(base + "/status?t=wrong", { headers: { Origin: origin } }))
      .status,
    401,
  );
});

test("deleting a resumed session stops its remaining queued questions", async (t) => {
  const store = setup(t);
  model(store);
  let resolve;
  const service = new Service(
    store,
    () => {},
    () => new Promise((r) => (resolve = r)),
  );
  const s = service.create();
  await service.execute({ type: "session:pause", id: s.id });
  for (const text of ["one", "two"])
    await service.capture({ title: text, url: "https://example.com", text });
  const pending = service.resume(s.id);
  await service.execute({ type: "session:delete", id: s.id });
  resolve(answer);
  await pending;
  assert.equal(store.data.sessions.length, 0);
  assert.equal(store.data.activeSessionId, null);
});
test("invalid nested persisted data restores clean defaults after backup", (t) => {
  const store = setup(t);
  const broken = { ...store.data, sessions: [{ id: "broken" }] };
  fs.writeFileSync(store["file"], JSON.stringify(broken));
  const next = new Store(store["file"], cipher);
  assert.deepEqual(next.data.sessions, []);
  assert.ok(next.warning);
});
test("non-JSON success response never leaks service response contents", async (t) => {
  const base = await server(t, (_req, res) =>
    res.end("API key secret-should-not-appear"),
  );
  await assert.rejects(
    callModel(
      { protocol: "openai", baseUrl: base, apiKey: "key", model: "m" },
      "s",
      "u",
      new AbortController().signal,
    ),
    (error) =>
      error.message.includes("非 JSON") && !error.message.includes("secret"),
  );
});

test("quit shortcut upgrades old settings without overriding custom or disabled bindings", (t) => {
  const store = setup(t);
  assert.equal(store.data.preferences.shortcuts.quit, "Control+C");
  delete store.data.preferences.shortcuts.quit;
  store.save();
  let loaded = new Store(store["file"], cipher);
  assert.equal(loaded.data.preferences.shortcuts.quit, "Control+C");
  delete loaded.data.preferences.shortcuts.quit;
  loaded.data.preferences.shortcuts.screenshot = "Control+C";
  loaded.save();
  loaded = new Store(store["file"], cipher);
  assert.equal(loaded.data.preferences.shortcuts.quit, "");
  assert.equal(loaded.data.preferences.shortcuts.screenshot, "Control+C");
  loaded.data.preferences.shortcuts.quit = "Control+Alt+Q";
  loaded.save();
  loaded = new Store(store["file"], cipher);
  assert.equal(loaded.data.preferences.shortcuts.quit, "Control+Alt+Q");
  loaded.data.preferences.shortcuts.quit = "";
  loaded.save();
  assert.equal(new Store(store["file"], cipher).data.preferences.shortcuts.quit, "");
});
