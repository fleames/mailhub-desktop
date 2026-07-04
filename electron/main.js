const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { machineIdSync } = require("node-machine-id");
const { verifyLicense, loadLicenseFile } = require("../license/verify");
const { loadStore, saveStore } = require("./license-store");
const { loadOrCreateSecrets } = require("./secrets");
const { createPostgres } = require("./postgres");
const { startServer } = require("./server");
const { spawn } = require("child_process");

const PUBLIC_KEY = fs.readFileSync(
  path.join(__dirname, "..", "license", "keys", "public.pem"),
  "utf8"
);
const PURCHASE_URL = "https://example.com/buy-mailhub"; // TODO: real storefront link

let activationWindow = null;
let splashWindow = null;
let mainWindow = null;
let tray = null;
let runningServer = null; // { stop } from server.js, so we can shut it down on quit

function currentMachineId() {
  try {
    return machineIdSync(true);
  } catch {
    return null;
  }
}

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

function windowCommonOptions(extra) {
  return {
    backgroundColor: "#0a0b0f",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#101218", symbolColor: "#8b91a7", height: 32 },
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    ...extra,
  };
}

function createActivationWindow() {
  activationWindow = new BrowserWindow(
    windowCommonOptions({
      width: 460,
      height: 640,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Activate MailHub",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
  );
  activationWindow.setMenuBarVisibility(false);
  activationWindow.loadFile(path.join(__dirname, "screens", "activation.html"));
  activationWindow.once("ready-to-show", () => activationWindow.show());
}

function createSplashWindow() {
  splashWindow = new BrowserWindow(
    windowCommonOptions({
      width: 360,
      height: 420,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "MailHub",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
  );
  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadFile(path.join(__dirname, "screens", "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow.show());
}

function sendSplashStep(step, status) {
  splashWindow?.webContents.send("splash:step", { step, status });
}
function sendSplashError(step, message) {
  splashWindow?.webContents.send("splash:error", { step, message });
}

function runMigrations(databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "..", "vendor", "mailhub-migrate", "scripts", "migrate.mjs")],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DATABASE_URL: databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stderr = "";
    child.stdout.on("data", (d) => process.stdout.write(`[migrate] ${d}`));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(`[migrate] ${d}`);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `migrate exited with code ${code}`));
    });
  });
}

/** The full startup sequence, shown behind the splash window. Retryable as a whole. */
async function bootApp() {
  const secrets = loadOrCreateSecrets(app);
  const storageDir = path.join(app.getPath("userData"), "storage");
  fs.mkdirSync(storageDir, { recursive: true });

  const postgres = createPostgres(app, secrets.dbPassword);

  sendSplashStep("postgres", "active");
  let databaseUrl;
  try {
    databaseUrl = await postgres.start();
  } catch (err) {
    sendSplashError("postgres", `Couldn't start the database: ${err.message}`);
    return;
  }
  sendSplashStep("postgres", "done");

  sendSplashStep("migrate", "active");
  try {
    await runMigrations(databaseUrl);
  } catch (err) {
    sendSplashError("migrate", `Couldn't prepare your mailbox: ${err.message}`);
    return;
  }
  sendSplashStep("migrate", "done");

  sendSplashStep("server", "active");
  let server;
  try {
    server = await startServer({ databaseUrl, storageDir, secrets });
  } catch (err) {
    sendSplashError("server", `Couldn't open MailHub: ${err.message}`);
    return;
  }
  sendSplashStep("server", "done");
  runningServer = server;

  await session.defaultSession.cookies.set({
    url: server.url,
    name: "mh_session",
    value: server.sessionCookie,
    httpOnly: true,
    sameSite: "lax",
    secure: false, // loopback-only connection; the header says Secure but there's no real network hop here
    expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  });

  createMainWindowAndLoad(server.url);
  createTray();
  splashWindow?.close();
  splashWindow = null;
}

function createMainWindowAndLoad(url) {
  mainWindow = new BrowserWindow(
    windowCommonOptions({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      title: "MailHub",
      show: false,
    })
  );
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide(); // minimize-to-tray instead of actually quitting
    }
  });
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "assets", "tray-icon.png"));
  tray.setToolTip("MailHub");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open MailHub", click: () => mainWindow?.show() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => mainWindow?.show());
}

function proceedPastActivation() {
  if (activationWindow) {
    activationWindow.close();
    activationWindow = null;
  }
  createSplashWindow();
  splashWindow.once("ready-to-show", () => void bootApp());
}

// --- IPC: app / license ---

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:open-purchase-link", () => shell.openExternal(PURCHASE_URL));

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

ipcMain.on("license:activated", proceedPastActivation);
ipcMain.on("splash:retry", () => void bootApp());

app.whenReady().then(() => {
  const existing = checkStoredLicense(loadStore(app));
  if (existing.valid) {
    createSplashWindow();
    splashWindow.once("ready-to-show", () => void bootApp());
  } else {
    createActivationWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  runningServer?.stop();
});

app.on("window-all-closed", () => {
  // Tray keeps the app alive even with no windows open — quitting is
  // explicit, via the tray menu, not an accidental window close.
});
