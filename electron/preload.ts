import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Command, DesktopApi, DesktopState } from "../shared/types";
const api: DesktopApi = {
  screenshot: {
    frame: () => ipcRenderer.invoke("screenshot:frame"),
    select: (rect) => ipcRenderer.invoke("screenshot:select", rect),
    cancel: () => ipcRenderer.invoke("screenshot:cancel"),
  },
  platform: process.platform,
  getState: () => ipcRenderer.invoke("desktop:state"),
  command: (command: Command) => ipcRenderer.invoke("desktop:command", command),
  onState: (callback) => {
    const listener = (_event: IpcRendererEvent, state: DesktopState) =>
      callback(state);
    ipcRenderer.on("desktop:changed", listener);
    return () => ipcRenderer.removeListener("desktop:changed", listener);
  },
};
contextBridge.exposeInMainWorld("api", api);
