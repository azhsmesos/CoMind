const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function worker({
  running = true,
  url = "https://example.com/problem",
  text = "A valid problem statement",
  paired = false,
} = {}) {
  const local = paired ? { pairing: { token: "token", port: 4123 } } : {};
  const session = {};
  let message, command;
  const delivered = [];
  const storage = (obj) => ({
    get: async (key) => ({ [key]: obj[key] }),
    set: async (values) => Object.assign(obj, values),
    remove: async (key) => {
      delete obj[key];
    },
  });
  const chrome = {
    storage: { local: storage(local), session: storage(session) },
    tabs: { query: async () => [{ id: 1, url }] },
    scripting: {
      executeScript: async () => [{ result: { title: "Title", url, text } }],
    },
    commands: { onCommand: { addListener: (fn) => (command = fn) } },
    runtime: {
      onMessage: { addListener: (fn) => (message = fn) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
  };
  const fetch = async (address, options) => {
    if (!running) throw new Error("offline");
    const parsed = new URL(address);
    if (parsed.port !== "4123") throw new Error("offline");
    if (parsed.pathname === "/healthz")
      return { ok: true, json: async () => ({ ok: true, app: "comind" }) };
    if (parsed.pathname === "/pair")
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "token", port: 4123 }),
      };
    if (parsed.pathname === "/status")
      return { ok: parsed.searchParams.get("t") === "token" };
    if (parsed.pathname === "/dom") {
      delivered.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    }
    throw new Error("unexpected");
  };
  vm.runInNewContext(
    fs
      .readFileSync("extension/service-worker.js", "utf8")
      .replace("export async function pair", "async function pair"),
    {
      chrome,
      fetch,
      AbortSignal,
      URL,
      console,
      Date,
      setTimeout,
      clearTimeout,
    },
  );
  return {
    local,
    session,
    delivered,
    send: (type) => new Promise((resolve) => message({ type }, {}, resolve)),
    command: () => command("send-page"),
  };
}
test("extension action and keyboard both send real page text and clear stale errors", async () => {
  const w = worker();
  w.session.lastError = { at: Date.now(), error: "old" };
  const result = await w.send("send");
  assert.equal(result.ok, true);
  assert.equal(w.delivered[0].text, "A valid problem statement");
  assert.equal(w.session.lastError, undefined);
  await w.command();
  assert.equal(w.delivered.length, 2);
  assert.equal((await w.send("status")).paired, true);
});
test("extension distinguishes offline desktop even with a saved pairing", async () => {
  const w = worker({ running: false, paired: true });
  const s = await w.send("status");
  assert.equal(s.running, false);
  assert.equal(s.paired, false);
  const result = await w.send("send");
  assert.equal(result.ok, false);
  assert.match(result.error, /未启动/);
});
test("browser internal pages and empty pages never generate a request", async () => {
  for (const opts of [{ url: "chrome://extensions" }, { text: "" }]) {
    const w = worker(opts);
    const r = await w.send("send");
    assert.equal(r.ok, false);
    assert.equal(w.delivered.length, 0);
    assert.ok(w.session.lastError.error);
  }
});
