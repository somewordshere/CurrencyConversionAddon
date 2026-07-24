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
    enabled: true,
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
  assert.equal(valid.showPagePrompt, true);

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
});

test("source currencies are resolved per website and new websites start in AUTO", () => {
  const preferences = {
    "https://shop.example": "USD",
    "https://another.example": "CHF"
  };

  assert.equal(
    context.resolveSiteSourceCurrency("https://shop.example/product", preferences, ["CHF", "USD"]),
    "USD"
  );
  assert.equal(
    context.resolveSiteSourceCurrency("https://new.example/product", preferences, ["CHF", "USD"]),
    "AUTO"
  );
  assert.equal(
    context.resolveSiteSourceCurrency("https://shop.example/product", preferences, ["EUR"]),
    "AUTO"
  );
  assert.equal(context.resolveSiteSourceCurrency("chrome://extensions", preferences, ["USD"]), "AUTO");
});

test("selecting AUTO removes a website's saved source currency", async () => {
  const originalLocalStorage = context.ExtensionAPI.storage.local;
  let state = {};
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: state[key] };
    },
    async set(values) {
      state = { ...state, ...values };
    }
  };

  try {
    await context.saveSiteSourceCurrency("https://shop.example/product", "USD", ["EUR", "USD"]);
    assert.equal(state.siteSourceCurrencies["https://shop.example"], "USD");

    await context.saveSiteSourceCurrency("https://shop.example/other", "AUTO", ["EUR", "USD"]);
    assert.equal(state.siteSourceCurrencies["https://shop.example"], undefined);
  } finally {
    context.ExtensionAPI.storage.local = originalLocalStorage;
  }
});

test("content script paths suit one-off fallback injection", async () => {
  const originalTabsSendMessage = context.ExtensionAPI.tabs.sendMessage;
  const originalInsertCss = context.ExtensionAPI.scripting.insertCSS;
  const originalExecuteScript = context.ExtensionAPI.scripting.executeScript;
  let cssInjection;
  let scriptInjection;

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
    await context.ensureContentScripts(42);

    assert.ok(scriptInjection.files.every((file) => file.startsWith("/")));
    assert.ok(cssInjection.files.every((file) => file.startsWith("/")));
    assert.equal(scriptInjection.target.tabId, 42);
  } finally {
    context.ExtensionAPI.tabs.sendMessage = originalTabsSendMessage;
    context.ExtensionAPI.scripting.insertCSS = originalInsertCss;
    context.ExtensionAPI.scripting.executeScript = originalExecuteScript;
  }
});

test("remembered-site preferences preserve non-default ports", () => {
  assert.equal(context.normalizeSite("https://shop.example:8443/product").pattern, "https://shop.example:8443/*");
  assert.equal(context.normalizeSite("http://localhost:3000/").pattern, "http://localhost:3000/*");
  assert.equal(context.normalizeSite("https://shop.example:443/product").pattern, "https://shop.example/*");
  assert.equal(context.normalizeSite("http://shop.example:80/product").pattern, "http://shop.example/*");
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
