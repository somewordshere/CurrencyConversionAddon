const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const baseManifest = readJson("manifests/base.json");
const firefoxOverride = readJson("manifests/firefox.json");
const firefoxManifest = { ...baseManifest, ...firefoxOverride };

const DEFAULT_SYNC_SETTINGS = {
  enabled: true,
  fromCurrency: "AUTO",
  toCurrency: "EUR",
  displayMode: "beside",
  convertedTextColor: "#166534",
  convertedBackgroundColor: "#dcfce7",
  convertedShape: "rounded",
  showPagePrompt: true
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plain(value) {
  return clone(value);
}

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    },
    get listenerCount() {
      return listeners.length;
    }
  };
}

async function emitAndWait(event, ...args) {
  return Promise.all(event.emit(...args));
}

function selectStoredValues(store, keys) {
  if (keys == null) return clone(store);
  if (typeof keys === "string") return { [keys]: clone(store[keys]) };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, clone(store[key])]));
  }
  return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
    key,
    Object.hasOwn(store, key) ? clone(store[key]) : clone(fallback)
  ]));
}

function createStorageArea(store) {
  return {
    async get(keys) {
      return selectStoredValues(store, keys);
    },
    async set(values) {
      for (const [key, value] of Object.entries(clone(values))) store[key] = value;
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    }
  };
}

function createBackground({
  sync = DEFAULT_SYNC_SETTINGS,
  local = {},
  registered = [],
  entrypoint = "firefox"
} = {}) {
  const syncStore = clone(sync);
  const localStore = clone(local);
  let registeredScripts = clone(registered);
  const injected = { css: [], js: [] };
  const events = {
    installed: createEvent(),
    startup: createEvent(),
    message: createEvent(),
    contextMenu: createEvent(),
    command: createEvent()
  };
  const extensionApi = {
    runtime: {
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message,
      getManifest: () => firefoxManifest
    },
    contextMenus: {
      onClicked: events.contextMenu,
      async removeAll() {},
      create() {}
    },
    commands: { onCommand: events.command },
    storage: {
      sync: createStorageArea(syncStore),
      local: createStorageArea(localStore)
    },
    tabs: {
      async query() { return []; },
      async sendMessage() { return { ok: true }; }
    },
    scripting: {
      async getRegisteredContentScripts({ ids } = {}) {
        const scripts = ids
          ? registeredScripts.filter((script) => ids.includes(script.id))
          : registeredScripts;
        return clone(scripts);
      },
      async unregisterContentScripts({ ids }) {
        registeredScripts = registeredScripts.filter((script) => !ids.includes(script.id));
      },
      async insertCSS(value) {
        injected.css.push(clone(value));
      },
      async executeScript(value) {
        injected.js.push(clone(value));
      }
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {}
    }
  };
  const globals = {
    console,
    URL,
    Error,
    Date,
    Intl,
    Object,
    Promise,
    AbortController,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: false, status: 503 })
  };
  globals[entrypoint === "chrome" ? "chrome" : "browser"] = extensionApi;
  const context = vm.createContext(globals);
  const loadedScripts = [];

  function evaluateRuntimeFile(file, filename = `src/${file}`) {
    vm.runInContext(
      fs.readFileSync(path.join(root, "src", file), "utf8"),
      context,
      { filename }
    );
  }

  if (entrypoint === "chrome") {
    const sourceRoot = path.join(root, "src");
    const workerRoot = path.join(sourceRoot, "background");
    context.importScripts = (...files) => {
      for (const file of files) {
        const target = path.resolve(workerRoot, file);
        const relativePath = path.relative(sourceRoot, target).replaceAll("\\", "/");
        assert.equal(
          relativePath.startsWith("../"),
          false,
          `Chrome worker imported a script outside src: ${file}`
        );
        loadedScripts.push(relativePath);
        evaluateRuntimeFile(relativePath);
      }
    };
    evaluateRuntimeFile("background/chrome-worker.js");
  } else {
    for (const file of firefoxManifest.background.scripts) {
      loadedScripts.push(file);
      evaluateRuntimeFile(file);
    }
  }

  return {
    context,
    events,
    injected,
    localStore,
    syncStore,
    loadedScripts,
    get registeredScripts() {
      return clone(registeredScripts);
    }
  };
}

