import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  shell,
  dialog,
  clipboard,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { Store } from "./store";
import { Service, message, sessionMarkdown } from "./service";
import { DomServer } from "./DomServer";
import { OverlayWindow, loadRenderer } from "./OverlayWindow";
import { Screenshot } from "./Screenshot";
import { AudioCapture } from "./audio-capture";
import { MobileServer } from "./mobile-server";
import { Voice } from "./voice";
import { MockInterview, mockMarkdown } from "./mock-interview";
import { MockVoice } from "./mock-voice";
import { mockElapsed } from "../shared/mock";
import type { Command, CommandResult } from "../shared/types";

// Use ScreenCaptureKit system-audio permission instead of a terminal-dependent CoreAudio Tap plist.
if (process.platform === "darwin") {
  const flags = app.commandLine
    .getSwitchValue("disable-features")
    .split(",")
    .filter(Boolean);
  app.commandLine.appendSwitch(
    "disable-features",
    [...new Set([...flags, "MacCatapLoopbackAudioForScreenShare"])].join(","),
  );
}

// Preserve the existing profile and extension path across the brand upgrade.
// Keep the bundle ID stable for existing installations.
const legacyUserData = path.join(app.getPath("appData"), "小面 AI");
if (
  !process.env.COMIND_TEST_DATA &&
  fs.existsSync(path.join(legacyUserData, "desktop-state.json"))
)
  app.setPath("userData", legacyUserData);

// Explicit test directory isolates automated smoke tests from real user data.
if (
  process.env.COMIND_TEST_DATA &&
  (process.env.COMIND_SMOKE === "1" || process.env.COMIND_E2E === "1")
)
  app.setPath("userData", process.env.COMIND_TEST_DATA);
