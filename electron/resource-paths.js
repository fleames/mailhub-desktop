/**
 * vendor/ sits next to the app source in dev, but electron-builder's
 * extraResources place it as a SIBLING of app.asar under resources/, not
 * inside it — so a path built from __dirname would look in the wrong
 * place once packaged. This is the one spot that knows the difference.
 *
 * mailhub-migrate is packaged differently from mailhub-server: it only
 * needs the single "postgres" package (see mailhub/scripts/migrate.mjs),
 * which it resolves as a bare import at runtime — Node's resolver walks up
 * ANCESTOR directories only, never sideways. mailhub-server ships its own
 * complete node_modules so placement doesn't matter for it, but
 * mailhub-migrate has none of its own, so it's packaged inside app/
 * (see electron-builder.yml's `files`, not `extraResources`) specifically
 * so it inherits resources/app/node_modules/postgres as an ancestor.
 * Shipping it as an extraResources sibling (as originally set up) silently
 * broke every migration run in a packaged build with MODULE_NOT_FOUND.
 */
const path = require("path");
const { app } = require("electron");

function vendorRoot() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "vendor");
}

function mailhubServerEntry() {
  return path.join(vendorRoot(), "mailhub-server", "server.js");
}

function mailhubMigrateEntry() {
  const migrateRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app", "vendor", "mailhub-migrate")
    : path.join(__dirname, "..", "vendor", "mailhub-migrate");
  return path.join(migrateRoot, "scripts", "migrate.mjs");
}

module.exports = { mailhubServerEntry, mailhubMigrateEntry };
