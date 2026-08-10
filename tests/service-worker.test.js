const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    }
  };
}

const runtimeOnInstalled = createEvent();
const runtimeOnStartup = createEvent();
const runtimeOnMessage = createEvent();
const permissionsOnRemoved = createEvent();
const contextMenusOnClicked = createEvent();
const commandsOnCommand = createEvent();
const storageOnChanged = createEvent();
const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async () => ({ ok: false, status: 503 }),
  ExtensionAPI: {
    runtime: {
      onInstalled: runtimeOnInstalled,
      onStartup: runtimeOnStartup,
      onMessage: runtimeOnMessage,
      getManifest: () => ({ browser_specific_settings: { gecko: { id: "test@example" } } })
    },
    permissions: { onRemoved: permissionsOnRemoved },
    contextMenus: { onClicked: contextMenusOnClicked },
    commands: { onCommand: commandsOnCommand },
    storage: { onChanged: storageOnChanged },
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
    convertedTextColor: "green",
    convertedBackgroundColor: "#12345g",
    convertedShape: "cloud",
    showPagePrompt: "yes"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(invalid)), {
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "EUR",
    displayMode: "beside",
    convertedTextColor: "#166534",
    convertedBackgroundColor: "#dcfce7",
    convertedShape: "rounded",
    showPagePrompt: true
  });

  const valid = context.sanitizeSettings({
    enabled: true,
    fromCurrency: "USD",
    toCurrency: "PLN",
    displayMode: "replace",
    convertedTextColor: "#ABCDEF",
    convertedBackgroundColor: "#123456",
    convertedShape: "pill",
    showPagePrompt: false
  });
  assert.equal(valid.enabled, true);
  assert.equal(valid.displayMode, "replace");
  assert.equal(valid.convertedTextColor, "#abcdef");
  assert.equal(valid.convertedBackgroundColor, "#123456");
  assert.equal(valid.convertedShape, "pill");
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

test("Firefox always-on page access supports websites with non-default ports", () => {
  const getManifest = context.ExtensionAPI.runtime.getManifest;
  context.ExtensionAPI.runtime.getManifest = () => ({
    browser_specific_settings: { gecko: { id: "test@example" } },
    content_scripts: [{ matches: ["http://*/*", "https://*/*"] }]
  });
  try {
    const site = context.normalizeSite("http://localhost:3000/product");
    assert.deepEqual(JSON.parse(JSON.stringify(site)), {
      origin: "http://localhost:3000",
      hostname: "localhost",
      pattern: "http://localhost:3000/*"
    });
  } finally {
    context.ExtensionAPI.runtime.getManifest = getManifest;
  }
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

test("site source currency is retained only for an approved remembered origin", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const stored = {
    autoConvertSites: {},
    siteSourceCurrencies: {}
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: stored[key] };
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;

  try {
    const site = context.normalizeSite("https://shop.example/product");
    assert.equal(await context.saveSiteSourceCurrency(site, "USD", ["EUR", "USD"]), false);
    assert.deepEqual(stored.siteSourceCurrencies, {});

    stored.autoConvertSites[site.origin] = true;
    assert.equal(await context.saveSiteSourceCurrency(site, "USD", ["EUR", "USD"]), true);
    assert.deepEqual(stored.siteSourceCurrencies, { "https://shop.example": "USD" });

    const resolved = await context.resolveSettingsForOrigin(
      {
        enabled: true,
        fromCurrency: "AUTO",
        toCurrency: "EUR",
        displayMode: "beside",
        showPagePrompt: true
      },
      site.origin,
      ["EUR", "USD"]
    );
    assert.equal(resolved.fromCurrency, "USD");

    await context.saveSiteSourceCurrency(site, "AUTO", ["EUR", "USD"]);
    assert.deepEqual(stored.siteSourceCurrencies, { "https://shop.example": "AUTO" });
    const autoResolved = await context.resolveSettingsForOrigin(
      {
        enabled: true,
        fromCurrency: "EUR",
        toCurrency: "USD",
        displayMode: "beside",
        showPagePrompt: true
      },
      site.origin,
      ["EUR", "USD"]
    );
    assert.equal(autoResolved.fromCurrency, "AUTO");
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
  }
});

test("global target change rejects a conflict with another remembered site's source", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const otherOrigin = "https://other-shop.example";
  const globalSettings = {
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "EUR",
    displayMode: "beside",
    showPagePrompt: true
  };
  const stored = {
    autoConvertSites: { [otherOrigin]: true },
    siteSourceCurrencies: { [otherOrigin]: "USD" }
  };
  let syncWriteCount = 0;

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "EUR" }, { code: "USD" }, { code: "PLN" }]
    })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return { ...globalSettings };
    },
    async set() {
      syncWriteCount += 1;
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: JSON.parse(JSON.stringify(stored[key])) };
    }
  };
  context.ExtensionAPI.permissions.contains = async ({ origins }) =>
    origins[0] === `${otherOrigin}/*`;

  try {
    const result = await context.updateSettings(
      { toCurrency: "USD" },
      "https://active-shop.example/product"
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /saved source for other-shop\.example/);
    assert.equal(syncWriteCount, 0);
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
  }
});

