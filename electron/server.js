const { spawn } = require("child_process");
const { mailhubServerEntry } = require("./resource-paths");

const PORT = 34521; // uncommon on purpose, distinct from the embedded Postgres port

/**
 * Spawns the bundled mailhub standalone server, waits for it to be healthy
 * (which also proves the DB connection works — /api/health does `SELECT 1`),
 * then auto-logs-in using the locally-generated appPassword so the user
 * never sees mailhub's own /login screen.
 *
 * @returns {Promise<{ url: string, sessionCookie: string, stop: () => void }>}
 */
async function startServer({ databaseUrl, storageDir, secrets }) {
  const child = spawn(process.execPath, [mailhubServerEntry()], {
    env: {
      ...process.env,
      // process.execPath is electron.exe, not plain node — without this it
      // tries to boot SERVER_ENTRY as another Electron app instead of
      // running it as a script.
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      STORAGE_DIR: storageDir,
      // Without this, links in notifications (and now the Microsoft OAuth
      // redirect URI) fall back to the default localhost:3480 — wrong here.
      APP_URL: `http://127.0.0.1:${PORT}`,
      APP_PASSWORD: secrets.appPassword,
      AUTH_SECRET: secrets.authSecret,
      INBOUND_SECRET: secrets.inboundSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[mailhub-server] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[mailhub-server] ${d}`));

  const url = `http://127.0.0.1:${PORT}`;
  await waitForHealthy(url, child);
  const sessionCookie = await autoLogin(url, secrets.appPassword);

  return {
    url,
    sessionCookie,
    stop: () => child.kill(),
  };
}

async function waitForHealthy(url, child, timeoutMs = 30000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`mailhub server exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${url}/api/health`);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) return;
      lastError = body?.error ?? `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`mailhub server never became healthy: ${lastError ?? "timed out"}`);
}

async function autoLogin(url, appPassword) {
  const res = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: appPassword }),
  });
  if (!res.ok) throw new Error(`Auto-login failed (HTTP ${res.status})`);

  const setCookie = res.headers.get("set-cookie");
  const match = setCookie && /mh_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error("Auto-login succeeded but no session cookie was returned");
  return match[1];
}

module.exports = { startServer, PORT };
