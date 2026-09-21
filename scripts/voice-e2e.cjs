const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const { once } = require("node:events");
async function mainPage(app) {
  for (let i = 0; i < 150; i++) {
    const page = app
      .windows()
      .find((p) => p.url().endsWith("/dist/index.html"));
    if (page) {
      page.setDefaultTimeout(15000);
      await page
        .getByRole("heading", { name: "智能工作台", exact: true })
        .waitFor();
      return page;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Main page did not load");
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-voice-e2e-"));
  const modelRequests = [];
  const sockets = new Set();
  let pcm = 0;
  let failNextTest = false;
  const selectedModels = [];
  const asr = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(asr, "listening");
  asr.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (raw, binary) => {
      if (binary) { pcm++; return; }
      const msg = JSON.parse(raw);
      if (msg.header?.action === "run-task") {
        selectedModels.push(msg.payload.model);
        ws.send(JSON.stringify({ header: { event: "task-started", task_id: msg.header.task_id } }));
      }
      if (msg.type === "session.update") {
        ws.send(JSON.stringify(failNextTest
          ? { type: "error", error: { code: "invalid_api_key" } }
          : { type: "session.updated" }));
        failNextTest = false;
      }
      if (msg.type === "input_audio_buffer.append") pcm++;
      if (msg.type === "session.finish")
        ws.send(JSON.stringify({ type: "session.finished" }));
    });
  });
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (b) => (raw += b));
    req.on("end", () => {
      const body = JSON.parse(raw);
      modelRequests.push(body);
      const classifier = body.messages[0].content.includes("会议提问分类器");
      const answer = classifier
        ? { kind: "question", question: "如何实现线程安全的单例？" }
        : Object.fromEntries(
            [
              "summary",
              "problem",
              "clarify",
              "approach",
              "code",
              "walkthrough",
              "time_complexity",
              "space_complexity",
            ].map((k) => [
              k,
              k === "summary" ? "使用静态内部类实现延迟加载和线程安全。" : "",
            ]),
          );
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let app;
  try {
    const env = {
      ...process.env,
      NODE_ENV: "test",
      COMIND_E2E: "1",
      COMIND_TEST_DATA: dir,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    console.log("launching voice test");
    app = await electron.launch({ args: ["."], env });
    app.process().stderr.on("data", (b) => process.stderr.write(b));
    const page = await mainPage(app);
    await app.evaluate(({ systemPreferences }, endpoint) => {
      systemPreferences.getMediaAccessStatus = () => "granted";
      const localRequire = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const { QwenAsr } = localRequire("./dist-electron/electron/qwen-asr.js");
      const original = QwenAsr.prototype.connect;
      QwenAsr.prototype.connect = function (...args) {
        this.endpoint = () => endpoint;
        return original.apply(this, args);
      };
    }, `ws://127.0.0.1:${asr.address().port}`);
    // Real hidden renderer + AudioWorklet, with synthetic local media. Never record this computer.
    await app.context().addInitScript(() => {
      if (location.hash !== "#audio-capture") return;
      navigator.mediaDevices.getDisplayMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        await ctx.resume();
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        canvas.getContext("2d").fillRect(0, 0, 2, 2);
        const video = canvas.captureStream(1);
        const stream = new MediaStream([
          ...dst.stream.getAudioTracks(),
          ...video.getVideoTracks(),
        ]);
        window.fixtureContext = ctx;
        window.fixtureStream = stream;
        return stream;
      };
    });
    await page.evaluate(async (baseUrl) => {
      const state = await window.api.getState();
      await window.api.command({
        type: "preferences:save",
        preferences: {
          ...state.preferences,
          shortcuts: Object.fromEntries(
            Object.keys(state.preferences.shortcuts).map((k) => [k, ""]),
          ),
        },
      });
      await window.api.command({
        type: "model:save",
        config: {
          id: "voice-test-model",
          name: "测试回答",
          provider: "custom",
          protocol: "openai",
          baseUrl,
          model: "fake",
          apiKey: "test",
        },
      });
    }, `http://127.0.0.1:${server.address().port}`);
    console.log("configure voice");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await page
      .getByLabel("百炼 Workspace ID", { exact: true })
      .fill("workspace-test");
    await page
      .getByLabel("语音 API Key", { exact: true })
      .fill("fake-speech-key");
    await page
      .getByRole("button", { name: "保存语音连接", exact: true })
      .click();
    await page
      .getByRole("button", { name: "语音连接已保存", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("语音 API Key", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByRole("button", { name: "测试语音连接", exact: true })
      .click();
    await page.getByText("百炼语音连接成功", { exact: true }).waitFor();
    const success = page.getByRole("status", { name: "语音连接测试结果" });
    await expect(success).toContainText("连接测试成功：qwen3-asr-flash-realtime");
    await expect(success).toBeInViewport();
    failNextTest = true;
    await page.getByRole("button", { name: "测试语音连接", exact: true }).click();
    await expect(page.getByRole("alert", { name: "语音连接测试结果" })).toContainText("连接测试失败：百炼语音鉴权失败");
    await expect(success).toHaveCount(0);
    for (const model of ["fun-asr-realtime", "paraformer-realtime-v2", "qwen3-asr-flash-realtime"]) {
      await page.getByLabel("语音识别模型", { exact: true }).selectOption(model);
      await expect(page.getByLabel("语音连接测试结果", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "测试语音连接", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "保存语音连接", exact: true }).click();
      await expect.poll(() => page.evaluate(async () => (await window.api.getState()).voiceConfig.model)).toBe(model);
      await page.getByRole("button", { name: "测试语音连接", exact: true }).click();
      await expect(page.getByRole("button", { name: "测试语音连接", exact: true })).toBeEnabled();
      await expect(success).toContainText(`连接测试成功：${model}`);
    }
    assert.deepEqual(selectedModels, ["fun-asr-realtime", "paraformer-realtime-v2"]);
    await page.getByRole("button", { name: "智能工作台", exact: true }).click();
    await page.evaluate(async () => {
      await window.api.command({ type: "overlay:toggle" });
      await window.api.command({ type: "overlay:penetration" });
    });
    const original = await app.evaluate(({ BrowserWindow, app }) => {
      global.__voiceWindowOps = [];
      for (const win of BrowserWindow.getAllWindows())
        for (const method of [
          "hide",
          "show",
          "showInactive",
          "focus",
          "setBounds",
        ]) {
          const fn = win[method].bind(win);
          win[method] = (...args) => {
            global.__voiceWindowOps.push(method);
            return fn(...args);
          };
        }
      app.on("browser-window-created", (_e, win) => {
        win.on("show", () => global.__voiceWindowOps.push("capture-show"));
      });
      return BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        bounds: w.getBounds(),
      }));
    });
    console.log("start capture");
    await page
      .getByRole("button", { name: "开始会议识别", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.api.getState()).runtime.voice.status,
          ),
        { timeout: 25000 },
      )
      .toBe("listening");
    await expect.poll(() => pcm).toBeGreaterThan(0);
    const capture = app
      .windows()
      .find((p) => p.url().endsWith("#audio-capture"));
    assert.ok(capture);
    const native = await app.browserWindow(capture);
    assert.equal(await native.evaluate((w) => w.isVisible()), false);
    await native.dispose();
    assert.equal(await capture.evaluate(() => window.api), undefined);
    assert.equal(await page.evaluate(() => window.audioCapture), undefined);
    for (const ws of sockets)
      ws.send(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.text",
          item_id: "1",
          text: "请介绍",
          stash: "单例模式",
        }),
      );
    await page.getByText("请介绍单例模式", { exact: false }).waitFor();
    for (const ws of sockets)
      ws.send(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "1",
          transcript: "如何实现线程安全的单例？",
        }),
      );
    await expect
      .poll(
        () =>
          page.evaluate(
            async () =>
              (await window.api.getState()).sessions[0]?.rounds[0]?.status,
          ),
        { timeout: 15000 },
      )
      .toBe("done");
    assert.equal(modelRequests.length, 2);
    assert.deepEqual(await app.evaluate(() => global.__voiceWindowOps), []);
    for (const win of original) {
      assert.deepEqual(
        await app.evaluate(
          ({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(),
          win.id,
        ),
        win.bounds,
      );
    }
    assert.equal(
      (await page.evaluate(() => window.api.getState())).runtime.clickThrough,
      true,
    );
    assert.ok(
      !JSON.stringify(
        await page.evaluate(() => window.api.getState()),
      ).includes("fake-speech-key"),
    );
    const sessionId = (await page.evaluate(() => window.api.getState()))
      .activeSessionId;
    let rows = await page.evaluate(
      (id) => window.api.transcripts(id),
      sessionId,
    );
    assert.equal(rows.total, 1);
    assert.ok(rows.items[0].roundId);
    fs.mkdirSync("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/voice-live.png" });
    await page
      .getByRole("button", { name: "停止会议识别", exact: true })
      .click();
    await expect.poll(() => capture.isClosed()).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.api.getState()).runtime.voice.status,
        ),
      )
      .toBe("stopped");
    // Saving another model stops the active capture; subsequent starts use it.
    await page.getByRole("button", { name: "开始会议识别", exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.api.getState()).runtime.voice.status)).toBe("listening");
    await page.evaluate(() => window.api.command({ type: "voice:save", workspaceId: "workspace-test", model: "paraformer-realtime-v2" }));
    assert.equal((await page.evaluate(() => window.api.getState())).runtime.voice.status, "stopped");
    // Pause also stops a second recording and does not resume capture automatically.
    await page
      .getByRole("button", { name: "开始会议识别", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.api.getState()).runtime.voice.status,
        ),
      )
      .toBe("listening");
    await page.evaluate(
      (id) => window.api.command({ type: "session:pause", id }),
      sessionId,
    );
    assert.equal(
      (await page.evaluate(() => window.api.getState())).runtime.voice.status,
      "stopped",
    );
    await page.evaluate(
      (id) => window.api.command({ type: "session:resume", id }),
      sessionId,
    );
    assert.equal(
      (await page.evaluate(() => window.api.getState())).runtime.voice.status,
      "stopped",
    );
    await page.evaluate(
      (id) => window.api.command({ type: "session:end", id }),
      sessionId,
    );
    await page.getByRole("button", { name: "历史与复盘", exact: true }).click();
    await page.getByText("会议转写记录", { exact: true }).click();
    await page
      .getByText("如何实现线程安全的单例？", { exact: true })
      .first()
      .waitFor();
    await app.close();
    app = null;
    app = await electron.launch({ args: ["."], env });
    const restarted = await mainPage(app);
    assert.equal((await restarted.evaluate(() => window.api.getState())).voiceConfig.model, "paraformer-realtime-v2");
    await restarted.getByRole("button", { name: "应用设置", exact: true }).click();
    await expect(restarted.getByLabel("语音识别模型", { exact: true })).toHaveValue("paraformer-realtime-v2");
    rows = await restarted.evaluate(
      (id) => window.api.transcripts(id),
      sessionId,
    );
    assert.equal(rows.total, 1);
    assert.ok(rows.items[0].roundId);
    assert.equal(
      (await restarted.evaluate(() => window.api.getState())).runtime.voice
        .status,
      "stopped",
    );
    console.log(
      "PASS: speech settings, actual WebSocket/PCM worklet, hidden capture, automatic answer, unchanged window geometry/focus operations/passthrough, transcript links, stop/pause/restart persistence. Synthetic media only.",
    );
  } catch (error) {
    console.error("VOICE E2E FAILURE", error);
    throw error;
  } finally {
    if (app) await app.close();
    for (const ws of sockets) ws.terminate();
    await new Promise((r) => asr.close(r));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
