/**
 * Issue a signed license file.
 *
 *   node license/scripts/issue-license.js --email buyer@example.com --tier lifetime
 *   node license/scripts/issue-license.js --email buyer@example.com --tier subscription --expires 2027-01-01
 *
 * Prints the signed license JSON to stdout and also writes it to
 * license/issued/<email>.license (gitignored — these are per-customer
 * artifacts, not source). Wire this up behind the Lemon Squeezy purchase
 * webhook later; for now it's a manual/CLI issuer.
 */
const fs = require("fs");
const path = require("path");
const { sign } = require("crypto");
const { canonicalize } = require("../format");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const email = arg("email");
const tier = arg("tier") ?? "lifetime";
const expires = arg("expires"); // e.g. "2027-01-01", only meaningful for subscription tiers

if (!email) {
  console.error("Usage: node issue-license.js --email <email> [--tier lifetime|subscription] [--expires YYYY-MM-DD]");
  process.exit(1);
}

const privatePath = path.join(__dirname, "..", "keys", "private.pem");
if (!fs.existsSync(privatePath)) {
  console.error(`No private key at ${privatePath} — run generate-keypair.js first.`);
  process.exit(1);
}
const privateKey = fs.readFileSync(privatePath, "utf8");

const payload = {
  email,
  tier,
  issuedAt: new Date().toISOString(),
  expiresAt: expires ? new Date(expires).toISOString() : null,
  machineFingerprint: null, // bound on first activation, not at issue time
};

const signature = sign(null, Buffer.from(canonicalize(payload)), privateKey).toString("base64");
const license = { ...payload, signature };

const outDir = path.join(__dirname, "..", "issued");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${email.replace(/[^a-z0-9@._-]/gi, "_")}.license`);
fs.writeFileSync(outPath, JSON.stringify(license, null, 2));

console.log(JSON.stringify(license, null, 2));
console.error(`\nWrote ${outPath}`);
