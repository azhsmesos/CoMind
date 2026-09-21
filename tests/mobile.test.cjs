const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { once } = require("node:events");
const http = require("node:http");
const { WebSocket } = require("ws");
const {
  MobileServer,
  publicRound,
} = require("../dist-electron/electron/mobile-server");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = {
  kind: "algorithm",
  summary: "答案",
  approach: "简短思路",
  code: "class Solution {}",
  problem: "",
  clarify: "",
  walkthrough: "",
  time_complexity: "O(n)",
  space_complexity: "O(1)",
};
const round = (i, source = "manual") => ({
  id: `r${i}`,
  question: `问题${i}`,
  source,
  createdAt: new Date(1700000000000 + i * 1000).toISOString(),
  status: "done",
  answer,
  userSpeech: "PRIVATE_SPEECH",
  image: "PRIVATE_IMAGE",
  url: "PRIVATE_URL",
  secret: "PRIVATE_KEY",
});
async function setup(t, count = 2) {
  const session = {
    id: "s1",
    name: "测试会话",
    status: "ongoing",
    rounds: Array.from({ length: count }, (_, i) => round(i)),
    pending: [],
    resume: "PRIVATE_RESUME",
  };
  const data = {
    activeSessionId: session.id,
    sessions: [session],
    apiKey: "PRIVATE_KEY",
  };
  const addresses = [{ name: "test", address: "127.0.0.1" }];
  const server = new MobileServer(
    () => data,
    path.resolve("dist-mobile"),
    () => {},
    () => addresses,
  );
  await server.start();
  t.after(() => server.stop());
  const url = new URL(server.state.url);
  const token = url.hash.slice(1);
  const origin = url.origin;
  const headers = { Authorization: `Bearer ${token}` };
  async function connect(value = token) {
    const ws = new WebSocket(origin.replace("http", "ws") + "/events", {
      origin,
    });
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(raw)));
    t.after(() => ws.terminate());
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "auth", token: value }));
    return { ws, events };
  }
  return { server, data, session, addresses, origin, token, headers, connect };
}
async function until(f) {
  for (let i = 0; i < 100; i++) {
    if (f()) return;
    await wait(10);
  }
  assert.fail("timed out");
}
test("mobile whitelist omits private fields, raw errors and nested unexpected answer fields", () => {
  const r = {
    ...round(0),
    status: "error",
    error: "Bearer SECRET",
    answer: { ...answer, apiKey: "PRIVATE_KEY" },
  };
  const text = JSON.stringify(publicRound(r));
  assert(!/PRIVATE|SECRET|Bearer/.test(text));
  assert(text.includes("生成失败"));
  assert(text.includes("class Solution"));
});
test("mobile serves isolated assets and enforces host, origin, token, readonly and pagination", async (t) => {
  const s = await setup(t, 112);
  assert.equal((await fetch(s.origin)).status, 200);
  assert.equal((await fetch(s.origin + "/api/rounds?session=s1")).status, 401);
  assert.equal(
    (
      await fetch(s.origin + "/api/rounds?session=s1", {
        headers: { Authorization: "Bearer invalid" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(s.origin + "/api/rounds?session=s1", {
        headers: { ...s.headers, Origin: "http://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve) =>
      http.get(s.origin + "/", { headers: { Host: "evil.test" } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }),
    ),
    403,
  );
  assert.equal(
    (
      await fetch(s.origin + "/api/rounds?session=s1", {
        method: "POST",
        headers: s.headers,
      })
    ).status,
    405,
  );
  for (const file of [
    "/desktop-state.json",
    "/api/command",
    "/assets/../../package.json",
    "/src/main.tsx",
  ])
    assert.equal((await fetch(s.origin + file)).status, 404);
  const first = await (
    await fetch(s.origin + "/api/rounds?session=s1", { headers: s.headers })
  ).json();
  assert.equal(first.rounds.length, 50);
  assert.equal(first.before, 62);
  assert.equal(first.rounds[0].id, "r62");
  assert(!JSON.stringify(first).includes("PRIVATE"));
  const second = await (
    await fetch(s.origin + "/api/rounds?session=s1&before=62", {
      headers: s.headers,
    })
  ).json();
  assert.equal(second.rounds[0].id, "r12");
  assert.equal(second.before, 12);
  assert.equal(
    (
      await fetch(s.origin + "/api/rounds?session=s1&before=-1", {
        headers: s.headers,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(s.origin + "/api/rounds?session=other", {
        headers: s.headers,
      })
    ).status,
    409,
  );
});
test("unauthenticated and wrong-origin WebSockets receive no meeting data", async (t) => {
  const s = await setup(t);
  const { ws, events } = await s.connect("bad");
  await once(ws, "close");
  assert.deepEqual(events, []);
  const bad = new WebSocket(s.origin.replace("http", "ws") + "/events", {
    origin: "http://evil.test",
  });
  const error = await new Promise((resolve) => bad.on("error", resolve));
  assert.match(error.message, /403/);
});
test("realtime deltas include all question sources, suppress duplicate/irrelevant changes and resync on reconnect", async (t) => {
  const s = await setup(t);
  const { ws, events } = await s.connect();
  await until(() => events.length === 1);
  assert.equal(events[0].type, "snapshot");
  assert.equal(s.server.state.clients, 1);
  s.data.volume = 0.8;
  s.server.publish();
  await wait(90);
  assert.equal(events.length, 1);
  for (const source of ["manual", "screenshot", "voice", "browser"]) {
    const r = round(s.session.rounds.length, source);
    r.status = "generating";
    delete r.answer;
    s.session.rounds.push(r);
    s.server.publish();
    await until(() => events.at(-1).rounds?.[0]?.id === r.id);
    assert.equal(events.at(-1).rounds[0].status, "generating");
    r.status = "done";
    r.answer = answer;
    s.server.publish();
    await until(() => events.at(-1).rounds?.[0]?.status === "done");
    assert.equal(events.at(-1).rounds[0].source, source);
  }
  s.server.publish();
  const count = events.length;
  await wait(90);
  assert.equal(events.length, count);
  ws.close();
  await once(ws, "close");
  s.session.rounds.push(round(99));
  s.server.publish();
  await wait(90);
  const next = await s.connect();
  await until(() => next.events.length);
  assert.equal(next.events[0].rounds.at(-1).id, "r99");
});
test("session switch, pause and deletion update the phone without exposing old sessions", async (t) => {
  const s = await setup(t);
  const c = await s.connect();
  await until(() => c.events.length);
  s.session.status = "paused";
  s.server.publish();
  await until(() => c.events.at(-1).session?.status === "paused");
  s.session.status = "completed";
  s.data.activeSessionId = null;
  s.server.publish();
  await until(() => c.events.at(-1).session?.status === "completed");
  assert.equal(c.events.at(-1).session.id, "s1");
  s.data.sessions.push({
    id: "s2",
    name: "new",
    status: "ongoing",
    rounds: [round(9)],
    pending: [],
  });
  s.data.activeSessionId = "s2";
  s.server.publish();
  await until(() => c.events.at(-1).session?.id === "s2");
  assert.equal(c.events.at(-1).type, "snapshot");
  assert.equal(c.events.at(-1).rounds.length, 1);
  s.data.sessions = [];
  s.server.publish();
  await until(() => c.events.at(-1).session === null);
  assert.deepEqual(c.events.at(-1).rounds, []);
});
test("reset/stop invalidate old links and disconnect clients; restart starts private", async (t) => {
  const s = await setup(t);
  const c = await s.connect();
  await until(() => c.events.length);
  s.server.reset();
  await once(c.ws, "close");
  assert.equal(c.events.at(-1).type, "closed");
  assert.equal(
    (await fetch(s.origin + "/api/rounds?session=s1", { headers: s.headers }))
      .status,
    401,
  );
  const next = await s.connect(new URL(s.server.state.url).hash.slice(1));
  await until(() => next.events.length);
  s.server.stop();
  await once(next.ws, "close");
  assert.equal(s.server.state.enabled, false);
  assert.equal(s.server.state.url, undefined);
  assert.equal(
    new MobileServer(
      () => s.data,
      path.resolve("dist-mobile"),
      () => {},
    ).state.enabled,
    false,
  );
});
test("five-page limit and read-only WebSocket enforcement", async (t) => {
  const s = await setup(t);
  const cs = [];
  for (let i = 0; i < 5; i++) {
    const c = await s.connect();
    cs.push(c);
    await until(() => c.events.length);
  }
  assert.equal(s.server.state.clients, 5);
  const extra = new WebSocket(s.origin.replace("http", "ws") + "/events", {
    origin: s.origin,
  });
  const error = await new Promise((resolve) => extra.on("error", resolve));
  assert.match(error.message, /403/);
  cs[0].ws.send(
    JSON.stringify({ type: "question:add", text: "do not execute" }),
  );
  const [code] = await once(cs[0].ws, "close");
  assert.equal(code, 4003);
  assert.equal(s.session.rounds.length, 2);
});
test("network address loss stops listening and requires a new explicit start", async (t) => {
  const s = await setup(t);
  const c = await s.connect();
  await until(() => c.events.length);
  s.addresses.splice(0);
  s.server.networkTimer._onTimeout();
  await once(c.ws, "close");
  assert.equal(s.server.state.enabled, false);
  assert.match(s.server.state.error, /网络地址已变化/);
});