function stubCatalog(
  context,
  codes = ["EUR", "PLN", "USD"],
  rateService = context.CurrencyRateService
) {
  const catalogService = {
    async getCurrencies() {
      return { currencies: codes.map((code) => ({ code })) };
    }
  };
  context.CurrencySettingsService = context.CurrencySettingsService.create({
    api: context.ExtensionAPI,
    catalogService,
    rateService,
    currencyCatalog: context.CurrencyCatalog,
    settingsSchema: context.CurrencySettings,
    sitePreferences: context.CurrencySitePreferences
  });
}

test("service-worker tests use the released merged Firefox manifest", () => {
  const { context } = createBackground();
  assert.deepEqual(
    firefoxManifest.content_scripts[0].matches,
    ["http://*/*", "https://*/*"]
  );
  assert.equal(firefoxManifest.content_scripts[0].run_at, "document_idle");
  assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.equal(context.ExtensionAPI, context.browser);
  assert.equal(Object.hasOwn(context.ExtensionAPI, "permissions"), false);
});

test("Chrome worker executes the same classic-script graph and listener bootstrap as Firefox", () => {
  const chromeBackground = createBackground({ entrypoint: "chrome" });
  const firefoxBackground = createBackground();
  const serviceGlobals = [
    "CurrencySitePreferences",
    "CurrencySettingsService",
    "CurrencyPageActions",
    "CurrencyBackground"
  ];

  assert.deepEqual(chromeBackground.loadedScripts, firefoxManifest.background.scripts);
  assert.deepEqual(chromeBackground.loadedScripts, firefoxBackground.loadedScripts);
  assert.equal(chromeBackground.context.ExtensionAPI, chromeBackground.context.chrome);
  assert.equal(Object.hasOwn(chromeBackground.context, "browser"), false);
  for (const name of serviceGlobals) {
    assert.equal(typeof chromeBackground.context[name], typeof firefoxBackground.context[name]);
    assert.equal(typeof chromeBackground.context[name], "object");
  }
  for (const name of ["installed", "startup", "message", "contextMenu", "command"]) {
    assert.equal(chromeBackground.events[name].listenerCount, 1, `${name} listener was not installed`);
    assert.equal(
      chromeBackground.events[name].listenerCount,
      firefoxBackground.events[name].listenerCount,
      `${name} listener count differs between Chrome and Firefox`
    );
  }
});

test("onInstalled initializes defaults, the context menu, and reconciliation in order", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: {},
    local: {
      favoriteCurrencies: ["EUR", "USD"],
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "USD" },
      siteAccessResetNotice: true,
      siteAccessResetPending: true
    },
    registered: [
      { id: "ccp_site_stale" },
      { id: "unrelated_script" }
    ]
  });
  const { context } = background;
  const api = context.ExtensionAPI;
  const order = [];
  const createdMenus = [];
  const originalLocalRemove = api.storage.local.remove;
  const originalGetRegisteredContentScripts = api.scripting.getRegisteredContentScripts;

  context.CurrencyCatalogService = Object.freeze({
    async getCurrencies() {
      return {
        currencies: ["EUR", "USD"].map((code) => ({ code }))
      };
    }
  });
  api.storage.local.remove = async (keys) => {
    await originalLocalRemove(keys);
    if (keys === "favoriteCurrencies") order.push("defaults");
  };
  api.contextMenus.create = (menu) => {
    createdMenus.push(plain(menu));
    order.push("context-menu");
  };
  api.scripting.getRegisteredContentScripts = async (options) => {
    order.push("reconcile");
    return originalGetRegisteredContentScripts(options);
  };

  await emitAndWait(background.events.installed, { reason: "install" });

  assert.deepEqual(order, ["defaults", "context-menu", "reconcile"]);
  assert.deepEqual(background.syncStore, DEFAULT_SYNC_SETTINGS);
  assert.deepEqual(createdMenus, [{
    id: "convert-selection",
    title: "Convert selected currency",
    contexts: ["selection"]
  }]);
  assert.equal(background.localStore.favoriteCurrencies, undefined);
  assert.equal(background.localStore.siteAccessResetNotice, undefined);
  assert.equal(background.localStore.siteAccessResetPending, undefined);
  assert.deepEqual(background.registeredScripts, [{ id: "unrelated_script" }]);
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "USD" });
});

