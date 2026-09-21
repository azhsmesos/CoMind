import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  Command,
  DesktopApi,
  DesktopState,
  OverlayScrollDirection,
} from "../shared/types";
const api: DesktopApi = {
  transcripts: (sessionId, before) =>
    ipcRenderer.invoke("voice:transcripts", sessionId, before),
  platform: process.platform,
  getState: () => ipcRenderer.invoke("desktop:state"),
  command: (command: Command) => ipcRenderer.invoke("desktop:command", command),
  onOverlayScroll: (callback) => {
    const listener = (
      _event: IpcRendererEvent,
      direction: OverlayScrollDirection,
    ) => callback(direction);
    ipcRenderer.on("overlay:scroll", listener);
    return () => ipcRenderer.removeListener("overlay:scroll", listener);
  },
  onState: (callback) => {
    const listener = (_event: IpcRendererEvent, state: DesktopState) =>
      callback(state);
    ipcRenderer.on("desktop:changed", listener);
    return () => ipcRenderer.removeListener("desktop:changed", listener);
  },
};
contextBridge.exposeInMainWorld("api", api);
