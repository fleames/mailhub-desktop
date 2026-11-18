const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Must sit outside Windows' excluded TCP ranges (`netsh interface ipv4 show excludedportrange`);
// 54329 fell inside 54233-54332 and Postgres could not bind it ("Permission denied").
const PORT = 15439; // uncommon on purpose — customer machines won't have this taken
const USER = "mailhub";

function isInitialised(databaseDir) {
  return fs.existsSync(path.join(databaseDir, "PG_VERSION"));
}

function connectionUrl(dbPassword) {
  return `postgres://${USER}:${encodeURIComponent(dbPassword)}@127.0.0.1:${PORT}/mailhub`;
}

async function canConnect(url) {
  let sql;
  try {
    const postgres = require("postgres");
    sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 2 });
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  }
}

async function stopCluster(databaseDir) {
  let pgCtl;
  try {
    ({ pg_ctl: pgCtl } = await import("@embedded-postgres/windows-x64"));
  } catch {
    return;
  }
  await new Promise((resolve) => {
    const child = spawn(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

function describeStartFailure(err, lastLog) {
  if (err instanceof Error && err.message) return err.message;
  const log = String(lastLog ?? "").trim();
  if (log) return log.split(/\r?\n/).filter(Boolean).slice(-4).join("\n");
  return (
    "the database process exited immediately. MailHub may already be running " +
    "in the system tray — quit it from there, or wait a moment and try again."
  );
}

/** @returns {{ start: () => Promise<string>, stop: () => Promise<void> }} */
function createPostgres(app, dbPassword) {
  const databaseDir = path.join(app.getPath("userData"), "pgdata");
  let pg = null;
  let startPromise = null;
  let adopted = false;

  async function start() {
    // Idempotent: if start() already succeeded (or is in flight) on this
    // controller, reuse it instead of spinning up a second server bound to
    // the same port — this matters because a later boot step (migrate,
    // server) can fail and the user can retry the whole sequence, which
    // must not try to start Postgres twice.
    if (startPromise) return startPromise;
    startPromise = doStart();
    try {
      return await startPromise;
    } catch (err) {
      startPromise = null; // let a genuine failure be retried from scratch
      throw err;
    }
  }

  async function doStart() {
    const url = connectionUrl(dbPassword);

    // A previous launch (or a leftover after a crash / tray-quit miss) may
    // already be listening. Reuse it instead of spawning a second postmaster
    // on the same data dir — embedded-postgres then exits with reject() and
    // no Error, which used to surface as "Couldn't start the database: undefined".
    if (isInitialised(databaseDir) && (await canConnect(url))) {
      adopted = true;
      return url;
    }

    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    let lastLog = "";
    pg = new EmbeddedPostgres({
      databaseDir,
      user: USER,
      password: dbPassword,
      port: PORT,
      persistent: true,
      // Without this, initdb inherits the OS locale's default encoding
      // (e.g. WIN1252 on many Windows installs) — mailhub's schema has
      // emoji default values (domain icons), which then fail to insert.
      // Force UTF8 regardless of what's installed on the customer's machine.
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      // A single-user desktop mailbox never needs server-scale defaults —
      // this trims both memory and the number of background/worker
      // processes Postgres spawns without affecting correctness.
      postgresFlags: [
        "-c", "shared_buffers=32MB",
        "-c", "max_connections=20",
        "-c", "max_worker_processes=4",
        "-c", "max_parallel_workers=0",
        "-c", "max_parallel_workers_per_gather=0",
        "-c", "io_workers=1",
        "-c", "jit=off",
      ],
      onLog: (msg) => {
        lastLog += String(msg);
        process.stdout.write(`[postgres] ${msg}`);
      },
      onError: (err) => console.error("[postgres]", err),
    });
    try {
      if (!isInitialised(databaseDir)) {
        await pg.initialise();
      }
      await pg.start();
    } catch (err) {
      if (await canConnect(url)) {
        adopted = true;
        return url;
      }
      throw new Error(describeStartFailure(err, lastLog));
    }
    await pg.createDatabase("mailhub").catch(() => {}); // already exists after first run
    return url;
  }

  async function stop() {
    if (pg) {
      try {
        await pg.stop();
      } catch {
        // already stopped — fine during a failed startup path
      }
      pg = null;
    }
    if (adopted) {
      await stopCluster(databaseDir);
      adopted = false;
    }
  }

  return { start, stop };
}

module.exports = { createPostgres };
