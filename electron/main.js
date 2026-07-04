const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { machineIdSync } = require("node-machine-id");
const { verifyLicense, loadLicenseFile } = require("../license/verify");
const { loadStore, saveStore } = require("./license-store");

const PUBLIC_KEY = fs.readFileSync(
  path.join(__dirname, "..", "license", "keys", "public.pem"),
  "utf8"
);
const PURCHASE_URL = "https://example.com/buy-mailhub"; // TODO: real storefront link

let activationWindow = null;
let mainWindow = null;

function currentMachineId() {
  try {
    return machineIdSync(true);
  } catch {
    return null;
  }
}

/** Verify a stored { signed, boundMachineId } record against a live machine id. */
function checkStoredLicense(store) {
  if (!store || !store.signed) return { valid: false, reason: "No license activated yet." };
  const sigResult = verifyLicense(store.signed, PUBLIC_KEY);
  if (!sigResult.valid) return sigResult;

  const machineId = currentMachineId();
  if (store.boundMachineId && machineId && store.boundMachineId !== machineId) {
    return { valid: false, reason: "This license is already activated on a different machine." };
  }
  return { valid: true, license: store.signed };
}

function createActivationWindow() {
  activationWindow = new BrowserWindow({
    width: 460,
    height: 640,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Activate MailHub",
    backgroundColor: "#0a0b0f",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#101218", symbolColor: "#8b91a7", height: 32 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  activationWindow.setMenuBarVisibility(false);
  activationWindow.loadFile(path.join(__dirname, "screens", "activation.html"));
  activationWindow.once("ready-to-show", () => activationWindow.show());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "MailHub",
    backgroundColor: "#0a0b0f",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#101218", symbolColor: "#8b91a7", height: 32 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // TODO: load the embedded Postgres + Next.js standalone server URL here
  // once that piece is wired up (next todo item). Placeholder for now so
  // the activation -> app handoff is testable end to end.
  mainWindow.loadURL(
    "data:text/html,<body style='background:#0a0b0f;color:#e8eaf2;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><h1>MailHub is starting…</h1></body>"
  );
}

function proceedPastActivation() {
  if (activationWindow) {
    activationWindow.close();
    activationWindow = null;
  }
  createMainWindow();
}

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:open-purchase-link", () => {
  shell.openExternal(PURCHASE_URL);
});

ipcMain.handle("license:browse", async () => {
  const result = await dialog.showOpenDialog(activationWindow, {
    title: "Select your MailHub license file",
    filters: [{ name: "MailHub license", extensions: ["license"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function activate(license) {
  const sigResult = verifyLicense(license, PUBLIC_KEY);
  if (!sigResult.valid) return sigResult;

  const machineId = currentMachineId();
  saveStore(app, { signed: license, boundMachineId: machineId });
  return { valid: true, license };
}

ipcMain.handle("license:activate-file", (_event, filePath) => {
  const license = loadLicenseFile(filePath);
  if (!license) return { valid: false, reason: "Couldn't read that file — is it a valid .license file?" };
  return activate(license);
});

ipcMain.handle("license:activate-text", (_event, text) => {
  let license;
  try {
    license = JSON.parse(text);
  } catch {
    return { valid: false, reason: "That doesn't look like a valid license — check for missing/extra characters." };
  }
  return activate(license);
});

// The activation screen calls this once it has a `valid: true` result, to
// hand off into the real app instead of main.js polling for it.
ipcMain.on("license:activated", proceedPastActivation);

app.whenReady().then(() => {
  const existing = checkStoredLicense(loadStore(app));
  if (existing.valid) {
    createMainWindow();
  } else {
    createActivationWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