test("onStartup delegates to remembered-site reconciliation", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    local: {
      autoConvertSites: {
        [origin]: true,
        "not a site": true
      },
      siteSourceCurrencies: {
        [origin]: "USD",
        "https://unused.example": "EUR"
      },
      siteAccessResetPending: true
    },
    registered: [
      { id: "ccp_site_startup" },
      { id: "unrelated_script" }
    ]
  });

  await emitAndWait(background.events.startup);
  await background.context.CurrencySitePreferences.waitForMutations();

  assert.deepEqual(background.registeredScripts, [{ id: "unrelated_script" }]);
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "USD" });
  assert.equal(background.localStore.siteAccessResetPending, undefined);
});

test("context-menu and keyboard events delegate page actions for supported tabs", async () => {
  const background = createBackground();
  const { context, events, injected } = background;
  const sentMessages = [];
  const tabQueries = [];
  context.ExtensionAPI.tabs.sendMessage = async (tabId, message) => {
    sentMessages.push({ tabId, message: plain(message) });
    return { ok: true };
  };

  await emitAndWait(
    events.contextMenu,
    { menuItemId: "convert-selection", selectionText: "$10" },
    { id: 17, url: "https://shop.example/product" }
  );

  assert.deepEqual(sentMessages, [
    { tabId: 17, message: { type: context.CurrencyMessages.CONTENT_READY } },
    { tabId: 17, message: { type: context.CurrencyMessages.CONVERT_SELECTION } }
  ]);

  sentMessages.length = 0;
  context.ExtensionAPI.tabs.query = async (query) => {
    tabQueries.push(plain(query));
    return [{ id: 23, url: "http://shop.example/cart" }];
  };

  await emitAndWait(events.command, "convert-page");

  assert.deepEqual(tabQueries, [{ active: true, currentWindow: true }]);
  assert.deepEqual(sentMessages, [
    { tabId: 23, message: { type: context.CurrencyMessages.CONTENT_READY } },
    { tabId: 23, message: { type: context.CurrencyMessages.RUN_SITE_CONVERSION } }
  ]);
  assert.deepEqual(injected, { css: [], js: [] });
});

test("settings are restricted to supported values", () => {
  const { context } = createBackground();
  const invalid = context.CurrencySettings.sanitize({
    enabled: "yes",
    fromCurrency: "BTC",
    toCurrency: "DOGE",
    displayMode: "html",
    convertedTextColor: "green",
    convertedBackgroundColor: "#12345g",
    convertedShape: "cloud",
    showPagePrompt: "yes"
  }, ["EUR", "PLN", "USD"]);
  assert.deepEqual(plain(invalid), DEFAULT_SYNC_SETTINGS);

  const valid = context.CurrencySettings.sanitize({
    enabled: false,
    fromCurrency: "USD",
    toCurrency: "PLN",
    displayMode: "replace",
    convertedTextColor: "#ABCDEF",
    convertedBackgroundColor: "#123456",
    convertedShape: "pill",
    showPagePrompt: false
  }, ["EUR", "PLN", "USD"]);
  assert.deepEqual(plain(valid), {
    enabled: false,
    fromCurrency: "USD",
    toCurrency: "PLN",
    displayMode: "replace",
    convertedTextColor: "#abcdef",
    convertedBackgroundColor: "#123456",
    convertedShape: "pill",
    showPagePrompt: false
  });
});

test("always-on site normalization accepts ordinary origins and non-default ports", () => {
  const { context } = createBackground();
  assert.deepEqual(plain(context.CurrencySitePreferences.normalizeSite("https://shop.example/product?id=1")), {
    origin: "https://shop.example",
    hostname: "shop.example",
    pattern: "https://shop.example/*"
  });
  assert.deepEqual(plain(context.CurrencySitePreferences.normalizeSite("http://localhost:3000/product")), {
    origin: "http://localhost:3000",
    hostname: "localhost",
    pattern: "http://localhost:3000/*"
  });
  assert.equal(context.CurrencySitePreferences.normalizeSite("file:///tmp/shop.html"), null);
  assert.match(
    context.CurrencySitePreferences.siteMemoryError("file:///tmp/shop.html"),
    /Only normal HTTP and HTTPS/
  );
});

