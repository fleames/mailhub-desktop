/**
 * One-off: pipes a fresh pg_dump of the real mailhub dev database straight
 * into the embedded Postgres cluster, using the Docker container's own
 * pg_dump/pg_restore (the embedded-postgres Windows binaries don't bundle
 * client tools) reaching the embedded instance via host.docker.internal.
 * The DB password is read from secrets.json and passed through argv/env
 * arrays only — never interpolated into a shell string.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const userDataDir = path.join(os.homedir(), "AppData", "Roaming", "mailhub-desktop");
const secrets = JSON.parse(fs.readFileSync(path.join(userDataDir, "secrets.json"), "utf8"));

const inner = [
  "pg_dump -U mailhub -d mailhub --data-only --disable-triggers -Fc |",
  "PGPASSWORD=\"$TARGET_PGPASSWORD\"",
  "pg_restore -h host.docker.internal -p 54329 -U mailhub -d mailhub --data-only --disable-triggers",
].join(" ");

const child = spawn("docker", ["exec", "-e", `TARGET_PGPASSWORD=${secrets.dbPassword}`, "mailhub-db-1", "sh", "-c", inner], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code));
