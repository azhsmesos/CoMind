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
  constructor() {
    ipcMain.on("voice:pcm", (event, data, level) => {
      if (
        !this.authorized(event) ||
        !(data instanceof Uint8Array) ||
        data.byteLength !== 3200 ||
        !Number.isFinite(level)
      )
        return;
      this.frame?.(data, Math.max(0, Math.min(1, level)));
    });
    ipcMain.on("voice:audio-ready", (event) => {
      if (this.authorized(event)) this.ready?.();
    });
    ipcMain.on("voice:audio-error", (event, code) => {
      if (!this.authorized(event)) return;
      const message =
        code === "NotAllowedError"
          ? "系统音频权限未获允许，请在录屏与系统录音中授权 CoMind（开发时还需授权启动终端），重启后重试"
          : code === "ended"
            ? "系统音频采集中断，请重新开始会议识别"
            : "无法读取系统音频，请检查录屏与系统录音权限及当前音频设备";
      this.failure?.(message);
    });
  }
  async start(
    frame: (data: Uint8Array, level: number) => void,
    error: (message: string) => void,
  ) {
    if (process.platform !== "darwin")
      throw new Error("会议识别首版仅支持 macOS");
    if (
      ["denied", "restricted"].includes(
        systemPreferences.getMediaAccessStatus("screen"),
      )
    )
      throw new Error(
        "请先在录屏与系统录音中授权 CoMind 及启动终端，并重启应用",
      );
    this.stop();
    this.frame = frame;
    const ses = session.fromPartition("comind-system-audio");
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        session: ses,
        preload: path.join(__dirname, "audio-preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.win = win;
    const permitted = () => this.win === win && !win.isDestroyed();
    // This partition has no user browsing. Never grant microphone/camera access.
    ses.setPermissionCheckHandler(
      (wc, permission) =>
        permitted() &&
        wc === win.webContents &&
        String(permission) === "display-capture",
    );
    ses.setPermissionRequestHandler((wc, permission, callback) =>
      callback(
        permitted() &&
          wc === win.webContents &&
          permission === "display-capture",
      ),
    );
    ses.setDisplayMediaRequestHandler(
      async (request, callback) => {
        if (!permitted() || request.frame !== win.webContents.mainFrame) {
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
        () => this.failure?.("系统音频启动超时，请检查录屏与系统录音授权"),
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
          ? win.loadURL("http://localhost:5180/#audio-capture")
          : win.loadFile(path.join(__dirname, "../../dist/index.html"), {
              hash: "audio-capture",
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
    for (const c of ["voice:pcm", "voice:audio-ready", "voice:audio-error"])
      ipcMain.removeAllListeners(c);
  }
}
