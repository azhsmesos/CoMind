import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("audioCapture", {
  frame: (data: Uint8Array, level: number) =>
    ipcRenderer.send("voice:pcm", data, level),
  ready: () => ipcRenderer.send("voice:audio-ready"),
  error: (code: string) => ipcRenderer.send("voice:audio-error", code),
});
