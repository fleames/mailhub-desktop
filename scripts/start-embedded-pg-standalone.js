/**
 * One-off helper: starts the SAME embedded Postgres cluster the Electron
 * app would use (same userData path, same port, same stored credentials),
 * without needing the full Electron app running — for data import/export
 * work. Stays running until Ctrl+C.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

const userDataDir = path.join(os.homedir(), "AppData", "Roaming", "mailhub-desktop");
const secrets = JSON.parse(fs.readFileSync(path.join(userDataDir, "secrets.json"), "utf8"));

const fakeApp = { getPath: () => userDataDir };
const { createPostgres } = require("../electron/postgres");

(async () => {
  const pg = createPostgres(fakeApp, secrets.dbPassword);
  const url = await pg.start();
  console.log("READY", url);
})();