test("remembered-site source-only update does not write global sync settings", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const origin = "https://shop.example";
  const globalSettings = {
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "PLN",
    displayMode: "beside",
    showPagePrompt: true
  };
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "EUR" }
  };
  let syncWriteCount = 0;

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "EUR" }, { code: "USD" }, { code: "PLN" }]
    })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return { ...globalSettings };
    },
    async set() {
      syncWriteCount += 1;
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: JSON.parse(JSON.stringify(stored[key])) };
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;

  try {
    const result = await context.updateSettings({ fromCurrency: "AUTO" }, origin);
    assert.equal(result.ok, true);
    assert.equal(result.settings.fromCurrency, "AUTO");
    assert.equal(syncWriteCount, 0);
    assert.deepEqual(stored.siteSourceCurrencies, { [origin]: "AUTO" });
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
  }
});

test("settings updates remain ordered while pair validation is delayed", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalRates = context.CurrencyRateService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const origin = "https://shop.example/product";
  const stored = {
    enabled: true,
    fromCurrency: "USD",
    toCurrency: "EUR",
    displayMode: "beside",
    showPagePrompt: true
  };
  const writes = [];
  let rateCalls = 0;
  let signalValidationStarted;
  let releaseValidation;
  let secondSettled = false;
  const validationStarted = new Promise((resolve) => {
    signalValidationStarted = resolve;
  });
  const delayedValidation = new Promise((resolve) => {
    releaseValidation = resolve;
  });

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "CHF" }, { code: "EUR" }, { code: "USD" }]
    })
  };
  context.CurrencyRateService = {
    getRates: async () => {
      rateCalls += 1;
      if (rateCalls === 1) {
        signalValidationStarted();
        return delayedValidation;
      }
      return { ok: true, rates: { CHF: 1, EUR: 1.08 } };
    }
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return { ...stored };
    },
    async set(value) {
      const copy = JSON.parse(JSON.stringify(value));
      writes.push(copy);
      Object.assign(stored, copy);
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: {} };
    }
  };
  context.ExtensionAPI.permissions.contains = async () => false;

  try {
    const first = context.updateSettings({ fromCurrency: "CHF" }, origin);
    await validationStarted;
    const second = context.updateSettings({
      fromCurrency: "CHF",
      displayMode: "replace"
    }, origin).then((result) => {
      secondSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const settledBeforeRelease = secondSettled;

    releaseValidation({ ok: true, rates: { CHF: 1, EUR: 1.08 } });
    const results = await Promise.all([first, second]);

    assert.equal(results.every((result) => result.ok), true);
    assert.equal(settledBeforeRelease, false);
    assert.equal(rateCalls, 1);
    assert.deepEqual(
      writes.map((settings) => `${settings.fromCurrency}:${settings.displayMode}`),
      ["CHF:beside", "CHF:replace"]
    );
    assert.equal(stored.fromCurrency, "CHF");
    assert.equal(stored.displayMode, "replace");
  } finally {
    releaseValidation?.({ ok: true, rates: { CHF: 1, EUR: 1.08 } });
    context.CurrencyCatalogService = originalCatalog;
    context.CurrencyRateService = originalRates;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
  }
});

