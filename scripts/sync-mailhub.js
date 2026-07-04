/**
 * Copies the pieces of the mailhub repo this desktop app needs to run, into
 * vendor/. Run this after every `pnpm build` in the sibling mailhub repo,
 * and before packaging.
 *
 *   node scripts/sync-mailhub.js [path-to-mailhub-repo]
 *
 * Defaults to ../mailhub (sibling checkout). For a real release build,
 * this same script becomes the electron-builder `beforeBuild` step —
 * nothing about it is dev-only, it just also happens to be convenient
 * for local iteration.
 */
const fs = require("fs");
const path = require("path");

const mailhubRoot = process.argv[2] ?? path.join(__dirname, "..", "..", "mailhub");
const vendorRoot = path.join(__dirname, "..", "vendor");

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  const standaloneSrc = path.join(mailhubRoot, ".next", "standalone");
  if (!fs.existsSync(standaloneSrc)) {
    console.error(
      `No standalone build at ${standaloneSrc} — run "pnpm build" in ${mailhubRoot} first ` +
        `(and copy .next/static + public/ into .next/standalone/, same as the Docker setup does).`
    );
    process.exit(1);
  }
  if (!fs.existsSync(path.join(standaloneSrc, ".next", "static"))) {
    console.error(
      `${standaloneSrc}/.next/static is missing — Next's standalone output doesn't include ` +
        `static assets by default. Copy them in first:\n` +
        `  cp -r ${mailhubRoot}/.next/static ${standaloneSrc}/.next/static\n` +
        `  cp -r ${mailhubRoot}/public ${standaloneSrc}/public`
    );
    process.exit(1);
  }

  console.log(`Syncing server from ${standaloneSrc} …`);
  copyDir(standaloneSrc, path.join(vendorRoot, "mailhub-server"));

  console.log("Syncing migrations …");
  // migrate.mjs resolves `drizzle/` as a SIBLING of its own parent dir
  // (`dirname(__filename)/../drizzle`), so this mirrors mailhub's own
  // scripts/ + drizzle/ layout exactly rather than flattening it.
  const migrateDest = path.join(vendorRoot, "mailhub-migrate");
  fs.rmSync(migrateDest, { recursive: true, force: true });
  fs.mkdirSync(path.join(migrateDest, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(mailhubRoot, "scripts", "migrate.mjs"),
    path.join(migrateDest, "scripts", "migrate.mjs")
  );
  copyDir(path.join(mailhubRoot, "drizzle"), path.join(migrateDest, "drizzle"));

  console.log("Done. vendor/mailhub-server and vendor/mailhub-migrate are up to date.");
}

main();