test("fallback injection derives its ordered files from the declarative manifest", async () => {
  const background = createBackground();
  const { context, injected } = background;
  context.ExtensionAPI.tabs.sendMessage = async () => {
    throw new Error("Content script is not loaded yet.");
  };

  await context.CurrencyPageActions.ensureContentScripts(42);

  assert.deepEqual(injected.css, [{
    target: { tabId: 42 },
    files: firefoxManifest.content_scripts[0].css.map((file) => `/${file}`)
  }]);
  assert.deepEqual(injected.js, [{
    target: { tabId: 42 },
    files: firefoxManifest.content_scripts[0].js.map((file) => `/${file}`)
  }]);
});

test("fallback injection is skipped when the declarative content script responds", async () => {
  const { context, injected } = createBackground();
  await context.CurrencyPageActions.ensureContentScripts(7);
  assert.deepEqual(injected, { css: [], js: [] });
});

test("site status reflects an automatic-conversion preference without permission state", async () => {
  const origin = "https://shop.example";
  const { context } = createBackground({
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "USD" }
    }
  });

  const result = await context.CurrencySitePreferences.getStatus(`${origin}/product`);

  assert.deepEqual(plain(result), {
    ok: true,
    origin,
    pattern: `${origin}/*`,
    remembered: true,
    dataRemaining: true
  });
});

test("background message router delegates to the extracted services", async () => {
  const origin = "https://shop.example";
  const { context } = createBackground({
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "USD" }
    }
  });

  const status = await context.CurrencyBackground.handleMessage({
    type: context.CurrencyMessages.GET_SITE_STATUS,
    origin: `${origin}/product`
  }, {});
  const unknown = await context.CurrencyBackground.handleMessage({ type: "NOT_A_MESSAGE" }, {});

  assert.equal(status.ok, true);
  assert.equal(status.remembered, true);
  assert.deepEqual(plain(unknown), { ok: false, error: "Unknown extension request." });
});

test("default settings service resolves swapped provider globals after worker load", async () => {
  const background = createBackground();
  const { context } = background;
  let cachedCatalogCalls = 0;
  let refreshedCatalogCalls = 0;
  let rateCalls = 0;
  const catalog = {
    currencies: ["EUR", "USD", "ZZZ"].map((code) => ({ code })),
    cached: true,
    stale: false
  };

  context.CurrencyCatalogService = Object.freeze({
    async getCachedCurrencies() {
      cachedCatalogCalls += 1;
      return catalog;
    },
    async getCurrencies() {
      refreshedCatalogCalls += 1;
      return catalog;
    }
  });
  context.CurrencyRateService = Object.freeze({
    async getRates(baseCurrency) {
      rateCalls += 1;
      assert.equal(baseCurrency, "USD");
      return { ok: true, rates: { USD: 1, ZZZ: 2 } };
    }
  });

  const result = await context.CurrencyBackground.handleMessage({
    type: context.CurrencyMessages.UPDATE_SETTINGS,
    origin: "https://shop.example/product",
    payload: { fromCurrency: "USD", toCurrency: "ZZZ" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.settings.fromCurrency, "USD");
  assert.equal(result.settings.toCurrency, "ZZZ");
  assert.equal(cachedCatalogCalls, 1);
  assert.equal(refreshedCatalogCalls, 1);
  assert.equal(rateCalls, 1);
  assert.equal(background.syncStore.toCurrency, "ZZZ");
});

test("remembering a site stores its preference and current source mode", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, fromCurrency: "USD" },
    local: { autoConvertSites: {}, siteSourceCurrencies: {} }
  });
  stubCatalog(background.context);
  background.context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => {
    throw new Error("normal remember flow must not inspect dynamic registrations");
  };

  const result = await background.context.CurrencySettingsService.rememberSite(`${origin}/product`);

  assert.equal(result.ok, true);
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "USD" });
  const resolved = await background.context.CurrencySitePreferences.resolveSettingsForOrigin(
    DEFAULT_SYNC_SETTINGS,
    origin,
    ["EUR", "USD"]
  );
  assert.equal(resolved.fromCurrency, "USD");
});