test("sync failure rolls back a remembered site's local source update", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const origin = "https://shop.example";
  const globalSettings = {
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "PLN",
    displayMode: "beside",
    showPagePrompt: true
  };
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "EUR" }
  };
  const localWrites = [];
  let syncWriteCount = 0;

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "EUR" }, { code: "USD" }, { code: "PLN" }]
    })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return { ...globalSettings };
    },
    async set() {
      syncWriteCount += 1;
      throw new Error("sync unavailable");
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: JSON.parse(JSON.stringify(stored[key])) };
    },
    async set(value) {
      const copy = JSON.parse(JSON.stringify(value));
      localWrites.push(copy);
      Object.assign(stored, copy);
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;

  try {
    const result = await context.updateSettings({
      fromCurrency: "AUTO",
      displayMode: "replace"
    }, origin);
    assert.equal(result.ok, false);
    assert.equal(result.partial, false);
    assert.match(result.error, /Global settings were not saved/);
    assert.equal(syncWriteCount, 1);
    assert.equal(localWrites.length, 2);
    assert.equal(localWrites[0].siteSourceCurrencies[origin], "AUTO");
    assert.equal(localWrites[1].siteSourceCurrencies[origin], "EUR");
    assert.deepEqual(stored.siteSourceCurrencies, { [origin]: "EUR" });
    assert.equal(result.settings.fromCurrency, "EUR");
    assert.equal(result.settings.displayMode, "beside");
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
  }
});

test("remember setup rolls back registration state and permission on failure", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalRegister = context.ExtensionAPI.scripting.registerContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: {},
    siteSourceCurrencies: {}
  };
  let permissionGranted = true;
  const registrationError = vm.runInContext('new Error("registration failed")', context);

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "EUR" }, { code: "USD" }]
    })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return {
        enabled: true,
        fromCurrency: "USD",
        toCurrency: "EUR",
        displayMode: "beside",
        showPagePrompt: true
      };
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: stored[key] };
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    }
  };
  context.ExtensionAPI.permissions.contains = async () => permissionGranted;
  context.ExtensionAPI.permissions.remove = async () => {
    permissionGranted = false;
    return true;
  };
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => [];
  context.ExtensionAPI.scripting.registerContentScripts = async () => {
    throw registrationError;
  };

  try {
    const result = await context.rememberSite(origin);
    assert.equal(result.ok, false);
    assert.equal(result.remembered, false);
    assert.equal(result.permissionRemaining, false);
    assert.equal(result.registrationRemaining, false);
    assert.equal(result.dataRemaining, false);
    assert.match(result.error, /registration failed/);
    assert.match(result.error, /permission was rolled back/);
    assert.equal(permissionGranted, false);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.registerContentScripts = originalRegister;
  }
});

