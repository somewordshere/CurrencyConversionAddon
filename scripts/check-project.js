const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const baseManifest = readJson("manifests/base.json");
const chromeManifest = readJson("manifests/chrome.json");
const firefoxManifest = readJson("manifests/firefox.json");

assert.equal(baseManifest.manifest_version, 3);
assert.equal(baseManifest.version, packageJson.version, "manifest and package versions must match");
assert.equal(chromeManifest.background.service_worker, "background/chrome-worker.js");
assert.ok(Array.isArray(firefoxManifest.background.scripts));
assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "140.0");
assert.equal(firefoxManifest.browser_specific_settings.gecko_android.strict_min_version, "142.0");
assert.deepEqual(
  firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required,
  ["websiteContent"]
);

const runtimeFiles = [
  "src/background/catalog.js",
  "src/background/chrome-worker.js",
  "src/background/main.js",
  "src/background/rates.js",
  "src/content/content.js",
  "src/content/converter.js",
  "src/content/detector.js",
  "src/content/number-parser.js",
  "src/content/page-ui.js",
  "src/content/styles.css",
  "src/popup/popup.css",
  "src/popup/popup.html",
  "src/popup/popup.js",
  "src/shared/browser-api.js",
  "src/shared/currencies.js",
  "src/shared/messages.js",
  "src/icons/icon16.png",
  "src/icons/icon32.png",
  "src/icons/icon48.png",
  "src/icons/icon128.png"
];

for (const relativePath of runtimeFiles) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `missing runtime file: ${relativePath}`);
}

for (const directory of ["background", "content", "popup", "shared"]) {
  for (const name of fs.readdirSync(path.join(root, "src", directory))) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(root, "src", directory, name);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || `syntax check failed: ${file}`);
  }
}

for (const file of walkJavaScript(path.join(root, "src"))) {
  const contents = fs.readFileSync(file, "utf8");
  if (file.endsWith("browser-api.js")) continue;
  assert.doesNotMatch(contents, /\b(?:chrome|browser)\./, `use ExtensionAPI in ${file}`);
}

console.log("project checks passed");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function walkJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(target);
    return entry.name.endsWith(".js") ? [target] : [];
  });
}
