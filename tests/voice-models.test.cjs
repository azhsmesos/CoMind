const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");
const { Store } = require("../dist-electron/electron/store");
const { Service } = require("../dist-electron/electron/service");
const { Voice } = require("../dist-electron/electron/voice");
const { MockVoice } = require("../dist-electron/electron/mock-voice");
const { QwenAsr } = require("../dist-electron/electron/qwen-asr");
const { VOICE_MODEL, voiceEndpoint } = require("../dist-electron/shared/voice");
const cipher = { available: () => true, encrypt: s => Buffer.from(s).toString("base64"), decrypt: s => Buffer.from(s, "base64").toString() };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(check) {
  for (let i = 0; i < 200 && !check(); i++) await sleep(5);
  assert.ok(check(), "condition timed out");
}
function storeFor(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-models-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.json");
  return { store: new Store(file, cipher), file };
}
test("legacy voice config defaults to Qwen; selected model and encrypted key survive restart; invalid selection is atomic", t => {
  const { store, file } = storeFor(t);
  store.saveVoice("workspace", "synthetic-credential");
  delete store.data.voice.model;
  store.save();
  const restored = new Store(file, cipher);
  assert.equal(restored.voiceConfig().model, VOICE_MODEL);
  for (const model of ["fun-asr-realtime", "paraformer-realtime-v2", VOICE_MODEL]) {
    restored.saveVoice("workspace", "", model);
    assert.equal(new Store(file, cipher).voiceConfig().model, model);
    assert.equal(new Store(file, cipher).voiceKey(), "synthetic-credential");
    assert.ok(!fs.readFileSync(file, "utf8").includes("synthetic-credential"));
  }
  const before = fs.readFileSync(file, "utf8");
  for (const invalid of ["whisper-1", "toString", "fun-asr-realtime?key=x", null, 3])
    assert.throws(() => restored.saveVoice("workspace", "replacement", invalid));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(voiceEndpoint("workspace", "fun-asr-realtime"), /\/inference$/);
  assert.match(voiceEndpoint("workspace", VOICE_MODEL), /\/realtime\?model=qwen3-asr-flash-realtime$/);
});
test("connection test, meeting start and microphone all pass the saved model; switching cancels pending tests", async t => {
  const { store } = storeFor(t);
  store.saveVoice("workspace", "synthetic-key", "paraformer-realtime-v2");
  store.saveModel({ id: "answer", name: "answer", provider: "custom", protocol: "openai", baseUrl: "http://127.0.0.1:1", model: "test", apiKey: "synthetic" });
  const service = new Service(store, () => {});
  const args = [];
  const factory = () => ({ connect: async (...a) => { args.push(a); }, close() {}, send() {} });
  const audio = { async start() {}, stop() {} };
  const voice = new Voice(service, audio, factory);
  t.after(() => { voice.dispose(); service.dispose(); });
  await voice.test();
  await voice.start();
  voice.stop();
  const mock = { service, runtime: service.runtime.mock, session: () => ({ status: "ongoing", turns: [{ id: "turn", status: "waiting", draft: "" }] }) };
  const mic = new MockVoice(mock, audio, factory);
  t.after(() => mic.stop());
  await mic.listen("mock");
  mic.stop();
  assert.deepEqual(args.map(a => a[2]), Array(3).fill("paraformer-realtime-v2"));
  let cancel;
  const pending = new Voice(service, audio, () => ({ connect: () => new Promise((_r, reject) => { cancel = reject; }), close: () => cancel?.(new Error("cancelled")), send() {} }));
  t.after(() => pending.dispose());
  const rejected = assert.rejects(pending.test(), /cancelled/);
  pending.stop();
  await rejected;
});
for (const model of ["fun-asr-realtime", "paraformer-realtime-v2"]) {
  test(`${model}: binary PCM, task lifecycle, normalized results, heartbeat/dedupe, redacted errors`, async t => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    t.after(() => { for (const ws of server.clients) ws.terminate(); server.close(); });
    let socket, task;
    const frames = [], commands = [], events = [], errors = [];
    server.on("connection", (ws, req) => {
      socket = ws;
      assert.equal(req.headers.authorization, "Bearer synthetic");
      ws.on("message", (raw, binary) => {
        if (binary) { frames.push(raw); return; }
        const command = JSON.parse(raw);
        commands.push(command);
        if (command.header.action === "run-task") {
          task = command.header.task_id;
          ws.send(JSON.stringify({ header: { task_id: task, event: "task-started" } }));
        }
      });
    });
    const client = new QwenAsr({ event: e => events.push(e), disconnected: e => errors.push(e) }, (_workspace, selected) => {
      assert.equal(selected, model);
      return `ws://127.0.0.1:${server.address().port}`;
    });
    t.after(() => client.close());
    await client.connect("workspace", "synthetic", model);
    assert.equal(commands[0].payload.model, model);
    assert.deepEqual(commands[0].payload.parameters, { format: "pcm", sample_rate: 16000, semantic_punctuation_enabled: false, max_sentence_silence: 800, heartbeat: true });
    client.send(new Uint8Array([0, 1, 2, 3]));
    await until(() => frames.length === 1);
    assert.deepEqual([...frames[0]], [0, 1, 2, 3]);
    const send = (sentence, taskId = task) => socket.send(JSON.stringify({ header: { event: "result-generated", task_id: taskId }, payload: { output: { sentence } } }));
    send({ heartbeat: true });
    send({ text: "wrong task", begin_time: 0, sentence_end: true }, "old-task");
    const identity = model === "fun-asr-realtime" ? { sentence_id: 1 } : {};
    send({ ...identity, text: "", begin_time: 0, sentence_end: false, sentence_begin: true });
    send({ ...identity, text: "正在说话", begin_time: 0, sentence_end: false });
    const final = { ...identity, text: "完整问题？", begin_time: model === "fun-asr-realtime" ? 170 : 0, sentence_end: true };
    send(final); send(final);
    await until(() => events.some(e => e.transcript === "完整问题？"));
    await sleep(15);
    assert.equal(events.filter(e => e.type.endsWith("speech_started")).length, 1);
    assert.equal(events.filter(e => e.type.endsWith("completed")).length, 1);
    assert.equal(events[0].item_id, events.at(-1).item_id);
    client.close();
    await until(() => commands.some(c => c.header.action === "finish-task"));
    assert.equal(errors.length, 0);
    // A new task with the same sentence index must have a distinct identity.
    const firstId = events.at(-1).item_id;
    await client.connect("workspace", "synthetic", model);
    send(final);
    await until(() => events.filter(e => e.type.endsWith("completed")).length === 2);
    assert.notEqual(events.at(-1).item_id, firstId);
    socket.send(JSON.stringify({ header: { event: "task-failed", task_id: task, error_code: "InvalidApiKey", error_message: "synthetic private body" } }));
    await until(() => errors.length === 1);
    assert.equal(errors[0].fatal, true);
    assert.ok(!errors[0].message.includes("private body"));
  });
}