test("remember rollback reports permission, registration, and data that remain", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalRegister = context.ExtensionAPI.scripting.registerContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: {},
    siteSourceCurrencies: {}
  };
  let registered = false;
  let storageWriteCount = 0;

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({
      currencies: [{ code: "EUR" }, { code: "USD" }]
    })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return {
        enabled: true,
        fromCurrency: "USD",
        toCurrency: "EUR",
        displayMode: "beside",
        showPagePrompt: true
      };
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: JSON.parse(JSON.stringify(stored[key])) };
    },
    async set(value) {
      storageWriteCount += 1;
      if (storageWriteCount === 1) {
        Object.assign(stored, JSON.parse(JSON.stringify(value)));
        throw new Error("setup storage result was uncertain");
      }
      throw new Error("saved site data could not be removed");
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;
  context.ExtensionAPI.permissions.remove = async () => false;
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () =>
    registered ? [{ id: context.siteScriptId(origin) }] : [];
  context.ExtensionAPI.scripting.registerContentScripts = async () => {
    registered = true;
  };
  context.ExtensionAPI.scripting.unregisterContentScripts = async () => {
    throw new Error("registration could not be removed");
  };

  try {
    const result = await context.rememberSite(origin);
    assert.equal(result.ok, false);
    assert.equal(result.remembered, true);
    assert.equal(result.permissionRemaining, true);
    assert.equal(result.registrationRemaining, true);
    assert.equal(result.dataRemaining, true);
    assert.match(result.error, /Some site access remains/);
    assert.equal(registered, true);
    assert.deepEqual(stored.autoConvertSites, { [origin]: true });
    assert.deepEqual(stored.siteSourceCurrencies, { [origin]: "USD" });
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.registerContentScripts = originalRegister;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("concurrent Remember mutations retain both site maps", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalSync = context.ExtensionAPI.storage.sync;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalRegister = context.ExtensionAPI.scripting.registerContentScripts;
  const originalUpdate = context.ExtensionAPI.scripting.updateContentScripts;
  const origins = ["https://shop.example", "https://other.example"];
  const stored = {
    autoConvertSites: {},
    siteSourceCurrencies: {}
  };
  let registered = [];
  let activeWrites = 0;
  let peakWrites = 0;

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({ currencies: [{ code: "EUR" }, { code: "USD" }] })
  };
  context.ExtensionAPI.storage.sync = {
    async get() {
      return {
        enabled: true,
        fromCurrency: "USD",
        toCurrency: "EUR",
        displayMode: "beside",
        showPagePrompt: true
      };
    }
  };
  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: JSON.parse(JSON.stringify(stored[key])) };
    },
    async set(value) {
      activeWrites += 1;
      peakWrites = Math.max(peakWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 10));
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
      activeWrites -= 1;
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async ({ ids } = {}) =>
    ids ? registered.filter((script) => ids.includes(script.id)) : registered;
  context.ExtensionAPI.scripting.registerContentScripts = async (scripts) => {
    registered.push(...JSON.parse(JSON.stringify(scripts)));
  };
  context.ExtensionAPI.scripting.updateContentScripts = async () => {};

  try {
    const results = await Promise.all(origins.map((origin) => context.rememberSite(origin)));
    assert.equal(results.every((result) => result.ok), true);
    assert.deepEqual(stored.autoConvertSites, {
      [origins[0]]: true,
      [origins[1]]: true
    });
    assert.deepEqual(stored.siteSourceCurrencies, {
      [origins[0]]: "USD",
      [origins[1]]: "USD"
    });
    assert.equal(peakWrites, 1);
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.sync = originalSync;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.registerContentScripts = originalRegister;
    context.ExtensionAPI.scripting.updateContentScripts = originalUpdate;
  }
});

