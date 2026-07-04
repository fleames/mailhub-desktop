/**
 * License verification — runs fully offline. Import this from the Electron
 * main process before the embedded Postgres/Next.js server ever starts, so
 * there's no running app to reverse-engineer the check out of.
 */
const fs = require("fs");
const { verify: cryptoVerify } = require("crypto");
const { canonicalize } = require("./format");

/**
 * @param {object} license - parsed license JSON (email, tier, issuedAt, expiresAt, machineFingerprint, signature)
 * @param {string} publicKeyPem - the public key baked into the app build
 * @param {string|null} currentMachineFingerprint - pass null to skip machine-binding checks
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyLicense(license, publicKeyPem, currentMachineFingerprint = null) {
  if (!license || typeof license !== "object") {
    return { valid: false, reason: "License file is missing or unreadable." };
  }
  const { signature, ...payload } = license;
  if (!signature) return { valid: false, reason: "License file has no signature." };

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      null,
      Buffer.from(canonicalize(payload)),
      publicKeyPem,
      Buffer.from(signature, "base64")
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { valid: false, reason: "Signature doesn't match — this license file was altered or isn't genuine." };
  }

  if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
    return { valid: false, reason: "This license has expired." };
  }

  // Machine binding is optional and only enforced once a fingerprint has
  // actually been recorded against the license (see bindMachine below).
  if (
    payload.machineFingerprint &&
    currentMachineFingerprint &&
    payload.machineFingerprint !== currentMachineFingerprint
  ) {
    return { valid: false, reason: "This license is already activated on a different machine." };
  }

  return { valid: true };
}

function loadLicenseFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { verifyLicense, loadLicenseFile };
