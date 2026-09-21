import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("audioCapture", {
  frame: (data: Uint8Array, level: number) =>
    ipcRenderer.send("mock-mic:pcm", data, level),
  ready: () => ipcRenderer.send("mock-mic:audio-ready"),
  error: (code: string) => ipcRenderer.send("mock-mic:audio-error", code),
});