test("global target change rejects a conflict with another remembered site's source", async () => {
  const otherOrigin = "https://other-shop.example";
  const background = createBackground({
    local: {
      autoConvertSites: { [otherOrigin]: true },
      siteSourceCurrencies: { [otherOrigin]: "USD" }
    }
  });
  stubCatalog(background.context);
  let syncWriteCount = 0;
  background.context.ExtensionAPI.storage.sync.set = async () => {
    syncWriteCount += 1;
  };

  const result = await background.context.CurrencySettingsService.updateSettings(
    { toCurrency: "USD" },
    "https://active-shop.example/product"
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /saved source for other-shop\.example/);
  assert.equal(syncWriteCount, 0);
});

test("remembered-site source-only update does not write global sync settings", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, toCurrency: "PLN" },
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "EUR" }
    }
  });
  stubCatalog(background.context);
  let syncWriteCount = 0;
  background.context.ExtensionAPI.storage.sync.set = async () => {
    syncWriteCount += 1;
  };

  const result = await background.context.CurrencySettingsService.updateSettings(
    { fromCurrency: "AUTO" },
    origin
  );

  assert.equal(result.ok, true);
  assert.equal(result.settings.fromCurrency, "AUTO");
  assert.equal(syncWriteCount, 0);
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "AUTO" });
});

test("settings updates remain ordered while pair validation is delayed", async () => {
  const origin = "https://shop.example/product";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, fromCurrency: "USD" }
  });
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
  background.context.CurrencyRateService = {
    async getRates() {
      rateCalls += 1;
      signalValidationStarted();
      return delayedValidation;
    }
  };
  stubCatalog(
    background.context,
    ["CHF", "EUR", "USD"],
    background.context.CurrencyRateService
  );
  background.context.ExtensionAPI.storage.sync.set = async (value) => {
    const copy = plain(value);
    writes.push(copy);
    Object.assign(background.syncStore, copy);
  };

  const first = background.context.CurrencySettingsService.updateSettings(
    { fromCurrency: "CHF" },
    origin
  );
  await validationStarted;
  const second = background.context.CurrencySettingsService.updateSettings({
    fromCurrency: "CHF",
    displayMode: "replace"
  }, origin).then((result) => {
    secondSettled = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondSettled, false);

  releaseValidation({ ok: true, rates: { CHF: 1, EUR: 1.08 } });
  const results = await Promise.all([first, second]);

  assert.equal(results.every((result) => result.ok), true);
  assert.equal(rateCalls, 1);
  assert.deepEqual(
    writes.map((settings) => `${settings.fromCurrency}:${settings.displayMode}`),
    ["CHF:beside", "CHF:replace"]
  );
});

test("sync failure rolls back a remembered site's local source update", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, toCurrency: "PLN" },
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "EUR" }
    }
  });
  stubCatalog(background.context);
  const localWrites = [];
  const originalLocalSet = background.context.ExtensionAPI.storage.local.set;
  background.context.ExtensionAPI.storage.local.set = async (value) => {
    localWrites.push(plain(value));
    await originalLocalSet(value);
  };
  background.context.ExtensionAPI.storage.sync.set = async () => {
    throw new Error("sync unavailable");
  };

  const result = await background.context.CurrencySettingsService.updateSettings({
    fromCurrency: "AUTO",
    displayMode: "replace"
  }, origin);

  assert.equal(result.ok, false);
  assert.equal(result.partial, false);
  assert.match(result.error, /Global settings were not saved/);
  assert.equal(localWrites.length, 2);
  assert.equal(localWrites[0].siteSourceCurrencies[origin], "AUTO");
  assert.equal(localWrites[1].siteSourceCurrencies[origin], "EUR");
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "EUR" });
});

