const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const baseManifest = readJson("manifests/base.json");
const chromeManifest = readJson("manifests/chrome.json");
const firefoxManifest = readJson("manifests/firefox.json");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const nodeVersion = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "src/popup/popup.html"), "utf8");
const backgroundMain = fs.readFileSync(path.join(root, "src/background/main.js"), "utf8");
const backgroundPageActions = fs.readFileSync(
  path.join(root, "src/background/page-actions.js"),
  "utf8"
);
const backgroundRuntime = fs.readdirSync(path.join(root, "src/background"))
  .filter((name) => name.endsWith(".js") && name !== "chrome-worker.js")
  .map((name) => fs.readFileSync(path.join(root, "src/background", name), "utf8"))
  .join("\n");
const chromeWorker = fs.readFileSync(path.join(root, "src/background/chrome-worker.js"), "utf8");

assert.equal(baseManifest.manifest_version, 3);
assert.equal(baseManifest.version, packageJson.version, "manifest and package versions must match");
assert.ok(baseManifest.description.length <= 132, "manifest description must not exceed 132 characters");
assert.equal(packageLock.version, packageJson.version, "lockfile and package versions must match");
assert.equal(nodeVersion, "22", ".nvmrc must match the Node.js version used by CI");
assert.equal(
  packageLock.packages?.[""]?.version,
  packageJson.version,
  "lockfile root package version must match"
);
assert.ok(
  readme.includes(`**Current version:** ${packageJson.version}`),
  "README current version must match the package"
);
assert.ok(
  readme.includes(`release/${packageJson.version}/currency-converter-pro-${packageJson.version}-chrome.zip`) &&
    readme.includes(`release/${packageJson.version}/currency-converter-pro-${packageJson.version}-firefox.zip`),
  "README release links must match the package version"
);
assert.ok(
  changelog.includes(`## ${packageJson.version} -`),
  "changelog must include the package version"
);
assert.deepEqual(
  baseManifest.host_permissions,
  ["https://api.frankfurter.dev/*"],
  "required host access must be limited to the exchange-rate provider"
);
assert.equal(Object.hasOwn(baseManifest, "optional_host_permissions"), false);
assert.ok(Array.isArray(baseManifest.content_scripts) && baseManifest.content_scripts.length === 1);
assert.deepEqual(
  baseManifest.content_scripts[0].matches,
  ["http://*/*", "https://*/*"],
  "ordinary websites must receive the always-on local price detector"
);
assert.equal(baseManifest.content_scripts[0].run_at, "document_idle");
assert.ok(baseManifest.content_scripts[0].js?.length > 0, "content script JavaScript must be declared");
assert.ok(baseManifest.content_scripts[0].css?.length > 0, "content script styles must be declared");
assert.ok(baseManifest.permissions.includes("activeTab"));
assert.ok(baseManifest.permissions.includes("scripting"));
assert.doesNotMatch(
  backgroundRuntime,
  /ExtensionAPI\.permissions/,
  "the always-on runtime must not restore optional-origin permission branching"
);
assert.doesNotMatch(
  backgroundRuntime,
  /\.(?:registerContentScripts|updateContentScripts)\(/,
  "the always-on runtime must not dynamically register per-site content scripts"
);
assert.match(
  backgroundPageActions,
  /getManifest\(\)\.content_scripts/,
  "fallback injection must derive its files from the declarative manifest"
);
assert.match(
  backgroundRuntime,
  /settingsSchema\.sanitize/,
  "background settings must use the shared CurrencySettings schema"
);
assert.doesNotMatch(
  backgroundRuntime,
  /const DEFAULT_SETTINGS\b/,
  "background settings defaults must not diverge from CurrencySettings.DEFAULTS"
);
assert.ok(
  backgroundMain.split(/\r?\n/).length <= 150,
  "background/main.js must remain a small listener and routing entry point"
);
assert.match(gitignore, /^artifacts\/$/m, "generated browser artifacts must stay ignored");
assert.match(
  gitignore,
  /^release\/\*\/\*\/$/m,
  "unpacked release directories must stay ignored"
);
assert.equal(chromeManifest.background.service_worker, "background/chrome-worker.js");
assert.ok(Array.isArray(firefoxManifest.background.scripts));
const chromeBackgroundScripts = [...chromeWorker.matchAll(/["']([^"']+\.js)["']/g)]
  .map((match) => match[1].startsWith("../")
    ? match[1].slice(3)
    : `background/${match[1]}`);
assert.deepEqual(
  chromeBackgroundScripts,
  firefoxManifest.background.scripts,
  "Chrome and Firefox background scripts must load in the same order"
);
assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "140.0");
assert.equal(firefoxManifest.browser_specific_settings.gecko_android.strict_min_version, "142.0");
assert.deepEqual(
  firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required,
  ["websiteContent"]
);

const popupScripts = [...popupHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  .map((match) => match[1]);
assert.deepEqual(
  popupScripts,
  [
    "../shared/browser-api.js",
    "../shared/currencies.js",
    "../shared/settings.js",
    "../shared/messages.js",
    "../shared/page-access.js",
    "../content/number-parser.js",
    "content-script-resources.js",
    "settings-controller.js",
    "popup.js"
  ],
  "popup classic scripts must preserve their dependency order"
);
for (const source of popupScripts) {
  const file = path.resolve(root, "src/popup", source);
  assert.ok(fs.existsSync(file), `popup references missing script: ${source}`);
}

for (const file of [
  ...baseManifest.content_scripts[0].js,
  ...baseManifest.content_scripts[0].css,
  ...firefoxManifest.background.scripts
]) {
  assert.ok(fs.existsSync(path.join(root, "src", file)), `manifest references missing file: ${file}`);
}

const runtimeFiles = [
  "src/background/catalog.js",
  "src/background/chrome-worker.js",
  "src/background/main.js",
  "src/background/page-actions.js",
  "src/background/rates.js",
  "src/background/settings-service.js",
  "src/background/site-preferences.js",
  "src/content/content.js",
  "src/content/converter.js",
  "src/content/detector.js",
  "src/content/number-parser.js",
  "src/content/page-ui.js",
  "src/content/styles.css",
  "src/popup/popup.css",
  "src/popup/popup.html",
  "src/popup/popup.js",
  "src/popup/content-script-resources.js",
  "src/popup/settings-controller.js",
  "src/shared/browser-api.js",
  "src/shared/currencies.js",
  "src/shared/settings.js",
  "src/shared/messages.js",
  "src/shared/page-access.js",
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
