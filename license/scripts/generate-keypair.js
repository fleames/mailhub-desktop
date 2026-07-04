/**
 * One-time setup. Run once, ever, for this product line.
 *
 *   node license/scripts/generate-keypair.js
 *
 * Writes license/keys/public.pem (safe to commit / bake into the app build)
 * and license/keys/private.pem (NEVER commit — this is the one secret that
 * matters; anyone who has it can forge valid licenses). Refuses to
 * overwrite an existing keypair so a re-run can't accidentally invalidate
 * every license already issued.
 */
const fs = require("fs");
const path = require("path");
const { generateKeyPairSync } = require("crypto");

const keysDir = path.join(__dirname, "..", "keys");
const publicPath = path.join(keysDir, "public.pem");
const privatePath = path.join(keysDir, "private.pem");

if (fs.existsSync(publicPath) || fs.existsSync(privatePath)) {
  console.error(
    `Keypair already exists at ${keysDir} — refusing to overwrite.\n` +
      `Every license issued so far was signed with that key; replacing it\n` +
      `would invalidate all of them. Delete both files yourself first if\n` +
      `you really mean to rotate the key.`
  );
  process.exit(1);
}

fs.mkdirSync(keysDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), {
  mode: 0o600,
});

console.log(`Wrote ${publicPath} (commit this — bake it into the app build)`);
console.log(`Wrote ${privatePath} (DO NOT commit — keep this off every machine that doesn't issue licenses)`);
