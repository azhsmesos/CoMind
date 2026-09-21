const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageFor(app, match) {
  for (let i = 0; i < 200; i++) {
    const p = app.windows().find((p) => match(p.url()));
    if (p) {
      p.setDefaultTimeout(10000);
      return p;
    }
    await wait(50);
  }
  throw new Error("page missing");
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-mobile-"));
  const answer = {
    kind: "algorithm",
    summary: "用哈希表查找目标值。",
    approach: "遍历数组，用哈希表记录已有元素，一次遍历得到答案。",
    code: "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            if (seen.containsKey(target - nums[i])) return new int[] {seen.get(target - nums[i]), i};\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}",
    problem: "",
    clarify: "",
    walkthrough: "",
    time_complexity: "O(n)",
    space_complexity: "O(n)",
  };
  const api = http.createServer((req, res) => {
    req.resume();
    req.on("end", () =>
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(answer) } }],
          }),
        );
      }, 600),
    );
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  let app;
  try {
    const env = {
      ...process.env,
      NODE_ENV: "test",
      COMIND_E2E: "1",
      COMIND_TEST_DATA: dir,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ["."], env });
    const desktop = await pageFor(app, (u) => u.endsWith("/dist/index.html"));
    await desktop
      .getByRole("heading", { name: "智能工作台", exact: true })
      .waitFor();
    await app.evaluate(() => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const {
        MobileServer,
      } = require("./dist-electron/electron/mobile-server.js");
      const start = MobileServer.prototype.start;
      MobileServer.prototype.start = function () {
        this.addresses = () => [{ name: "测试网络", address: "127.0.0.1" }];
        globalThis.fixtureMobile = this;
        return start.call(this);
      };
      MobileServer.prototype.refresh = function () {
        this.state.addresses = [{ name: "测试网络", address: "127.0.0.1" }];
        this.changed();
      };
    });
    await desktop.evaluate(async (baseUrl) => {
      const s = await window.api.getState();
      await window.api.command({
        type: "preferences:save",
        preferences: {
          ...s.preferences,
          shortcuts: Object.fromEntries(
            Object.keys(s.preferences.shortcuts).map((k) => [k, ""]),
          ),
        },
      });
      await window.api.command({
        type: "model:save",
        config: {
          id: "mobile-model",
          name: "测试模型",
          provider: "custom",
          protocol: "openai",
          baseUrl,
          model: "fake",
          apiKey: "SECRET_KEY",
        },
      });
      await window.api.command({
        type: "session:create",
        name: "手机联动测试",
      });
      await window.api.command({
        type: "materials:save",
        materials: {
          resume: "PRIVATE_RESUME",
          jd: "PRIVATE_JD",
          answers: [],
          scripts: [],
        },
      });
    }, `http://127.0.0.1:${api.address().port}`);
    await desktop
      .getByRole("button", { name: "手机查看", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "开启共享", exact: true })
      .click();
    await expect(desktop.getByAltText("手机查看二维码")).toBeVisible();
    const share = await desktop.evaluate(
      async () => (await window.api.getState()).runtime.mobile,
    );
    assert(share.enabled);
    assert(share.url.includes("#"));
    const overlayBefore = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes("#overlay"),
      );
      globalThis.fixtureOverlay = w;
      globalThis.fixtureMoves = [];
      for (const name of [
        "show",
        "hide",
        "showInactive",
        "focus",
        "setBounds",
        "setIgnoreMouseEvents",
      ]) {
        const original = w[name].bind(w);
        w[name] = (...args) => {
          globalThis.fixtureMoves.push(name);
          return original(...args);
        };
      }
      return { bounds: w.getBounds(), visible: w.isVisible() };
    });
    // An ordinary sandboxed Chromium page with no preload stands in for a phone browser.
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = new BrowserWindow({
        show: false,
        width: 390,
        height: 844,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "mobile-e2e-browser",
        },
      });
      globalThis.fixturePhone = w;
      await w.loadURL(url);
    }, share.url);
    const phone = await pageFor(app, (u) =>
      u.startsWith(share.url.split("/#")[0]),
    );
    const errors = [];
    phone.on("pageerror", (e) => errors.push(e.message));
    await expect(phone.getByText("已连接 · 实时同步")).toBeVisible();
    assert.equal(await phone.evaluate(() => location.hash), "");
    assert.equal(await phone.evaluate(() => typeof window.api), "undefined");
    await desktop.evaluate(() => {
      void window.api.command({ type: "question:add", text: "实现两数之和" });
    });
    await expect(phone.getByText("正在回答…", { exact: true })).toBeVisible();
    await expect(phone.locator("pre")).toContainText("class Solution");
    await expect(phone.getByText("正在回答…", { exact: true })).toHaveCount(0);
    assert(
      !(await phone
        .locator("body")
        .innerText()
        .then((t) => t.includes("SECRET_KEY") || t.includes("PRIVATE_RESUME"))),
    );
    assert(
      await phone.locator("pre").evaluate((e) => e.scrollWidth > e.clientWidth),
    );
    await phone.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      }),
    );
    await phone.getByRole("button", { name: "复制代码", exact: true }).click();
    await expect(phone.getByText("已选中内容，请长按并选择复制")).toBeVisible();
    assert(
      (await phone.evaluate(() => getSelection().toString())).includes(
        "class Solution",
      ),
    );
    await phone.getByRole("button", { name: "关闭提示" }).click();
    // Populate a long session and force reconnection to verify initial paging and scroll preservation.
    await app.evaluate((_, answer) => {
      const server = globalThis.fixtureMobile;
      const data = server.getData();
      const s = data.sessions.find((s) => s.id === data.activeSessionId);
      s.rounds[0].createdAt = new Date(Date.now() - 120000).toISOString();
      for (let i = 0; i < 60; i++)
        s.rounds.push({
          id: "fixture-" + i,
          question: "历史问题 " + i,
          createdAt: new Date(Date.now() - (60 - i) * 1000).toISOString(),
          source: ["voice", "screenshot", "manual"][i % 3],
          status: "done",
          answer,
          userSpeech: "",
          image: "PRIVATE_IMAGE",
        });
      server.publishNow();
      for (const ws of server.sockets.clients) ws.terminate();
    }, answer);
    await expect(phone.getByText("已连接 · 实时同步")).toBeVisible({
      timeout: 15000,
    });
    await expect(phone.locator("article")).toHaveCount(50);
    await phone.evaluate(() => scrollTo(0, 0));
    await phone.getByRole("button", { name: "查看更早问答" }).click();
    await expect(phone.locator("article")).toHaveCount(61);
    await phone.evaluate(() => scrollTo(0, 200));
    await wait(100);
    const oldScroll = await phone.evaluate(() => scrollY);
    await desktop.evaluate(() => {
      void window.api.command({
        type: "question:add",
        text: "新问题，不打断阅读",
      });
    });
    await expect(
      phone.getByRole("button", { name: "有新答案 ↓" }),
    ).toBeVisible();
    await expect(phone.locator("article").last().locator("pre")).toContainText(
      "class Solution",
    );
    assert(Math.abs((await phone.evaluate(() => scrollY)) - oldScroll) < 10);
    await phone.getByRole("button", { name: "有新答案 ↓" }).click();
    await expect(phone.getByRole("button", { name: "有新答案 ↓" })).toHaveCount(
      0,
    );
    // Closing the desktop to tray does not close the server; native overlay stays untouched.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("/dist/index.html"))
        .hide(),
    );
    await desktop.evaluate(() => {
      void window.api.command({ type: "question:add", text: "托盘中继续同步" });
    });
    await expect(
      phone.getByRole("heading", { name: "托盘中继续同步", exact: true }),
    ).toBeVisible();
    await expect(phone.locator("article").last().locator("pre")).toContainText(
      "class Solution",
    );
    const after = await app.evaluate(() => ({
      bounds: globalThis.fixtureOverlay.getBounds(),
      visible: globalThis.fixtureOverlay.isVisible(),
      moves: globalThis.fixtureMoves,
    }));
    assert.deepEqual(after.bounds, overlayBefore.bounds);
    assert.equal(after.visible, overlayBefore.visible);
    assert.deepEqual(after.moves, []);
    await desktop.evaluate(async () => {
      const s = await window.api.getState();
      await window.api.command({
        type: "session:pause",
        id: s.activeSessionId,
      });
    });
    await expect(phone.getByText("已暂停 · 只读")).toBeVisible();
    await phone.reload();
    await expect(phone.getByText("已连接 · 实时同步")).toBeVisible();
    await expect(phone.locator("article")).toHaveCount(50);
    fs.mkdirSync("test-results", { recursive: true });
    await phone.screenshot({ path: "test-results/mobile-reader.png" });
    await desktop.evaluate(async () => {
      const s = await window.api.getState();
      await window.api.command({ type: "session:end", id: s.activeSessionId });
    });
    await expect(phone.getByText("已结束 · 只读")).toBeVisible();
    assert.equal(await phone.locator("article").count(), 50);
    await desktop.evaluate(() =>
      window.api.command({ type: "session:create", name: "切换后的会话" }),
    );
    await expect(
      phone.getByRole("heading", { name: "切换后的会话" }),
    ).toBeVisible();
    await expect(phone.locator("article")).toHaveCount(0);
    await app.evaluate(() => {
      const server = globalThis.fixtureMobile;
      const data = server.getData();
      data.sessions.find(s => s.id === data.activeSessionId).rounds.push({
        id: "ordinary-answer", question: "介绍一下线程池", source: "voice", status: "done",
        createdAt: new Date().toISOString(), userSpeech: "", answer: {
          kind: "answer", summary: "线程池复用线程并管理任务队列。", approach: "不应复制这个字段",
          code: "不应显示为算法代码", problem: "", clarify: "", walkthrough: "", time_complexity: "", space_complexity: ""
        }
      });
      server.publish();
    });
    await expect(phone.getByText("线程池复用线程并管理任务队列。")).toBeVisible();
    await expect(phone.getByRole("button", {name: "复制代码", exact: true})).toHaveCount(0);
    await phone.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async text => { window.copiedAnswer = text; } }
    }));
    await phone.getByRole("button", {name: "复制答案", exact: true}).click();
    assert.equal(await phone.evaluate(() => window.copiedAnswer), "线程池复用线程并管理任务队列。");
    await desktop.evaluate(async () => { const s = await window.api.getState(); await window.api.command({type: "session:delete", id: s.activeSessionId}); });
    await expect(phone.locator("article")).toHaveCount(0);
    await desktop.evaluate(() => window.api.command({ type: "mobile:reset" }));
    await expect(phone.getByText("访问链接已重置，请重新扫码")).toBeVisible();
    await phone.reload();
    await expect(
      phone.getByText("请扫描电脑上的二维码或打开完整共享链接"),
    ).toBeVisible();
    await desktop.evaluate(() => window.api.command({ type: "mobile:stop" }));
    assert.equal(
      (await desktop.evaluate(() => window.api.getState())).runtime.mobile
        .enabled,
      false,
    );
    assert.deepEqual(errors, []);
    assert(
      !fs
        .readFileSync(path.join(dir, "desktop-state.json"), "utf8")
        .includes(new URL(share.url).hash.slice(1)),
    );
    await app.close();
    app = null;
    app = await electron.launch({ args: ["."], env });
    const restored = await pageFor(app, (u) => u.endsWith("/dist/index.html"));
    assert.equal(
      (await restored.evaluate(() => window.api.getState())).runtime.mobile
        .enabled,
      false,
    );
    console.log(
      "PASS mobile E2E: QR, readonly isolated page, live answers, paging, scroll, reconnect, copy fallback, tray, overlay invariants, reset and restart",
    );
  } finally {
    if (app) await app.close();
    api.closeAllConnections();
    await new Promise((r) => api.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