test("remember setup rolls back an uncertain local-storage write", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, fromCurrency: "USD" },
    local: { autoConvertSites: {}, siteSourceCurrencies: {} }
  });
  stubCatalog(background.context);
  const originalSet = background.context.ExtensionAPI.storage.local.set;
  let writes = 0;
  background.context.ExtensionAPI.storage.local.set = async (value) => {
    writes += 1;
    await originalSet(value);
    if (writes === 1) throw new Error("setup storage result was uncertain");
  };

  const result = await background.context.CurrencySettingsService.rememberSite(origin);

  assert.equal(result.ok, false);
  assert.equal(result.remembered, false);
  assert.equal(result.dataRemaining, false);
  assert.match(result.error, /site setting was rolled back/);
  assert.deepEqual(background.localStore.autoConvertSites, {});
  assert.deepEqual(background.localStore.siteSourceCurrencies, {});
});

test("remember reports catalog failures without escaping the message contract", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    local: { autoConvertSites: {}, siteSourceCurrencies: {} }
  });
  background.context.CurrencySettingsService = background.context.CurrencySettingsService.create({
    api: background.context.ExtensionAPI,
    catalogService: {
      async getCurrencies() {
        throw new Error("catalog unavailable");
      }
    },
    rateService: background.context.CurrencyRateService,
    currencyCatalog: background.context.CurrencyCatalog,
    settingsSchema: background.context.CurrencySettings,
    sitePreferences: background.context.CurrencySitePreferences
  });

  const result = await background.context.CurrencySettingsService.rememberSite(origin);

  assert.equal(result.ok, false);
  assert.equal(result.remembered, false);
  assert.equal(result.dataRemaining, false);
  assert.match(result.error, /catalog unavailable/);
  assert.deepEqual(background.localStore.autoConvertSites, {});
  assert.deepEqual(background.localStore.siteSourceCurrencies, {});
});

test("remember rollback reports saved data that could not be removed", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, fromCurrency: "USD" },
    local: { autoConvertSites: {}, siteSourceCurrencies: {} }
  });
  stubCatalog(background.context);
  const originalSet = background.context.ExtensionAPI.storage.local.set;
  let writes = 0;
  background.context.ExtensionAPI.storage.local.set = async (value) => {
    writes += 1;
    if (writes === 1) {
      await originalSet(value);
      throw new Error("setup storage result was uncertain");
    }
    throw new Error("saved site data could not be removed");
  };

  const result = await background.context.CurrencySettingsService.rememberSite(origin);

  assert.equal(result.ok, false);
  assert.equal(result.remembered, true);
  assert.equal(result.dataRemaining, true);
  assert.match(result.error, /Some saved site data remains/);
});

test("concurrent remember mutations retain both site preferences", async () => {
  const firstOrigin = "https://first.example";
  const secondOrigin = "https://second.example";
  const background = createBackground({
    sync: { ...DEFAULT_SYNC_SETTINGS, fromCurrency: "USD" },
    local: { autoConvertSites: {}, siteSourceCurrencies: {} }
  });
  stubCatalog(background.context);

  const results = await Promise.all([
    background.context.CurrencySettingsService.rememberSite(firstOrigin),
    background.context.CurrencySettingsService.rememberSite(secondOrigin)
  ]);

  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(background.localStore.autoConvertSites, {
    [firstOrigin]: true,
    [secondOrigin]: true
  });
  assert.deepEqual(background.localStore.siteSourceCurrencies, {
    [firstOrigin]: "USD",
    [secondOrigin]: "USD"
  });
});

test("forgetting a site deletes only its saved preference and source mode", async () => {
  const origin = "https://shop.example";
  const otherOrigin = "https://other.example";
  const background = createBackground({
    local: {
      autoConvertSites: { [origin]: true, [otherOrigin]: true },
      siteSourceCurrencies: { [origin]: "USD", [otherOrigin]: "EUR" }
    },
    registered: [{ id: "unrelated_script" }]
  });
  background.context.ExtensionAPI.scripting.getRegisteredContentScripts = async () => {
    throw new Error("normal forget flow must not inspect dynamic registrations");
  };

  const result = await background.context.CurrencySitePreferences.forget(`${origin}/product`);

  assert.equal(result.ok, true);
  assert.equal(result.remembered, false);
  assert.deepEqual(background.localStore.autoConvertSites, { [otherOrigin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [otherOrigin]: "EUR" });
});

test("forget failure reports saved data that remains", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "USD" }
    }
  });
  background.context.ExtensionAPI.storage.local.set = async () => {
    throw new Error("local storage unavailable");
  };

  const result = await background.context.CurrencySitePreferences.forget(origin);

  assert.equal(result.ok, false);
  assert.equal(result.remembered, true);
  assert.equal(result.dataRemaining, true);
  assert.match(result.error, /remaining: saved site data/);
});

