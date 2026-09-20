import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
  systemPreferences,
  type IpcMainInvokeEvent,
  type NativeImage,
} from "electron";
import path from "node:path";
import { loadRenderer } from "./OverlayWindow";
import type { CaptureRect, CommandResult } from "../shared/types";

export function cropRectangle(
  rect: CaptureRect,
  width: number,
  height: number,
) {
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1.000001 ||
    rect.y + rect.height > 1.000001
  )
    throw new Error("无效截图区域，请重新框选");
  const x = Math.floor(rect.x * width);
  const y = Math.floor(rect.y * height);
  const w = Math.min(width - x, Math.round(rect.width * width));
  const h = Math.min(height - y, Math.round(rect.height * height));
  if (w < 8 || h < 8) throw new Error("截图区域太小，请重新框选");
  return { x, y, width: w, height: h };
}

export class Screenshot {
  private picker: BrowserWindow | null = null;
  private frame: NativeImage | null = null;
  private finish: ((image: string | null, error?: Error) => void) | null = null;
  private busy = false;
  private disposed = false;
  private showPicker: (() => void) | null = null;
  constructor(
    private report: (text: string, error?: boolean) => void = () => {},
  ) {
    ipcMain.handle("screenshot:frame", (event) => {
      this.authorize(event);
      return this.frame!.toDataURL();
    });
    ipcMain.handle("screenshot:ready", (event, loaded: boolean) => {
      this.authorize(event);
      if (loaded === false) {
        this.finish?.(null, new Error("截图画面加载失败，请重试"));
      } else if (loaded === true) {
        this.showPicker?.();
        this.showPicker = null;
      } else {
        throw new Error("无效截图状态");
      }
    });
    ipcMain.handle(
      "screenshot:select",
      (event, rect: CaptureRect): CommandResult => {
        this.authorize(event);
        try {
          const size = this.frame!.getSize();
          let image = this.frame!.crop(
            cropRectangle(rect, size.width, size.height),
          );
          const cropped = image.getSize();
          this.report(
            `已选择截图区域：${cropped.width} × ${cropped.height} 像素`,
          );
          if (Math.max(cropped.width, cropped.height) > 2560)
            image = image.resize(
              cropped.width >= cropped.height
                ? { width: 2560 }
                : { height: 2560 },
            );
          const data = image.toJPEG(90);
          if (data.length > 5_000_000)
            throw new Error("图片过大，请缩小框选范围");
          const result = "data:image/jpeg;base64," + data.toString("base64");
          const finish = this.finish;
          setTimeout(() => finish?.(result), 0);
          return { ok: true };
        } catch (e) {
          this.report(e instanceof Error ? e.message : "截图失败", true);
          return {
            ok: false,
            error: e instanceof Error ? e.message : "截图失败",
          };
        }
      },
    );
    ipcMain.handle("screenshot:cancel", (event) => {
      this.authorize(event);
      this.finish?.(null);
    });
  }
  private authorize(event: IpcMainInvokeEvent) {
    if (
      !this.picker ||
      this.picker.isDestroyed() ||
      event.sender !== this.picker.webContents ||
      event.senderFrame !== this.picker.webContents.mainFrame ||
      !this.frame
    )
      throw new Error("不允许的截图请求");
  }
  async capture(windows: (BrowserWindow | null)[]): Promise<string | null> {
    if (this.busy) throw new Error("正在截图，请先完成或按 Esc 取消");
    if (this.disposed) throw new Error("应用正在退出");
    if (process.platform === "darwin")
      this.report(
        `屏幕录制权限：${systemPreferences.getMediaAccessStatus("screen")}`,
      );
    if (
      process.platform === "darwin" &&
      ["denied", "restricted"].includes(
        systemPreferences.getMediaAccessStatus("screen"),
      )
    )
      throw new Error(
        "请在系统设置 → 隐私与安全性 → 屏幕录制中允许CoMind（开发模式下可能是 Electron 或终端），然后重启应用",
      );
    this.busy = true;
    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const visible = windows.filter(
      (w): w is BrowserWindow => !!w && !w.isDestroyed() && w.isVisible(),
    );
    try {
      visible.forEach((w) => w.hide());
      await new Promise((resolve) => setTimeout(resolve, 180));
      const scale = Math.min(
        display.scaleFactor,
        4096 / Math.max(display.bounds.width, display.bounds.height),
      );
      this.report("正在读取鼠标所在屏幕");
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(display.bounds.width * scale),
          height: Math.round(display.bounds.height * scale),
        },
      });
      this.report(`屏幕读取完成：${sources.length} 个屏幕源`);
      if (this.disposed) return null;
      if (
        process.platform === "darwin" &&
        systemPreferences.getMediaAccessStatus("screen") !== "granted"
      )
        throw new Error(
          "屏幕录制权限尚未生效，请在系统设置中允许访问并重启应用后重试",
        );
      const source =
        sources.find((s) => s.display_id === String(display.id)) ||
        (sources.length === 1 ? sources[0] : undefined);
      if (!source || source.thumbnail.isEmpty())
        throw new Error("无法读取当前屏幕，请检查屏幕录制权限后重试");
      // Decode a scale-1 representation so region coordinates map to pixels.
      this.frame = nativeImage.createFromBuffer(source.thumbnail.toPNG());
      return await new Promise<string | null>((resolve, reject) => {
        const picker = new BrowserWindow({
          ...display.bounds,
          frame: false,
          show: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          movable: false,
          resizable: false,
          hasShadow: false,
          backgroundColor: "#00000000",
          transparent: true,
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        this.picker = picker;
        let completed = false;
        const timeout = setTimeout(() => finish(null), 120_000);
        const loadingTimeout = setTimeout(
          () => finish(null, new Error("截图画面加载超时，请重试")),
          10_000,
        );
        const finish = (image: string | null, error?: Error) => {
          if (completed) return;
          completed = true;
          if (!image && !error) this.report("截图已取消");
          clearTimeout(timeout);
          clearTimeout(loadingTimeout);
          this.showPicker = null;
          this.finish = null;
          this.picker = null;
          this.frame = null;
          if (!picker.isDestroyed()) picker.destroy();
          error ? reject(error) : resolve(image);
        };
        this.finish = finish;
        this.report("正在加载框选窗口");
        picker.setAlwaysOnTop(true, "screen-saver");
        if (process.platform === "darwin")
          picker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        picker.webContents.on("will-navigate", (e) => e.preventDefault());
        picker.webContents.on("render-process-gone", () =>
          finish(null, new Error("截图窗口异常退出，请重试")),
        );
        picker.webContents.on("before-input-event", (e, input) => {
          if (input.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        });
        picker.on("closed", () => finish(null));
        // Show only after the renderer has decoded and painted the screen image.
        this.showPicker = () => {
          if (!picker.isDestroyed()) {
            clearTimeout(loadingTimeout);
            picker.setBounds(display.bounds);
            picker.show();
            picker.focus();
            this.report("框选窗口已显示，请按住鼠标拖动选择区域");
          }
        };
        void loadRenderer(picker, "capture").catch(() =>
          finish(null, new Error("无法打开截图窗口")),
        );
      });
    } finally {
      this.busy = false;
      this.frame = null;
      if (!this.disposed)
        visible.forEach((w) => {
          if (!w.isDestroyed()) w.showInactive();
        });
    }
  }
  dispose() {
    this.disposed = true;
    this.finish?.(null);
    for (const channel of [
      "screenshot:frame",
      "screenshot:ready",
      "screenshot:select",
      "screenshot:cancel",
    ])
      ipcMain.removeHandler(channel);
  }
}
