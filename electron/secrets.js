/**
 * The bundled MailHub server still wants its own APP_PASSWORD/AUTH_SECRET/
 * INBOUND_SECRET (its `src/lib/env.ts` requires them, no defaults) — but a
 * customer who already unlocked the app with a license shouldn't ALSO see
 * mailhub's own login screen. So: generate these once per install, store
 * them locally, and have the Electron main process auto-login on the
 * server's behalf (see server.js) instead of showing that login page.
 */
const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

function secretsPath(app) {
  return path.join(app.getPath("userData"), "secrets.json");
}

function loadOrCreateSecrets(app) {
  const file = secretsPath(app);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const secrets = {
      appPassword: randomBytes(24).toString("base64url"),
      authSecret: randomBytes(32).toString("hex"),
      inboundSecret: randomBytes(16).toString("hex"),
      // Embedded Postgres's own role password — set once at cluster init,
      // must stay stable across launches or the app can't reconnect.
      dbPassword: randomBytes(18).toString("base64url"),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return secrets;
  }
}

module.exports = { loadOrCreateSecrets };