let mainWindow: BrowserWindow | null = null;
let overlay: OverlayWindow;
let screenshot: Screenshot;
let audio: AudioCapture;
let voice: Voice;
let mock: MockInterview;
let mockVoice: MockVoice;
let microphone: AudioCapture;
let mockCheckpoint: ReturnType<typeof setInterval> | undefined;
let tray: Tray | null = null;
let service: Service;
let dom: DomServer;
let mobile: MobileServer;
let quitting = false;
function broadcast() {
  if (!service) return;
  service.runtime.overlayVisible = overlay?.visible || false;
  service.runtime.clickThrough = overlay?.clickThrough || false;
  if (mobile) {
    service.runtime.mobile = mobile.state;
    mobile.publish();
  }
  const state = service.state();
  for (const win of [mainWindow, overlay?.window])
    if (win && !win.isDestroyed())
      win.webContents.send("desktop:changed", win === mainWindow ? state : {
        ...state, mockInterviews: [], runtime: { ...state.runtime, mock: { mic: "off", partial: "", level: 0 } },
      });
}
function showMain() {
  mainWindow?.show();
  mainWindow?.focus();
}
function screenshotLog(text: string, error = false, detail = false) {
  const entry = { at: new Date().toISOString(), message: text, error };
  const line = `[screenshot] ${entry.at} ${error ? "ERROR" : detail ? "DEBUG" : "INFO"} ${text}`;
  if (!detail || error) {
    error ? console.error(line) : console.info(line);
    service.runtime.screenshotLog = [
      ...(service.runtime.screenshotLog || []),
      entry,
    ].slice(-20);
  }
  const file = path.join(app.getPath("userData"), "screenshot.log");
  service.runtime.screenshotLogPath = file;
  try {
    // Bounded local diagnostics; never include screen pixels or model credentials.
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000)
      fs.renameSync(file, file + ".1");
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch {
    console.error("[screenshot] 无法写入本地截图日志");
  }
  if (!detail || error) service.changed(false);
}
function registerShortcuts() {
  service.runtime.shortcutsRecording = false;
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.setIgnoreMenuShortcuts(false);
  globalShortcut.unregisterAll();
  const actions = {
    generate: () => {
      const s = service.store.data.sessions.find(
        (s) => s.id === service.store.data.activeSessionId,
      );
      const r = s?.rounds.at(-1);
      if (s && r)
        void service
          .answer(s.id, r.id)
          .catch((e) => service.notice(message(e)));
      else {
        service.notice("请先输入题目或通过浏览器扩展采集");
        showMain();
      }
    },
    overlay: () => overlay.toggle(),
    penetration: () => overlay.togglePenetration(),
    scrollUp: () => overlay.scroll("up"),
    scrollDown: () => overlay.scroll("down"),
    scrollLeft: () => overlay.scroll("left"),
    scrollRight: () => overlay.scroll("right"),
    pair: () => armPairing(),
    quit: () => app.quit(),
    screenshot: () => {
      service.runtime.lastScreenshotShortcut = new Date().toISOString();
      screenshotLog("收到截图快捷键", false, true);
      void captureQuestion().catch((e) => {
        service.notice(message(e));
        showMain();
      });
    },
  };
  service.runtime.shortcutsErrors = [];
  service.runtime.registeredShortcuts = {};
  for (const [action, key] of Object.entries(
    service.store.data.preferences.shortcuts,
  )) {
    if (!key) continue;
    try {
      if (
        globalShortcut.register(key, actions[action as keyof typeof actions]) &&
        globalShortcut.isRegistered(key)
      )
        service.runtime.registeredShortcuts[action as keyof typeof actions] =
          key;
      else
        service.runtime.shortcutsErrors.push(
          `${key || action}：无法注册，可能被其他应用占用`,
        );
    } catch {
      service.runtime.shortcutsErrors.push(`${key}：快捷键格式无效`);
    }
  }
  broadcast();
}
async function captureQuestion() {
  if (service.runtime.jobs.screenshot) {
    screenshotLog("上一张截图仍在处理中", true);
    throw new Error("上一张截图仍在处理中");
  }
  const sessionId = service.store.data.activeSessionId;
  const modelId = service.store.data.activeModelId;
  service.runtime.jobs.screenshot = "正在截取当前屏幕…";
  screenshotLog("开始截图");
  try {
    if (sessionId && service.session(sessionId).status !== "ongoing")
      throw new Error("请先继续会话再截图");
    const image = await screenshot.capture();
    if (!image || quitting) {
      screenshotLog("截图已取消");
      return;
    }
    if (
      service.store.data.activeSessionId !== sessionId ||
      service.store.data.activeModelId !== modelId
    )
      throw new Error("会话或模型已切换，请重新截图");
    if (sessionId && service.session(sessionId).status !== "ongoing")
      throw new Error("会话已暂停或结束，截图未发送");
    service.runtime.jobs.screenshot = "正在上传截图并解答…";
    service.runtime.lastCapture = new Date().toISOString();
    service.runtime.lastPage = "整屏截图";
    service.runtime.notice = undefined;
    service.changed(false);
    if (!overlay.visible) overlay.show();
    screenshotLog("正在上传截图");
    await service.add(
      "请识别截图中的题目并解答",
      "screenshot",
      undefined,
      image,
    );
    screenshotLog("截图识别完成");
  } catch (e) {
    screenshotLog(message(e), true);
    throw e;
  } finally {
    delete service.runtime.jobs.screenshot;
    service.changed(false);
  }
}
function armPairing() {
  dom.armPairing();
  service.runtime.pairingUntil = Date.now() + 60000;
  service.notice("已开放 60 秒重新配对窗口，请在扩展中点击重新配对");
}
function extensionDir() {
  return path.join(app.getPath("userData"), "browser-extension");
}
function installExtension() {
  const source = app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.join(app.getAppPath(), "extension");
  fs.mkdirSync(extensionDir(), { recursive: true });
  fs.cpSync(source, extensionDir(), { recursive: true });
}
function allowed(event: Electron.IpcMainInvokeEvent) {
  return [mainWindow, overlay?.window].some(
    (w) =>
      w &&
      !w.isDestroyed() &&
      w.webContents === event.sender &&
      event.senderFrame === w.webContents.mainFrame,
  );
}
async function command(c: Command): Promise<CommandResult> {
  try {
    if (!c || typeof c.type !== "string") throw new Error("无效操作");
    if (
      (["session:pause", "session:end", "session:delete"].includes(c.type) &&
        "id" in c &&
        c.id === service.runtime.voice.sessionId) ||
      ["model:select", "model:delete", "model:save"].includes(c.type)
    )
      voice.stop();
    switch (c.type) {
      case "mock:role":
        return { ok: true, text: await mock.role(c.jd) };
      case "mock:create":
        return { ok: true, text: mock.create(c.setup) };
      case "mock:start":
      case "mock:resume":
        await mock.start(c.id);
        return { ok: true };
      case "mock:next":
        await mock.next(c.id);
        if (mock.session(c.id).status === "completed") await mock.report(c.id);
        return { ok: true };
      case "mock:draft":
        mockVoice.continue();
        mock.draft(c.id, c.turnId, c.text);
        return { ok: true };
      case "mock:submit":
        await mockVoice.submit(c.id, c.turnId, c.text);
        return { ok: true };
      case "mock:skip":
        mockVoice.stop();
        await mock.skip(c.id);
        if (mock.session(c.id).status === "completed") await mock.report(c.id);
        return { ok: true };
      case "mock:pause":
        mockVoice.stop(); mock.pause(c.id);
        return { ok: true };
      case "mock:end":
        mockVoice.stop(); mock.end(c.id);
        await mock.report(c.id);
        return { ok: true };
      case "mock:report":
        await mock.report(c.id, c.turnId);
        return { ok: true };
      case "mock:listen":
        await mockVoice.listen(c.id);
        return { ok: true };
      case "mock:continue":
        mockVoice.continue();
        return { ok: true };
      case "mock:mic-stop":
        mockVoice.stop();
        return { ok: true };
      case "mock:export": {
        const s = mock.session(c.id);
        if (s.status !== "completed") throw new Error("请先结束模拟面试");
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: "导出模拟面试报告", defaultPath: "CoMind-模拟面试-" + s.createdAt.slice(0, 10) + ".md",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, mockMarkdown(s), "utf8");
        return { ok: true, text: result.canceled ? "已取消导出" : "导出成功" };
      }
      case "mobile:start":
        if (c.address !== undefined && typeof c.address !== "string") throw new Error("无效网络地址");
        await mobile.start(c.address);
        return { ok: true };
      case "mobile:stop":
        mobile.stop();
        return { ok: true };
      case "mobile:reset":
        mobile.reset();
        return { ok: true };
      case "mobile:refresh":
        mobile.refresh();
        return { ok: true };
      case "voice:save":
        service.store.saveVoice(c.workspaceId, c.apiKey, c.model);
        voice.stop();
        mockVoice.stop();
        service.changed();
        return { ok: true, text: "语音连接已保存" };
      case "voice:test":
        return { ok: true, text: await voice.test() };
      case "voice:start":
        if (service.runtime.mock.mic !== "off") throw new Error("请先停止模拟面试的麦克风");
        await voice.start();
        return { ok: true };
      case "voice:stop":
        voice.stop();
        return { ok: true };
      case "voice:auto":
        voice.auto(c.enabled);
        return { ok: true };
      case "voice:answer":
        await voice.answer(c.sessionId, c.transcriptId);
        return { ok: true };

      case "shortcuts:record":
        if (typeof c.recording !== "boolean")
          throw new Error("无效快捷键录入状态");
        if (c.recording) {
          globalShortcut.unregisterAll();
          mainWindow?.webContents.setIgnoreMenuShortcuts(true);
          service.runtime.registeredShortcuts = {};
          service.runtime.shortcutsRecording = true;
          broadcast();
        } else if (service.runtime.shortcutsRecording) registerShortcuts();
        return { ok: true };
      case "clipboard:write":
        if (typeof c.text !== "string" || c.text.length > 500000)
          throw new Error("复制内容无效或过长");
        clipboard.writeText(c.text);
        return { ok: true };
      case "overlay:toggle":
        overlay.toggle();
        return { ok: true };
      case "screenshot:capture":
        await captureQuestion();
        return { ok: true };
      case "overlay:penetration":
        overlay.togglePenetration();
        return { ok: true };
      case "extension:pair":
        armPairing();
        return { ok: true };
      case "extension:open": {
        const error = await shell.openPath(extensionDir());
        if (error) throw new Error("无法打开扩展目录");
        return { ok: true };
      }
      case "app:quit":
        app.quit();
        return { ok: true };
      case "session:export": {
        const session = service.session(c.id);
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: "导出会话",
          defaultPath: `CoMind-${session.createdAt.slice(0, 10)}.md`,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!result.canceled && result.filePath)
          fs.writeFileSync(
            result.filePath,
            sessionMarkdown(session) +
              "\n\n## 会议转写\n\n" +
              service.store.transcripts.markdown(session.id),
            "utf8",
          );
        return { ok: true, text: result.canceled ? "已取消导出" : "导出成功" };
      }
      default: {
        const oldShortcuts = JSON.stringify(
          service.store.data.preferences.shortcuts,
        );
        const text = await service.execute(c);
        if (c.type === "preferences:save") {
          overlay.protect(service.store.data.preferences.contentProtection);
          if (
            oldShortcuts !==
              JSON.stringify(service.store.data.preferences.shortcuts) ||
            service.runtime.shortcutsErrors.length > 0
          )
            registerShortcuts();
          if (service.runtime.shortcutsErrors.length)
            return {
              ok: false,
              error:
                "设置已保存，但部分快捷键未生效：" +
                service.runtime.shortcutsErrors.join("；") +
                "。请更换组合键，或解除其他工具的占用后再次保存。",
            };
        }
        return { ok: true, text };
      }
    }
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
function secureWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}
console.info(
  `[app] 正在启动 CoMind · PID ${process.pid} · ${app.isPackaged ? "安装版" : process.env.NODE_ENV || "本地运行"}`,
);
if (!app.requestSingleInstanceLock()) {
  console.warn(
    "[app] CoMind 已有实例正在运行，已请求打开原窗口，本次启动退出。关闭窗口只会隐藏到托盘；如需重新启动并在当前终端查看日志，请先从 CoMind 菜单或托盘选择「退出」，再运行 npm run dev。",
  );
  app.quit();
} else {
  app.on("second-instance", () => {
    console.info("[app] 收到重复启动请求，正在显示已有窗口");
    showMain();
  });
  app
    .whenReady()
    .then(async () => {
      app.setName("CoMind");
      const store = new Store(
        path.join(app.getPath("userData"), "desktop-state.json"),
        {
          available: () => safeStorage.isEncryptionAvailable(),
          encrypt: (value) =>
            safeStorage.encryptString(value).toString("base64"),
          decrypt: (value) =>
            safeStorage.decryptString(Buffer.from(value, "base64")),
        },
      );
      service = new Service(store, broadcast);
      mobile = new MobileServer(() => store.data, path.join(app.getAppPath(), "dist-mobile"), broadcast);
      overlay = new OverlayWindow(broadcast);
      audio = new AudioCapture();
      voice = new Voice(service, audio, undefined, undefined, () => {
        if (!overlay.visible) overlay.show();
      });
      mock = new MockInterview(service);
      microphone = new AudioCapture("microphone");
      mockVoice = new MockVoice(mock, microphone);
      mockCheckpoint = setInterval(() => {
        for (const s of store.data.mockInterviews) if (s.status === "ongoing") {
          s.elapsedMs = mockElapsed(s); s.runningSince = Date.now(); service.changed();
        }
      }, 15000);
      screenshot = new Screenshot((text, error) =>
        screenshotLog(text, error, true),
      );
      dom = new DomServer(
        (payload) => {
          const current = store.data.sessions.find(
            (s) => s.id === store.data.activeSessionId,
          );
          if (current?.status !== "paused") overlay.show();
          void service
            .capture(payload)
            .catch((e) => service.notice(message(e)));
        },
        {
          get: () => store.data,
          update: (patch) => {
            Object.assign(store.data, patch);
            service.runtime.paired = store.data.extensionPaired;
            service.changed();
          },
        },
        () => {
          service.runtime.pairingUntil = undefined;
          service.notice("浏览器扩展已配对");
        },
      );
      installExtension();
      mainWindow = new BrowserWindow({
        title: "CoMind",
        icon: path.join(
          app.isPackaged ? process.resourcesPath : app.getAppPath(),
          "build",
          "icon.png",
        ),
        width: 1320,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: "#f4f6fa",
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      ipcMain.handle("voice:transcripts", (event, sessionId, before) => {
        if (!allowed(event)) throw new Error("不允许的请求");
        if (
          typeof sessionId !== "string" ||
          (before !== undefined &&
            (!Number.isSafeInteger(before) || before < 0))
        )
          throw new Error("无效转写查询");
        service.session(sessionId);
        return service.store.transcripts.page(sessionId, before);
      });
      ipcMain.handle("desktop:state", (event) => {
        if (!allowed(event)) throw new Error("不允许的请求");
        const state = service.state();
        return event.sender === mainWindow?.webContents ? state : {
          ...state, mockInterviews: [], runtime: { ...state.runtime, mock: { mic: "off", partial: "", level: 0 } },
        };
      });
      ipcMain.handle("desktop:command", (event, c) => {
        if (!allowed(event)) return { ok: false, error: "不允许的请求" };
        if (String(c?.type).startsWith("mock:") && event.sender !== mainWindow?.webContents)
          return { ok: false, error: "模拟面试仅可在主窗口操作" };
        return command(c);
      });
      secureWindow(mainWindow);
      const restoreShortcuts = () => {
        if (!quitting && service.runtime.shortcutsRecording)
          registerShortcuts();
      };
      mainWindow.on("blur", restoreShortcuts);
      mainWindow.on("hide", restoreShortcuts);
      mainWindow.webContents.on("did-start-loading", restoreShortcuts);
      mainWindow.webContents.on("render-process-gone", restoreShortcuts);
      const pauseMock = () => {
        mockVoice.stop();
        for (const s of store.data.mockInterviews) if (s.status === "ongoing") mock.pause(s.id);
      };
      mainWindow.on("hide", pauseMock);
      mainWindow.webContents.on("render-process-gone", pauseMock);
      mainWindow.webContents.on("did-start-loading", pauseMock);
      mainWindow.once("ready-to-show", showMain);
      mainWindow.on("close", (event) => {
        if (!quitting && tray) {
          event.preventDefault();
          mainWindow?.hide();
        }
      });
      overlay.create();
      secureWindow(overlay.window!);
      overlay.protect(store.data.preferences.contentProtection);
      const trayImage = nativeImage.createFromPath(
        path.join(
          app.isPackaged ? process.resourcesPath : app.getAppPath(),
          "build",
          "tray.png",
        ),
      );
      tray = new Tray(trayImage.resize({ width: 18, height: 18 }));
      tray.setToolTip("CoMind");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开CoMind", click: showMain },
          { label: "显示 / 隐藏悬浮窗", click: () => overlay.toggle() },
          { label: "切换鼠标穿透", click: () => overlay.togglePenetration() },
          { label: "重新配对扩展", click: armPairing },
          { type: "separator" },
          { label: "退出", click: () => app.quit() },
        ]),
      );
      tray.on("double-click", showMain);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin"
            ? [
                {
                  label: "CoMind",
                  submenu: [
                    { role: "about" as const },
                    { type: "separator" as const },
                    { role: "hide" as const },
                    { role: "quit" as const },
                  ],
                },
              ]
            : []),
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "窗口",
            submenu: [
              { label: "打开工作台", click: showMain },
              { role: "minimize" },
            ],
          },
        ]),
      );
      service.runtime.port = await dom.start();
      if (!service.runtime.port)
        service.notice("扩展服务端口被占用，手动输入仍可使用");
      registerShortcuts();
      await loadRenderer(mainWindow);
      console.info("[app] CoMind 已就绪，主进程日志输出到本终端");
      console.info(
        "[app] 截图详细日志：" +
          path.join(app.getPath("userData"), "screenshot.log"),
      );
      if (process.env.COMIND_SMOKE === "1") {
        await mainWindow.webContents.executeJavaScript(
          `new Promise(resolve => { const check = () => document.body.innerText.includes('智能工作台') ? resolve(true) : setTimeout(check, 50); check(); })`,
        );
        const checks = await mainWindow.webContents.executeJavaScript(
          `({ title: document.title, hasApi: !!window.api, text: document.body.innerText })`,
        );
        const healthy =
          checks.hasApi &&
          checks.text.includes("CoMind") &&
          service.runtime.port > 0 &&
          fs.existsSync(extensionDir());
        console.log(
          "COMIND_SMOKE_RESULT=" +
            JSON.stringify({
              ok: healthy,
              platform: process.platform,
              arch: process.arch,
              packaged: app.isPackaged,
              checks,
              port: service.runtime.port,
            }),
        );
        app.exit(healthy ? 0 : 1);
      }
    })
    .catch((error) => {
      console.error("启动失败：", message(error));
      dialog.showErrorBox("CoMind 启动失败", message(error));
      app.exit(1);
    });
  app.on("activate", showMain);
  app.on("before-quit", () => {
    console.info("[app] 正在退出 CoMind，释放快捷键和扩展服务");
    quitting = true;
    mobile?.stop();
    clearInterval(mockCheckpoint);
    mockVoice?.stop();
    microphone?.dispose();
    mock?.dispose();
    voice?.dispose();
    audio?.dispose();
    service?.dispose();
    globalShortcut.unregisterAll();
    dom?.stop();
    overlay?.destroy();
    screenshot?.dispose();
    tray?.destroy();
  });
  app.on("window-all-closed", () => {
    if (!tray) app.quit();
  });
}
app.on("will-quit", () => console.info("[app] CoMind 已退出"));
