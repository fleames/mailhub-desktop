const { app, BrowserWindow, ipcMain, session, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

// This is a mail client, not a graphics app — the GPU process buys nothing
// but ~100MB+ of extra memory and a background process. Cap renderer V8 heap
// too, since Chromium's default scales with system RAM and this app's UI
// doesn't need gigabytes of headroom.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("in-process-gpu"); // fold what's left into the main process instead of a separate one
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=384");
const { loadOrCreateSecrets } = require("./secrets");
const { createPostgres } = require("./postgres");
const { startServer } = require("./server");
const { mailhubMigrateEntry } = require("./resource-paths");
const { spawn } = require("child_process");

let splashWindow = null;
let mainWindow = null;
let tray = null;
let runningServer = null; // { stop } from server.js, so we can shut it down on quit
// Created once and reused across bootApp() retries — recreating it per
// attempt meant a retry after a later-stage failure tried to start a
// second Postgres server on the same port while the first was still
// running (see postgres.js's own idempotency guard too).
let postgresController = null;

function windowCommonOptions(extra) {
  return {
    backgroundColor: "#0a0b0f",
    icon: path.join(__dirname, "assets", "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#101218", symbolColor: "#8b91a7", height: 32 },
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    ...extra,
  };
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
      [mailhubMigrateEntry()],
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

  if (!postgresController) {
    postgresController = createPostgres(app, secrets.dbPassword);
  }

  sendSplashStep("postgres", "active");
  let databaseUrl;
  try {
    databaseUrl = await postgresController.start();
  } catch (err) {
    sendSplashError("postgres", `Couldn't start the database: ${err?.message ?? String(err)}`);
    return;
  }
  sendSplashStep("postgres", "done");

  sendSplashStep("migrate", "active");
  try {
    await runMigrations(databaseUrl);
  } catch (err) {
    sendSplashError("migrate", `Couldn't prepare your mailbox: ${err?.message ?? String(err)}`);
    return;
  }
  sendSplashStep("migrate", "done");

  sendSplashStep("server", "active");
  let server;
  try {
    server = await startServer({ databaseUrl, storageDir, secrets });
  } catch (err) {
    sendSplashError("server", `Couldn't open MailHub: ${err?.message ?? String(err)}`);
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

// --- IPC: app ---

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.on("splash:retry", () => void bootApp());

app.whenReady().then(() => {
  createSplashWindow();
  splashWindow.once("ready-to-show", () => void bootApp());
});

// Electron doesn't wait for async work in "before-quit" unless the event is
// held open — without this, the process can exit mid-shutdown of the
// embedded Postgres server (pg_ctl stop takes real time), leaving it running
// and holding the port for the next launch.
let cleanShutdownDone = false;
app.on("before-quit", (e) => {
  app.isQuitting = true;
  if (cleanShutdownDone) return;
  e.preventDefault();
  runningServer?.stop();
  Promise.resolve(postgresController?.stop())
    .catch(() => {})
    .finally(() => {
      cleanShutdownDone = true;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  // Tray keeps the app alive even with no windows open — quitting is
  // explicit, via the tray menu, not an accidental window close.
});
