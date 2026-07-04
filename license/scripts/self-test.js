/**
 * Round-trip sanity check: issue -> verify, plus the failure paths that
 * actually matter (tampering, wrong key, expiry, machine mismatch).
 * Not a permanent test suite — just proving the mechanism before it gets
 * wired into Electron.
 */
const fs = require("fs");
const path = require("path");
const { generateKeyPairSync, sign } = require("crypto");
const { verifyLicense } = require("../verify");
const { canonicalize } = require("../format");

const publicKey = fs.readFileSync(path.join(__dirname, "..", "keys", "public.pem"), "utf8");
const privateKey = fs.readFileSync(path.join(__dirname, "..", "keys", "private.pem"), "utf8");

let pass = 0;
let fail = 0;
function check(name, condition) {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

console.log("1. Genuine, unexpired license");
const good = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "issued", "test-buyer@example.com.license"), "utf8"));
const r1 = verifyLicense(good, publicKey);
check("verifies as valid", r1.valid === true);

console.log("2. Genuine license, but expired");
const expired = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "issued", "expired-buyer@example.com.license"), "utf8"));
const r2 = verifyLicense(expired, publicKey);
check("rejected", r2.valid === false);
check("reason mentions expiry", /expired/i.test(r2.reason));

console.log("3. Tampered payload (email changed after signing)");
const tampered = { ...good, email: "attacker@example.com" };
const r3 = verifyLicense(tampered, publicKey);
check("rejected", r3.valid === false);
check("reason mentions signature", /signature/i.test(r3.reason));

console.log("4. Forged license signed with a DIFFERENT keypair");
const forged = generateKeyPairSync("ed25519");
const forgedPayload = { email: "test-buyer@example.com", tier: "lifetime", issuedAt: new Date().toISOString(), expiresAt: null, machineFingerprint: null };
const forgedSig = sign(null, Buffer.from(canonicalize(forgedPayload)), forged.privateKey).toString("base64");
const r4 = verifyLicense({ ...forgedPayload, signature: forgedSig }, publicKey);
check("rejected (wrong signing key)", r4.valid === false);

console.log("5. Machine-bound license, wrong machine");
const boundPayload = { email: "test-buyer@example.com", tier: "lifetime", issuedAt: new Date().toISOString(), expiresAt: null, machineFingerprint: "machine-A" };
const boundSig = sign(null, Buffer.from(canonicalize(boundPayload)), privateKey).toString("base64");
const r5 = verifyLicense({ ...boundPayload, signature: boundSig }, publicKey, "machine-B");
check("rejected", r5.valid === false);
const r5b = verifyLicense({ ...boundPayload, signature: boundSig }, publicKey, "machine-A");
check("same machine accepted", r5b.valid === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