test("forget site removes registration, permission, preference, and source override", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "USD" }
  };
  let removedPermission;
  let unregisteredIds;
  let permissionGranted = true;
  let registrationPresent = true;

  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: stored[key] };
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    }
  };
  context.ExtensionAPI.permissions.contains = async () => permissionGranted;
  context.ExtensionAPI.permissions.remove = async (value) => {
    removedPermission = value;
    permissionGranted = false;
    return true;
  };
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () =>
    registrationPresent ? [{ id: context.siteScriptId(origin) }] : [];
  context.ExtensionAPI.scripting.unregisterContentScripts = async ({ ids }) => {
    unregisteredIds = ids;
    registrationPresent = false;
  };

  try {
    const result = await context.forgetSite(`${origin}/product`);
    assert.equal(result.ok, true);
    assert.equal(result.remembered, false);
    assert.equal(result.permissionRemaining, false);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
    assert.deepEqual(JSON.parse(JSON.stringify(unregisteredIds)), [context.siteScriptId(origin)]);
    assert.deepEqual(JSON.parse(JSON.stringify(removedPermission)), {
      origins: [`${origin}/*`]
    });
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("1.7.2 migration removes the legacy all-sites grant", async () => {
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const granted = new Set(["http://*/*", "https://*/*"]);
  const removed = [];
  context.ExtensionAPI.permissions.contains = async ({ origins }) =>
    origins.every((origin) => granted.has(origin));
  context.ExtensionAPI.permissions.remove = async (value) => {
    removed.push(JSON.parse(JSON.stringify(value)));
    value.origins.forEach((origin) => granted.delete(origin));
    return true;
  };

  try {
    await context.removeLegacyAllSitesPermission();
    assert.deepEqual(removed, [
      { origins: ["http://*/*"] },
      { origins: ["https://*/*"] }
    ]);
    assert.deepEqual([...granted], []);
  } finally {
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
  }
});

test("only 1.7.0 through 1.7.2 updates qualify for the reset notice", () => {
  assert.equal(context.isLegacyBroadAccessUpdate({ reason: "update", previousVersion: "1.7.0" }), true);
  assert.equal(context.isLegacyBroadAccessUpdate({ reason: "update", previousVersion: "1.7.2" }), true);
  assert.equal(context.isLegacyBroadAccessUpdate({ reason: "update", previousVersion: "1.7.3" }), false);
  assert.equal(context.isLegacyBroadAccessUpdate({ reason: "update", previousVersion: "1.6.9" }), false);
  assert.equal(context.isLegacyBroadAccessUpdate({ reason: "install", previousVersion: "1.7.2" }), false);
});

test("legacy cleanup removes a surviving single-scheme grant", async () => {
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const granted = new Set(["https://*/*"]);
  const removed = [];
  context.ExtensionAPI.permissions.contains = async ({ origins }) =>
    origins.every((origin) => granted.has(origin));
  context.ExtensionAPI.permissions.remove = async ({ origins }) => {
    removed.push(...origins);
    origins.forEach((origin) => granted.delete(origin));
    return true;
  };

  try {
    await context.removeLegacyAllSitesPermission();
    assert.deepEqual(removed, ["https://*/*"]);
    assert.deepEqual([...granted], []);
  } finally {
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
  }
});

test("legacy site reset clears CCP registrations and maps and sets its notice", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const stored = {
    autoConvertSites: {
      "https://shop.example": true,
      "https://other.example": true
    },
    siteSourceCurrencies: {
      "https://shop.example": "USD"
    },
    siteAccessResetNotice: false,
    siteAccessResetPending: true,
    unrelated: "keep"
  };
  let registered = [
    { id: "ccp_site_one" },
    { id: "unrelated_script" },
    { id: "ccp_site_two" }
  ];
  let unregisteredIds = [];

  context.ExtensionAPI.storage.local = {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, stored[key]]));
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      delete stored[key];
    }
  };
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => registered;
  context.ExtensionAPI.scripting.unregisterContentScripts = async ({ ids }) => {
    unregisteredIds = [...ids];
    registered = registered.filter((script) => !ids.includes(script.id));
  };

  try {
    await context.resetLegacySiteAccess();
    assert.deepEqual(unregisteredIds, ["ccp_site_one", "ccp_site_two"]);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
    assert.equal(stored.siteAccessResetNotice, true);
    assert.equal(stored.siteAccessResetPending, undefined);
    assert.equal(stored.unrelated, "keep");
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("a pending legacy reset survives failure and retries on maintenance", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const stored = {
    autoConvertSites: { "https://shop.example": true },
    siteSourceCurrencies: { "https://shop.example": "USD" },
    siteAccessResetNotice: false
  };
  const broadPermissions = new Set(["http://*/*", "https://*/*"]);
  let registered = [{ id: "ccp_site_retry" }];
  let unregisterAttempts = 0;

  context.ExtensionAPI.storage.local = {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, stored[key]]));
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      delete stored[key];
    }
  };
  context.ExtensionAPI.permissions.contains = async ({ origins }) =>
    origins.every((origin) => broadPermissions.has(origin));
  context.ExtensionAPI.permissions.remove = async ({ origins }) => {
    origins.forEach((origin) => broadPermissions.delete(origin));
    return true;
  };
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => registered;
  context.ExtensionAPI.scripting.unregisterContentScripts = async ({ ids }) => {
    unregisterAttempts += 1;
    if (unregisterAttempts === 1) throw new Error("temporary unregister failure");
    registered = registered.filter((script) => !ids.includes(script.id));
  };

  try {
    await assert.rejects(
      context.runLegacySiteAccessMaintenance({ reason: "update", previousVersion: "1.7.1" }),
      /temporary unregister failure/
    );
    assert.equal(stored.siteAccessResetPending, true);
    assert.equal(stored.siteAccessResetNotice, false);
    assert.deepEqual(stored.autoConvertSites, { "https://shop.example": true });

    assert.equal(await context.runLegacySiteAccessMaintenance(), true);
    assert.equal(stored.siteAccessResetPending, undefined);
    assert.equal(stored.siteAccessResetNotice, true);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
    assert.deepEqual(registered, []);
    assert.equal(unregisterAttempts, 2);
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("legacy reset serializes permission-removal reconciliation behind cleanup", async () => {
  const originalCatalog = context.CurrencyCatalogService;
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalRegister = context.ExtensionAPI.scripting.registerContentScripts;
  const originalUpdate = context.ExtensionAPI.scripting.updateContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "USD" },
    siteAccessResetNotice: false
  };
  const broadPermissions = new Set(["http://*/*", "https://*/*"]);
  let registered = [{ id: context.siteScriptId(origin) }];
  let registrationWrites = 0;
  const reconciliationPromises = [];

  context.CurrencyCatalogService = {
    getCurrencies: async () => ({ currencies: [{ code: "EUR" }, { code: "USD" }] })
  };
  context.ExtensionAPI.storage.local = {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [
        key,
        JSON.parse(JSON.stringify(stored[key]))
      ]));
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      delete stored[key];
    }
  };
  context.ExtensionAPI.permissions.contains = async ({ origins }) => origins.every((value) =>
    value === `${origin}/*` || broadPermissions.has(value)
  );
  context.ExtensionAPI.permissions.remove = async ({ origins }) => {
    origins.forEach((value) => broadPermissions.delete(value));
    reconciliationPromises.push(...permissionsOnRemoved.emit({ origins }));
    return true;
  };
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async ({ ids } = {}) =>
    ids ? registered.filter((script) => ids.includes(script.id)) : registered;
  context.ExtensionAPI.scripting.registerContentScripts = async (scripts) => {
    registrationWrites += 1;
    registered.push(...scripts);
  };
  context.ExtensionAPI.scripting.updateContentScripts = async () => {
    registrationWrites += 1;
  };
  context.ExtensionAPI.scripting.unregisterContentScripts = async ({ ids }) => {
    registered = registered.filter((script) => !ids.includes(script.id));
  };

  try {
    assert.equal(await context.runLegacySiteAccessMaintenance({
      reason: "update",
      previousVersion: "1.7.2"
    }), true);
    await Promise.all(reconciliationPromises);
    assert.equal(registrationWrites, 0);
    assert.deepEqual(registered, []);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
    assert.equal(stored.siteAccessResetNotice, true);
    assert.equal(stored.siteAccessResetPending, undefined);
  } finally {
    context.CurrencyCatalogService = originalCatalog;
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.registerContentScripts = originalRegister;
    context.ExtensionAPI.scripting.updateContentScripts = originalUpdate;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("forget reports a permission that the browser did not remove", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalRemove = context.ExtensionAPI.permissions.remove;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const originalUnregister = context.ExtensionAPI.scripting.unregisterContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "USD" }
  };
  let unregisterAttempted = false;
  let registrationPresent = true;

  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: stored[key] };
    },
    async set(value) {
      Object.assign(stored, JSON.parse(JSON.stringify(value)));
    }
  };
  context.ExtensionAPI.permissions.contains = async () => true;
  context.ExtensionAPI.permissions.remove = async () => false;
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () =>
    registrationPresent ? [{ id: context.siteScriptId(origin) }] : [];
  context.ExtensionAPI.scripting.unregisterContentScripts = async () => {
    unregisterAttempted = true;
    registrationPresent = false;
  };

  try {
    const result = await context.forgetSite(origin);
    assert.equal(result.ok, false);
    assert.equal(result.remembered, false);
    assert.equal(result.permissionRemaining, true);
    assert.equal(result.registrationRemaining, false);
    assert.equal(result.dataRemaining, false);
    assert.match(result.error, /permission is still present/);
    assert.equal(unregisterAttempted, true);
    assert.deepEqual(stored.autoConvertSites, {});
    assert.deepEqual(stored.siteSourceCurrencies, {});
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.permissions.remove = originalRemove;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
    context.ExtensionAPI.scripting.unregisterContentScripts = originalUnregister;
  }
});

