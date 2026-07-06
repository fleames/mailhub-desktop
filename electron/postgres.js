const fs = require("fs");
const path = require("path");

const PORT = 54329; // uncommon on purpose — customer machines won't have this taken
const USER = "mailhub";

function isInitialised(databaseDir) {
  return fs.existsSync(path.join(databaseDir, "PG_VERSION"));
}

/** @returns {{ start: () => Promise<string>, stop: () => Promise<void> }} */
function createPostgres(app, dbPassword) {
  const databaseDir = path.join(app.getPath("userData"), "pgdata");
  let pg = null;
  let startPromise = null;

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
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
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
    });
    if (!isInitialised(databaseDir)) {
      await pg.initialise();
    }
    await pg.start();
    await pg.createDatabase("mailhub").catch(() => {}); // already exists after first run
    return `postgres://${USER}:${encodeURIComponent(dbPassword)}@127.0.0.1:${PORT}/mailhub`;
  }

  async function stop() {
    if (!pg) return;
    try {
      await pg.stop();
    } catch {
      // already stopped — fine during a failed startup path
    }
  }

  return { start, stop };
}

module.exports = { createPostgres };
