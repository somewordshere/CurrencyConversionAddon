const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, packageJson.version, "manifest and package versions must match");

const releaseFiles = [
  "manifest.json",
  "background/catalog.js",
  "background/rates.js",
  "background/service-worker.js",
  "content/content.js",
  "content/converter.js",
  "content/detector.js",
  "content/number-parser.js",
  "content/page-ui.js",
  "content/styles.css",
  "popup/popup.css",
  "popup/popup.html",
  "popup/popup.js",
  "shared/currencies.js",
  "shared/messages.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

for (const relativePath of releaseFiles) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `missing release file: ${relativePath}`);
}

for (const directory of ["background", "content", "popup", "shared"]) {
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(root, directory, name);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || `syntax check failed: ${file}`);
  }
}

console.log("project checks passed");