test("site status exposes orphaned registration and saved data for recovery", async () => {
  const originalLocal = context.ExtensionAPI.storage.local;
  const originalContains = context.ExtensionAPI.permissions.contains;
  const originalGetRegistered = context.ExtensionAPI.scripting.getRegisteredContentScripts;
  const origin = "https://shop.example";
  const stored = {
    autoConvertSites: { [origin]: true },
    siteSourceCurrencies: { [origin]: "USD" }
  };

  context.ExtensionAPI.storage.local = {
    async get(key) {
      return { [key]: stored[key] };
    }
  };
  context.ExtensionAPI.permissions.contains = async () => false;
  context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => [
    { id: context.siteScriptId(origin) }
  ];

  try {
    const result = await context.getSiteStatus(`${origin}/product`);
    assert.equal(result.ok, true);
    assert.equal(result.remembered, false);
    assert.equal(result.hasPermission, false);
    assert.equal(result.registrationRemaining, true);
    assert.equal(result.dataRemaining, true);
    assert.equal(result.cleanupRequired, true);
  } finally {
    context.ExtensionAPI.storage.local = originalLocal;
    context.ExtensionAPI.permissions.contains = originalContains;
    context.ExtensionAPI.scripting.getRegisteredContentScripts = originalGetRegistered;
  }
});

test("the exchange-rate provider cannot be remembered as a conversion site", async () => {
  const originalContains = context.ExtensionAPI.permissions.contains;
  let permissionChecks = 0;
  context.ExtensionAPI.permissions.contains = async () => {
    permissionChecks += 1;
    return true;
  };

  try {
    const status = await context.getSiteStatus("https://api.frankfurter.dev/test-shop");
    const remembered = await context.rememberSite("https://api.frankfurter.dev/test-shop");
    assert.equal(status.ok, false);
    assert.equal(status.remembered, false);
    assert.match(status.error, /exchange-rate provider.*cannot be enabled/i);
    assert.equal(remembered.ok, false);
    assert.equal(remembered.remembered, false);
    assert.match(remembered.error, /exchange-rate provider.*cannot be enabled/i);
    assert.equal(permissionChecks, 0);
  } finally {
    context.ExtensionAPI.permissions.contains = originalContains;
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
