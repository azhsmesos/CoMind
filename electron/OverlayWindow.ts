import { BrowserWindow, screen } from "electron";
import path from "node:path";
export function loadRenderer(
  win: BrowserWindow,
  overlay: boolean | "capture" = false,
) {
  const hash = overlay === "capture" ? "capture" : overlay ? "overlay" : "";
  if (
    !require("electron").app.isPackaged &&
    process.env.NODE_ENV === "development"
  )
    return win.loadURL("http://localhost:5180/" + (hash ? `#${hash}` : ""));
  return win.loadFile(path.join(__dirname, "../../dist/index.html"), {
    hash,
  });
}
export class OverlayWindow {
  window: BrowserWindow | null = null;
  visible = false;
  clickThrough = false;
  constructor(private changed: () => void) {}
  create() {
    const { workArea } = screen.getPrimaryDisplay();
    this.window = new BrowserWindow({
      width: Math.min(590, workArea.width),
      height: Math.min(740, workArea.height),
      x: workArea.x + 24,
      y: workArea.y + 24,
      minWidth: 380,
      minHeight: 280,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window.setAlwaysOnTop(true, "floating");
    if (process.platform === "darwin")
      this.window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    this.window.on("close", (event) => {
      event.preventDefault();
      this.hide();
    });
    void loadRenderer(this.window, true);
  }
  show() {
    this.window?.showInactive();
    this.visible = true;
    this.changed();
  }
  hide() {
    this.window?.hide();
    this.visible = false;
    this.changed();
  }
  toggle() {
    this.visible ? this.hide() : this.show();
  }
  togglePenetration() {
    this.clickThrough = !this.clickThrough;
    this.window?.setIgnoreMouseEvents(this.clickThrough, { forward: true });
    this.changed();
  }
  protect(value: boolean) {
    this.window?.setContentProtection(value);
  }
  destroy() {
    this.window?.destroy();
    this.window = null;
  }
}
