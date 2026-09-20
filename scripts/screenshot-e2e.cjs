const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Main window did not load");
}

(async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "comind-screenshot-test-"),
  );
  const requests = [];
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
    ].map((k) => [k, k === "problem" ? "识别到的合成测试题" : "图片测试回答"]),
  );
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (b) => (raw += b));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMIND_E2E: "1",
    COMIND_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.COMIND_SMOKE;
  let app;
  try {
    app = await electron.launch({ args: ["."], env });
    let page = await mainPage(app);
    // Avoid colliding with a separately running development app.
    await page.evaluate(async () => {
      const state = await window.api.getState();
      await window.api.command({
        type: "preferences:save",
        preferences: {
          ...state.preferences,
          shortcuts: Object.fromEntries(
            Object.keys(state.preferences.shortcuts).map((key) => [key, ""]),
          ),
        },
      });
    });
    await app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut);
      global.__blockScreenshotShortcut = true;
      globalShortcut.register = (key, callback) => {
        if (key === "F8" && global.__blockScreenshotShortcut) return false;
        const registered = register(key, callback);
        if (key === "F8" && registered) global.__screenshotShortcut = callback;
        return registered;
      };
    });
    // Synthetic pixels only: never read the user's screen or request screen permission.
    await app.evaluate(
      ({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
        global.__screenDenied = false;
        systemPreferences.getMediaAccessStatus = () =>
          global.__screenDenied ? "denied" : "granted";
        desktopCapturer.getSources = async () => [
          {
            id: "screen:fixture:0",
            name: "Synthetic display",
            display_id: String(
              screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
            ),
            thumbnail: nativeImage.createFromBitmap(
              Buffer.alloc(1000 * 600 * 4, 220),
              { width: 1000, height: 600 },
            ),
          },
        ];
      },
    );
    // Missing model configuration must not prevent local region selection.
    const firstPicker = app.waitForEvent("window");
    const missingModelCapture = page.evaluate(() =>
      window.api.command({ type: "screenshot:capture" }),
    );
    const unconfiguredPicker = await firstPicker;
    await unconfiguredPicker.waitForURL(/#capture$/);
    await unconfiguredPicker.locator(".screenshot-frame").waitFor();
    await unconfiguredPicker.mouse.move(500, 360);
    await unconfiguredPicker.mouse.down();
    await unconfiguredPicker.mouse.move(100, 120);
    await unconfiguredPicker.mouse.up();
    const missingModelResult = await missingModelCapture;
    assert.equal(missingModelResult.ok, false);
    assert.match(missingModelResult.error, /添加并选择一个模型/);
    const capturedWithoutModel = await page.evaluate(() => window.api.getState());
    assert.ok(capturedWithoutModel.sessions[0].rounds[0].image);
    assert.equal(capturedWithoutModel.sessions[0].rounds[0].status, "error");
    assert.equal(capturedWithoutModel.runtime.jobs.screenshot, undefined);
    assert.equal(requests.length, 0);
    const captureLog = fs.readFileSync(path.join(dir, "screenshot.log"), "utf8");
    assert.match(captureLog, /框选窗口已显示/);
    assert.match(captureLog, /已选择截图区域/);
    assert.match(captureLog, /ERROR.*添加并选择一个模型/);
    assert.ok(!captureLog.includes("data:image"));
    await page.evaluate(
      (id) => window.api.command({ type: "session:delete", id }),
      capturedWithoutModel.activeSessionId,
    );
    await page.evaluate(async (baseUrl) => {
      const result = await window.api.command({
        type: "model:save",
        config: {
          id: "vision-fixture",
          name: "图片测试",
          provider: "custom",
          protocol: "openai",
          baseUrl,
          model: "vision-fixture",
          apiKey: "synthetic-key",
        },
      });
      if (!result.ok) throw new Error(result.error);
    }, "http://127.0.0.1:" + server.address().port);
    await page.getByRole("button", { name: "快捷键", exact: true }).click();
    await page.getByText("截图日志（最近 20 条）", { exact: true }).waitFor();
    const shortcutInput = page.getByLabel("框选截图并自动解答", {
      exact: true,
    });
    const waitForRecording = () =>
      expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await window.api.getState()).runtime.shortcutsRecording,
          ),
        )
        .toBe(true);
    await shortcutInput.click();
    await waitForRecording();
    await shortcutInput.press(
      process.platform === "darwin" ? "Meta+Shift+s" : "Control+Shift+s",
    );
    assert.equal(
      await shortcutInput.inputValue(),
      process.platform === "darwin" ? "⌘+Shift+S" : "Ctrl+Shift+S",
    );
    await shortcutInput.press("Backspace");
    assert.equal(await shortcutInput.inputValue(), "");
    await shortcutInput.press("Control+Alt+ArrowRight");
    assert.equal(
      await shortcutInput.inputValue(),
      process.platform === "darwin" ? "Control+Alt+Right" : "Ctrl+Alt+Right",
    );
    await shortcutInput.press("Escape");
    assert.equal(await shortcutInput.inputValue(), "");
    await shortcutInput.click();
    await waitForRecording();
    await shortcutInput.press("F8");
    assert.equal(await shortcutInput.inputValue(), "F8");
    await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "F8" }).first().waitFor();
    const failed = await page.evaluate(() => window.api.getState());
    assert.equal(failed.runtime.registeredShortcuts.screenshot, undefined);
    assert.ok(
      failed.runtime.shortcutsErrors.some((error) => error.includes("F8")),
    );
    assert.equal(
      await page.getByRole("button", { name: "已保存", exact: true }).count(),
      0,
    );
    // Saving the unchanged key must retry after a competing tool releases it.
    await app.evaluate(() => {
      global.__blockScreenshotShortcut = false;
    });
    await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.api.getState()).preferences.shortcuts.screenshot,
        ),
      )
      .toBe("F8");
    assert.equal(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("F8"),
      ),
      true,
    );
    await page.getByText(/已注册到CoMind/).waitFor();
    await shortcutInput.click();
    await waitForRecording();
    assert.equal(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("F8"),
      ),
      false,
    );
    await shortcutInput.press("F8");
    assert.equal(
      app.windows().some((p) => p.url().endsWith("#capture")),
      false,
    );
    assert.equal(
      (await page.evaluate(() => window.api.getState())).runtime
        .lastScreenshotShortcut,
      undefined,
    );
    await shortcutInput.press("Tab");
    await expect
      .poll(() =>
        app.evaluate(({ globalShortcut }) =>
          globalShortcut.isRegistered("F8"),
        ),
      )
      .toBe(true);
    const untrusted = await page.evaluate(async () => {
      try {
        await window.api.screenshot.frame();
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(untrusted, true);
    async function startCapture(viaShortcut = false) {
      const pending = app.waitForEvent("window");
      if (viaShortcut) await app.evaluate(() => global.__screenshotShortcut());
      else
        await page
          .getByRole("button", { name: "框选截图并解答", exact: true })
          .click();
      const picker = await pending;
      await picker.waitForURL(/#capture$/);
      await picker.locator(".screenshot-frame").waitFor();
      await picker.getByText("CoMind · 框选截图", { exact: true }).waitFor();
      return picker;
    }
    let picker = await startCapture();
    await picker.mouse.click(100, 100);
    await picker.getByText("请拖动框选更大的区域").waitFor();
    await picker.keyboard.press("Escape").catch((error) => {
      if (!picker.isClosed()) throw error;
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.api.getState()).runtime.jobs.screenshot,
        ),
      )
      .toBeUndefined();
    assert.equal(requests.length, 0);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes("#"))
          ?.isVisible(),
      ),
      true,
    );
    picker = await startCapture(true);
    assert.ok(
      (await page.evaluate(() => window.api.getState())).runtime
        .lastScreenshotShortcut,
    );
    const viewport = await picker.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await picker.mouse.move(100, 120);
    await picker.mouse.down();
    await picker.mouse.move(500, 360);
    await picker.mouse.up();
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
    assert.equal(requests.length, 1);
    const image = requests[0].messages[1].content.find(
      (c) => c.type === "image_url",
    ).image_url.url;
    assert.ok(image.startsWith("data:image/jpeg;base64,"));
    const imageSize = await app.evaluate(
      ({ nativeImage }, image) =>
        nativeImage.createFromDataURL(image).getSize(),
      image,
    );
    assert.equal(imageSize.width, Math.round((400 / viewport.width) * 1000));
    assert.equal(imageSize.height, Math.round((240 / viewport.height) * 600));
    const state = await page.evaluate(() => window.api.getState());
    assert.equal(state.sessions[0].rounds[0].question, answer.problem);
    assert.equal(state.sessions[0].rounds[0].image, image);
    assert.equal(state.runtime.overlayVisible, true);
    const overlay = app.windows().find((p) => p.url().endsWith("#overlay"));
    await overlay.getByText("图片测试回答", { exact: true }).first().waitFor();
    assert.equal(await overlay.getByRole("slider").count(), 0);
    // No capture when paused.
    await page.evaluate(
      async (id) => window.api.command({ type: "session:pause", id }),
      state.activeSessionId,
    );
    await page
      .getByRole("button", { name: "框选截图并解答", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "请先继续会话再截图" })
      .waitFor();
    assert.equal(requests.length, 1);
    if (process.platform === "darwin") {
      await page.evaluate(
        async (id) => window.api.command({ type: "session:resume", id }),
        state.activeSessionId,
      );
      await app.evaluate(() => {
        global.__screenDenied = true;
      });
      await page
        .getByRole("button", { name: "框选截图并解答", exact: true })
        .click();
      await page.getByRole("alert").filter({ hasText: "屏幕录制" }).waitFor();
      assert.equal(requests.length, 1);
    }
    await app.close();
    app = null;
    app = await electron.launch({ args: ["."], env });
    page = await mainPage(app);
    const restored = await page.evaluate(() => window.api.getState());
    assert.equal(restored.preferences.shortcuts.screenshot, "F8");
    assert.equal(restored.sessions[0].rounds[0].image, image);
    console.log(
      "PASS: selection without model and saved image, visible/persisted diagnostics, native selector, tiny-region handling, Esc cancellation, cropped-only upload, AI answer, IPC restrictions, paused/permission errors and restart persistence. Synthetic screen and local model server.",
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
