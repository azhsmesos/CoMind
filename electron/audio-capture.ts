import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  systemPreferences,
  type IpcMainEvent,
} from "electron";
import path from "node:path";
export interface AudioSource {
  start(
    frame: (data: Uint8Array, level: number) => void,
    error: (message: string) => void,
  ): Promise<void>;
  stop(): void;
}
export class AudioCapture implements AudioSource {
  private generation = 0;
  private win?: BrowserWindow;
  private cancel?: () => void;
  private frame?: (data: Uint8Array, level: number) => void;
  private failure?: (message: string) => void;
  private ready?: () => void;
  private authorized(event: IpcMainEvent) {
    return (
      !!this.win &&
      !this.win.isDestroyed() &&
      event.sender === this.win.webContents &&
      event.senderFrame === this.win.webContents.mainFrame
    );
  }
  constructor(private source: "system" | "microphone" = "system") {
    ipcMain.on(this.channel("pcm"), (event, data, level) => {
      if (
        !this.authorized(event) ||
        !(data instanceof Uint8Array) ||
        data.byteLength !== 3200 ||
        !Number.isFinite(level)
      )
        return;
      this.frame?.(data, Math.max(0, Math.min(1, level)));
    });
    ipcMain.on(this.channel("audio-ready"), (event) => {
      if (this.authorized(event)) this.ready?.();
    });
    ipcMain.on(this.channel("audio-error"), (event, code) => {
      if (!this.authorized(event)) return;
      const message =
        code === "NotAllowedError"
          ? "系统音频权限未获允许，请在录屏与系统录音中授权 CoMind（开发时还需授权启动终端），重启后重试"
          : code === "ended"
            ? "系统音频采集中断，请重新开始会议识别"
            : "无法读取系统音频，请检查录屏与系统录音权限及当前音频设备";
      this.failure?.(this.source === "microphone"
        ? code === "NotAllowedError" ? "麦克风权限未获允许，请在系统设置中授权后重试" : "麦克风采集中断，请重新开始回答；已有文字已保留"
        : message);
    });
  }
  private channel(name: string) {
    return (this.source === "microphone" ? "mock-mic:" : "voice:") + name;
  }
  async start(
    frame: (data: Uint8Array, level: number) => void,
    error: (message: string) => void,
  ) {
    if (this.source === "system" && process.platform !== "darwin")
      throw new Error("会议识别首版仅支持 macOS");
    if (
      this.source === "system" && ["denied", "restricted"].includes(
        systemPreferences.getMediaAccessStatus("screen"),
      )
    )
      throw new Error(
        "请先在录屏与系统录音中授权 CoMind 及启动终端，并重启应用",
      );
    this.stop();
    const generation = this.generation;
    if (this.source === "microphone" && process.platform === "darwin" &&
        !(await systemPreferences.askForMediaAccess("microphone")))
      throw new Error("麦克风权限未获允许，请在系统设置 → 隐私与安全性 → 麦克风中授权");
    if (generation !== this.generation) throw new Error("音频采集已取消");
    this.frame = frame;
    const ses = session.fromPartition(this.source === "microphone" ? "comind-mock-microphone" : "comind-system-audio");
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        session: ses,
        preload: path.join(__dirname, this.source === "microphone" ? "mock-audio-preload.js" : "audio-preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.win = win;
    const permitted = () => this.win === win && !win.isDestroyed();
    // Isolated capture partitions: microphone access never leaks to desktop/overlay.
    ses.setPermissionCheckHandler(
      (wc, permission, _origin, details) =>
        permitted() &&
        wc === win.webContents &&
        (this.source === "system" ? String(permission) === "display-capture"
          : permission === "media" && details.mediaType === "audio"),
    );
    ses.setPermissionRequestHandler((wc, permission, callback, details) =>
      callback(
        permitted() &&
          wc === win.webContents &&
          // Electron 43 requests loopback media with an empty mediaTypes list.
          // This isolated window never permits camera or microphone requests.
          (this.source === "system" ? permission === "display-capture" ||
            (permission === "media" && "mediaTypes" in details && details.mediaTypes?.length === 0)
            : permission === "media" && "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio"),
      ),
    );
    ses.setDisplayMediaRequestHandler(
      async (request, callback) => {
        if (this.source !== "system" || !permitted() || request.frame !== win.webContents.mainFrame) {
          callback({});
          return;
        }
        try {
          const display = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          );
          const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 },
          });
          if (!permitted()) {
            callback({});
            return;
          }
          const video =
            sources.find((s) => s.display_id === String(display.id)) ||
            sources[0];
          callback(video ? { video, audio: "loopback" } : {});
        } catch {
          callback({});
        }
      },
      { useSystemPicker: false },
    );
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => this.failure?.(this.source === "microphone" ? "麦克风启动超时，请检查麦克风授权" : "系统音频启动超时，请检查录屏与系统录音授权"),
        20000,
      );
      this.ready = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      this.failure = (message) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(message));
        } else error(message);
      };
      this.cancel = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error("音频采集已停止"));
        }
      };
      win.webContents.on("render-process-gone", () =>
        this.failure?.("音频采集进程已退出，请重新开始"),
      );
      const loading =
        !app.isPackaged && process.env.NODE_ENV === "development"
          ? win.loadURL("http://localhost:5180/#" + (this.source === "microphone" ? "mock-microphone" : "audio-capture"))
          : win.loadFile(path.join(__dirname, "../../dist/index.html"), {
              hash: this.source === "microphone" ? "mock-microphone" : "audio-capture",
            });
      void loading
        .then(() => {
          if (permitted())
            return win.webContents.executeJavaScript(
              "window.startVoiceCapture()",
              true,
            );
        })
        .catch(() => {
          if (permitted()) this.failure?.("无法启动音频采集页面");
        });
    });
  }
  stop() {
    this.generation++;
    const win = this.win;
    this.win = undefined;
    this.frame = undefined;
    this.ready = undefined;
    this.failure = undefined;
    this.cancel?.();
    this.cancel = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
  dispose() {
    this.stop();
    for (const c of ["pcm", "audio-ready", "audio-error"])
      ipcMain.removeAllListeners(this.channel(c));
  }
}
