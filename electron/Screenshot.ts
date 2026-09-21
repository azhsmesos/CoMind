import { desktopCapturer, screen, systemPreferences } from "electron";

export class Screenshot {
  private busy = false;
  private disposed = false;
  constructor(
    private report: (text: string, error?: boolean) => void = () => {},
  ) {}

  async capture(): Promise<string | null> {
    if (this.busy) throw new Error("正在截图，请稍候");
    if (this.disposed) throw new Error("应用正在退出");
    if (process.platform === "darwin") {
      const permission = systemPreferences.getMediaAccessStatus("screen");
      this.report(`屏幕录制权限：${permission}`);
      if (["denied", "restricted"].includes(permission))
        throw new Error(
          "请在系统设置 → 隐私与安全性 → 屏幕录制中允许CoMind（开发模式下可能是 Electron 或终端），然后重启应用",
        );
    }
    this.busy = true;
    try {
      const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      );
      const scale = Math.min(
        display.scaleFactor,
        2560 / Math.max(display.bounds.width, display.bounds.height),
      );
      // Read the current display without creating, hiding, showing or focusing
      // any windows. In particular, the answer overlay stays in place.
      this.report("正在读取鼠标所在屏幕（整屏自动提交）");
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(display.bounds.width * scale),
          height: Math.round(display.bounds.height * scale),
        },
      });
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
      let image = source.thumbnail;
      const size = image.getSize();
      if (Math.max(size.width, size.height) > 2560)
        image = image.resize(
          size.width >= size.height ? { width: 2560 } : { height: 2560 },
        );
      const data = image.toJPEG(90);
      if (data.length > 5_000_000)
        throw new Error("屏幕图片过大，请降低显示分辨率后重试");
      this.report(
        `整屏截图完成：${image.getSize().width} × ${image.getSize().height} 像素`,
      );
      return "data:image/jpeg;base64," + data.toString("base64");
    } finally {
      this.busy = false;
    }
  }

  dispose() {
    this.disposed = true;
  }
}
