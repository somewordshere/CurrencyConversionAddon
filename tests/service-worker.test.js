const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const event = { addListener() {} };
const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async () => ({ ok: false, status: 503 }),
  ExtensionAPI: {
    runtime: {
      onInstalled: event,
      onStartup: event,
      onMessage: event,
      getManifest: () => ({ browser_specific_settings: { gecko: { id: "test@example" } } })
    },
    permissions: { onRemoved: event },
    contextMenus: { onClicked: event },
    commands: { onCommand: event },
    storage: { onChanged: event },
    tabs: {},
    scripting: {},
    action: {}
  }
});

for (const file of [
  "src/shared/currencies.js",
  "src/shared/messages.js",
  "src/shared/page-access.js",
  "src/background/catalog.js",
  "src/background/rates.js",
  "src/background/main.js"
]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, file), "utf8"),
    context,
    { filename: file }
  );
}

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
  const site = context.normalizeSite("https://shop.example/product?id=1");
  assert.deepEqual(JSON.parse(JSON.stringify(site)), {
    origin: "https://shop.example",
    hostname: "shop.example",
    pattern: "https://shop.example/*"
  });
  assert.equal(context.normalizeSite("chrome://extensions"), null);
  assert.equal(context.normalizeSite("file:///tmp/shop.html"), null);
  assert.equal(context.siteScriptId(site.origin), context.siteScriptId(site.origin));
  assert.notEqual(context.siteScriptId(site.origin), context.siteScriptId("https://other.example"));
});

test("content script paths suit registration and one-off injection", async () => {
  const originalTabsSendMessage = context.ExtensionAPI.tabs.sendMessage;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalRegister = context.ExtensionAPI.scripting.registerContentScripts;
  const originalInsertCss = context.ExtensionAPI.scripting.insertCSS;
  const originalExecuteScript = context.ExtensionAPI.scripting.executeScript;
  let registration;
  let cssInjection;
  let scriptInjection;

  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => [];
  context.ExtensionAPI.scripting.registerContentScripts = async ([value]) => {
    registration = value;
  };
  context.ExtensionAPI.tabs.sendMessage = async () => {
    throw new Error("Content script is not loaded yet.");
  };
  context.ExtensionAPI.scripting.insertCSS = async (value) => {
    cssInjection = value;
  };
  context.ExtensionAPI.scripting.executeScript = async (value) => {
    scriptInjection = value;
  };

  try {
    await context.registerSiteContentScript({
      origin: "https://shop.example",
      pattern: "https://shop.example/*"
    });
    await context.ensureContentScripts(42);

    assert.ok(registration.js.every((file) => !file.startsWith("/")));
    assert.ok(registration.css.every((file) => !file.startsWith("/")));
    assert.ok(scriptInjection.files.every((file) => file.startsWith("/")));
    assert.ok(cssInjection.files.every((file) => file.startsWith("/")));
    assert.equal(scriptInjection.target.tabId, 42);
  } finally {
    context.ExtensionAPI.tabs.sendMessage = originalTabsSendMessage;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.registerContentScripts = originalRegister;
    context.ExtensionAPI.scripting.insertCSS = originalInsertCss;
    context.ExtensionAPI.scripting.executeScript = originalExecuteScript;
  }
});

test("Firefox rejects remembered-site patterns with non-default ports", () => {
  assert.equal(context.normalizeSite("https://shop.example:8443/product"), null);
  assert.equal(context.normalizeSite("http://localhost:3000/"), null);
  assert.match(context.siteMemoryError("https://shop.example:8443/product"), /non-default port/);

  assert.equal(context.normalizeSite("https://shop.example:443/product").pattern, "https://shop.example/*");
  assert.equal(context.normalizeSite("http://shop.example:80/product").pattern, "http://shop.example/*");
});

test("Chrome keeps exact remembered-site patterns with non-default ports", () => {
  const getManifest = context.ExtensionAPI.runtime.getManifest;
  context.ExtensionAPI.runtime.getManifest = () => ({});
  try {
    const site = context.normalizeSite("https://shop.example:8443/product");
    assert.deepEqual(JSON.parse(JSON.stringify(site)), {
      origin: "https://shop.example:8443",
      hostname: "shop.example",
      pattern: "https://shop.example:8443/*"
    });
  } finally {
    context.ExtensionAPI.runtime.getManifest = getManifest;
  }
});

test("Firefox site status rejects protected pages and PDF viewers", async () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(await context.getSiteStatus("https://addons.mozilla.org/firefox/"))),
    {
      ok: false,
      remembered: false,
      error: "Firefox protects this Mozilla page from extensions. Open a regular shopping page and try again."
    }
  );
  assert.match(
    (await context.getSiteStatus("https://files.example/invoice.pdf")).error,
    /PDF viewer/
  );
});
