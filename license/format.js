/**
 * Canonical license payload shape, shared by the issuer and the verifier.
 * Field order is fixed here (not left to JSON.stringify's key-insertion
 * order) so both sides always sign/verify byte-identical JSON.
 */
const FIELDS = ["email", "tier", "issuedAt", "expiresAt", "machineFingerprint"];

function canonicalize(payload) {
  const ordered = {};
  for (const key of FIELDS) ordered[key] = payload[key] ?? null;
  return JSON.stringify(ordered);
}

module.exports = { FIELDS, canonicalize };
