const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const event = { addListener() {} };
let context;
context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async () => ({ ok: false, status: 503 }),
  importScripts(...files) {
    for (const file of files) {
      const resolved = path.resolve(root, "background", file);
      vm.runInContext(fs.readFileSync(resolved, "utf8"), context, { filename: resolved });
    }
  },
  chrome: {
    runtime: { onInstalled: event, onStartup: event, onMessage: event },
    permissions: { onRemoved: event },
    contextMenus: { onClicked: event },
    commands: { onCommand: event },
    storage: { onChanged: event },
    tabs: {},
    scripting: {},
    action: {}
  }
});

vm.runInContext(
  fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8"),
  context,
  { filename: "background/service-worker.js" }
);

test("settings are restricted to supported values", () => {
  const invalid = context.sanitizeSettings({
    enabled: "yes",
    fromCurrency: "BTC",
    toCurrency: "DOGE",
    displayMode: "html",
    showPagePrompt: "yes"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invalid)), {
    enabled: false,
    fromCurrency: "AUTO",
    toCurrency: "EUR",
    displayMode: "beside",
    showPagePrompt: true
  });

  const valid = context.sanitizeSettings({
    enabled: true,
    fromCurrency: "USD",
    toCurrency: "PLN",
    displayMode: "replace",
    showPagePrompt: false
  });
  assert.equal(valid.enabled, true);
  assert.equal(valid.displayMode, "replace");
  assert.equal(valid.showPagePrompt, false);

  const providerExpanded = context.sanitizeSettings({
    enabled: true,
    fromCurrency: "AFN",
    toCurrency: "XAU",
    displayMode: "beside",
    showPagePrompt: true
  }, ["AFN", "EUR", "XAU"]);
  assert.equal(providerExpanded.fromCurrency, "AFN");
  assert.equal(providerExpanded.toCurrency, "XAU");
});

test("remembered-site access is normalized to one web origin", () => {
  const site = context.normalizeSite("https://shop.example:8443/product?id=1");
  assert.deepEqual(JSON.parse(JSON.stringify(site)), {
    origin: "https://shop.example:8443",
    hostname: "shop.example",
    pattern: "https://shop.example:8443/*"
  });
  assert.equal(context.normalizeSite("chrome://extensions"), null);
  assert.equal(context.normalizeSite("file:///tmp/shop.html"), null);
  assert.equal(context.siteScriptId(site.origin), context.siteScriptId(site.origin));
  assert.notEqual(context.siteScriptId(site.origin), context.siteScriptId("https://other.example"));
});