test("reconciliation removes only stale site registrations and reset flags", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    local: {
      autoConvertSites: {
        [origin]: true,
        "https://api.frankfurter.dev": true,
        "not a URL": true
      },
      siteSourceCurrencies: {
        [origin]: "USD",
        "https://api.frankfurter.dev": "EUR",
        "https://unused.example": "PLN"
      },
      siteAccessResetNotice: true,
      siteAccessResetPending: true,
      unrelated: "keep"
    },
    registered: [
      { id: "ccp_site_old_one" },
      { id: "unrelated_script" },
      { id: "ccp_site_old_two" }
    ]
  });

  await background.context.CurrencySitePreferences.reconcile(["EUR", "PLN", "USD"]);

  assert.deepEqual(background.registeredScripts, [{ id: "unrelated_script" }]);
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "USD" });
  assert.equal(background.localStore.siteAccessResetNotice, undefined);
  assert.equal(background.localStore.siteAccessResetPending, undefined);
  assert.equal(background.localStore.unrelated, "keep");
});

test("failed stale-registration cleanup is retried without deleting preferences", async () => {
  const origin = "https://shop.example";
  const background = createBackground({
    local: {
      autoConvertSites: { [origin]: true },
      siteSourceCurrencies: { [origin]: "USD" },
      siteAccessResetPending: true
    },
    registered: [{ id: "ccp_site_retry" }]
  });
  const originalUnregister = background.context.ExtensionAPI.scripting.unregisterContentScripts;
  let attempts = 0;
  background.context.ExtensionAPI.scripting.unregisterContentScripts = async (value) => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary unregister failure");
    return originalUnregister(value);
  };

  await assert.rejects(
    background.context.CurrencySitePreferences.reconcile(["EUR", "USD"]),
    /temporary unregister failure/
  );
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.equal(background.localStore.siteAccessResetPending, true);

  await background.context.CurrencySitePreferences.reconcile(["EUR", "USD"]);
  assert.equal(attempts, 2);
  assert.deepEqual(background.registeredScripts, []);
  assert.deepEqual(background.localStore.autoConvertSites, { [origin]: true });
  assert.deepEqual(background.localStore.siteSourceCurrencies, { [origin]: "USD" });
  assert.equal(background.localStore.siteAccessResetPending, undefined);
});

test("the exchange-rate provider cannot be an automatic-conversion site", async () => {
  const { context } = createBackground();
  const status = await context.CurrencySitePreferences.getStatus(
    "https://api.frankfurter.dev/test-shop"
  );
  const remembered = await context.CurrencySettingsService.rememberSite(
    "https://api.frankfurter.dev/test-shop"
  );

  assert.equal(status.ok, false);
  assert.equal(status.remembered, false);
  assert.match(status.error, /exchange-rate provider.*cannot be enabled/i);
  assert.equal(remembered.ok, false);
  assert.equal(remembered.remembered, false);
  assert.match(remembered.error, /exchange-rate provider.*cannot be enabled/i);
});

test("Firefox site status rejects protected pages and PDF viewers", async () => {
  const { context } = createBackground();
  assert.deepEqual(
    plain(await context.CurrencySitePreferences.getStatus("https://addons.mozilla.org/firefox/")),
    {
      ok: false,
      remembered: false,
      error: "Firefox protects this Mozilla page from extensions. Open a regular shopping page and try again."
    }
  );
  assert.match(
    (await context.CurrencySitePreferences.getStatus("https://files.example/invoice.pdf")).error,
    /PDF viewer/
  );
});
