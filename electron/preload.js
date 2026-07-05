const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mailhubDesktop", {
  getVersion: () => ipcRenderer.invoke("app:get-version"),

  onSplashStep: (callback) =>
    ipcRenderer.on("splash:step", (_event, payload) => callback(payload)),
  onSplashError: (callback) =>
    ipcRenderer.on("splash:error", (_event, payload) => callback(payload)),
  retrySplash: () => ipcRenderer.send("splash:retry"),
});
