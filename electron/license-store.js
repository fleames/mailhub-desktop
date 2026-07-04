/**
 * Where the activated license lives on disk, and the load/save helpers
 * around it. Separate from license/verify.js (which is pure crypto, no
 * filesystem opinions) so the license package stays reusable outside Electron.
 *
 * Stored shape is { signed, boundMachineId }, not just the signed license
 * itself: `signed.machineFingerprint` can only be set by whoever holds the
 * private key (the issuer), so it can't be filled in after the fact on a
 * customer's machine. `boundMachineId` is a local, UNSIGNED record of which
 * machine first activated this license — a casual speed bump against
 * copying the file to a second machine, not a cryptographic guarantee (a
 * determined user could edit it back to match). That's an accepted,
 * documented tradeoff, not an oversight — see license/README.md.
 */
const fs = require("fs");
const path = require("path");

function licenseFilePath(app) {
  return path.join(app.getPath("userData"), "license.json");
}

function loadStore(app) {
  try {
    return JSON.parse(fs.readFileSync(licenseFilePath(app), "utf8"));
  } catch {
    return null;
  }
}

function saveStore(app, { signed, boundMachineId }) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(licenseFilePath(app), JSON.stringify({ signed, boundMachineId }, null, 2));
}

module.exports = { licenseFilePath, loadStore, saveStore };
