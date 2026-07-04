const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mailhubDesktop", {
  browseForLicenseFile: () => ipcRenderer.invoke("license:browse"),
  activateLicenseFile: (filePath) => ipcRenderer.invoke("license:activate-file", filePath),
  activateLicenseText: (text) => ipcRenderer.invoke("license:activate-text", text),
  proceedToApp: () => ipcRenderer.send("license:activated"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  openPurchaseLink: () => ipcRenderer.invoke("app:open-purchase-link"),

  onSplashStep: (callback) =>
    ipcRenderer.on("splash:step", (_event, payload) => callback(payload)),
  onSplashError: (callback) =>
    ipcRenderer.on("splash:error", (_event, payload) => callback(payload)),
  retrySplash: () => ipcRenderer.send("splash:retry"),
});
