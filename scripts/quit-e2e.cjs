const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
async function mainPage(app) {
  for (let i = 0; i < 200; i++) {
    const p = app.windows().find((p) => p.url().endsWith("/dist/index.html"));
    if (p) {
      await p.getByRole("button", { name: "快捷键", exact: true }).waitFor();
      return p;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("主窗口未加载");
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-quit-"));
  let app;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMIND_E2E: "1",
    COMIND_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ args: ["."], env });
    let page = await mainPage(app);
    assert.equal(
      (await page.evaluate(() => window.api.getState())).preferences.shortcuts
        .quit,
      "Control+C",
    );
    await page.evaluate(async () => {
      const s = await window.api.getState();
      await window.api.command({
        type: "preferences:save",
        preferences: {
          ...s.preferences,
          shortcuts: Object.fromEntries(
            Object.keys(s.preferences.shortcuts).map((k) => [
              k,
              k === "quit" ? "Control+C" : "",
            ]),
          ),
        },
      });
    });
    await page.getByRole("button", { name: "快捷键", exact: true }).click();
    const input = page.getByLabel("退出整个应用", { exact: true });
    await expect(input).toHaveValue("Control+C");
    async function record() {
      await input.click();
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await window.api.getState()).runtime.shortcutsRecording,
          ),
        )
        .toBe(true);
    }
    await record();
    assert.equal(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Control+C"),
      ),
      false,
    );
    await input.press("Control+c");
    await expect(input).toHaveValue(
      process.platform === "darwin" ? "Control+C" : "Ctrl+C",
    );
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await input.press("Escape");
    await expect(input).toHaveValue("Control+C");
    await record();
    await input.press("Backspace");
    await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.api.getState()).preferences.shortcuts.quit,
        ),
      )
      .toBe("");
    assert.equal(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Control+C"),
      ),
      false,
    );
    await record();
    await input.press("Control+Alt+q");
    await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
    const binding =
      process.platform === "darwin"
        ? "Control+Alt+Q"
        : "CommandOrControl+Alt+Q";
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.api.getState()).runtime.registeredShortcuts.quit,
        ),
      )
      .toBe(binding);
    await app.close();
    app = null;
    app = await electron.launch({ args: ["."], env });
    page = await mainPage(app);
    assert.equal(
      (await page.evaluate(() => window.api.getState())).preferences.shortcuts
        .quit,
      binding,
    );
    // Capture the real registered callback, invoke it only in this isolated app.
    await app.evaluate(({ globalShortcut }, binding) => {
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (key, callback) => {
        const ok = register(key, callback);
        if (ok && key === binding) globalThis.fixtureQuit = callback;
        return ok;
      };
    }, binding);
    await page.evaluate(async () => {
      await window.api.command({ type: "shortcuts:record", recording: true });
      await window.api.command({ type: "shortcuts:record", recording: false });
    });
    const processHandle = app.process();
    const closed = app.waitForEvent("close");
    await app.evaluate(() => {
      if (!globalThis.fixtureQuit) throw new Error("退出快捷键未注册");
      setTimeout(() => globalThis.fixtureQuit(), 50);
    });
    await closed;
    if (processHandle.exitCode === null) await new Promise(resolve => processHandle.once("exit", resolve));
    assert.equal(processHandle.exitCode, 0);
    app = null;
    console.log(
      "PASS quit shortcut: default Control+C, safe recording, cancel/clear, custom binding, persistence and full process exit",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
