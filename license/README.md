# License system

Self-issued, Ed25519-signed license files. Verification is fully offline —
no license server, no recurring platform fee, no dependency on a
third-party staying in business.

## One-time setup

```bash
node license/scripts/generate-keypair.js
```

Writes `license/keys/public.pem` (commit it — this gets baked into the
Electron build) and `license/keys/private.pem` (**never commit this** — it's
the one secret that matters; anyone with it can forge valid licenses).
Refuses to run twice, since regenerating the keypair would invalidate every
license already issued.

## Issuing a license

```bash
node license/scripts/issue-license.js --email buyer@example.com --tier lifetime
node license/scripts/issue-license.js --email buyer@example.com --tier subscription --expires 2027-01-01
```

Prints the signed license JSON and writes it to
`license/issued/<email>.license` (gitignored — these are per-customer
artifacts, not source, and shouldn't pile up in git). Deliver the file to
the buyer (email attachment, or shown on the order confirmation page).
Eventually this gets called from a webhook handler instead of the CLI —
same function, different trigger.

## Verifying a license (what Electron does at startup)

```js
const { verifyLicense, loadLicenseFile } = require("./license/verify");
const publicKey = fs.readFileSync(path.join(__dirname, "license/keys/public.pem"), "utf8");

const license = loadLicenseFile(licenseFilePath);
const result = verifyLicense(license, publicKey, currentMachineFingerprint);
if (!result.valid) {
  // show the activation screen with result.reason
}
```

Runs entirely offline. Check it in the Electron **main** process, before
the embedded Postgres/Next.js server starts — there's nothing running yet
to reverse-engineer the check out of.

## Machine binding

`machineFingerprint` is `null` until first activation. Leave it `null` at
issue time; have the app itself write a fingerprint (e.g. via
`node-machine-id`) into a *locally re-signed* copy on first successful
activation if you want to hard-bind a license to one machine. This repo
doesn't do that step yet — `verify.js` supports it
(`currentMachineFingerprint` param), but nothing calls it with a real
fingerprint yet.

## Self-test

```bash
node license/scripts/self-test.js
```

Proves: a genuine license verifies, an expired one is rejected, a tampered
payload is rejected (signature mismatch), a license forged with a
different keypair is rejected, and machine-binding enforces the right
machine while rejecting the wrong one.
