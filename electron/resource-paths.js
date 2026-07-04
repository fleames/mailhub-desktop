/**
 * vendor/ sits next to the app source in dev, but electron-builder's
 * extraResources place it as a SIBLING of app.asar under resources/, not
 * inside it — so a path built from __dirname would look in the wrong
 * place once packaged. This is the one spot that knows the difference.
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
  return path.join(vendorRoot(), "mailhub-migrate", "scripts", "migrate.mjs");
}

module.exports = { mailhubServerEntry, mailhubMigrateEntry };
