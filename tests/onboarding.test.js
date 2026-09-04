const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function load(files, extraGlobals = {}) {
  const context = vm.createContext({
    console, URL, Error, Object, Promise, Intl, JSON, Map, Set, ...extraGlobals
  });
  for (const file of files) {
    vm.runInContext(
      fs.readFileSync(path.join(root, "src", file), "utf8"),
      context,
      { filename: `src/${file}` }
    );
  }
  return context;
}

const catalogContext = load(["shared/currencies.js"]);
const currencyCatalog = catalogContext.CurrencyCatalog;

const schemaContext = load(["shared/settings.js"]);
const settingsSchema = schemaContext.CurrencySettings;

test("a browser region resolves to the currency someone there thinks in", () => {
  const forLocale = currencyCatalog.currencyForLocale;
  assert.equal(forLocale("en-US"), "USD");
  assert.equal(forLocale("en-GB"), "GBP");
  assert.equal(forLocale("ja-JP"), "JPY");
  assert.equal(forLocale("tr-TR"), "TRY");
  assert.equal(forLocale("pt-BR"), "BRL");
  assert.equal(forLocale("en-AU"), "AUD");
});

test("euro regions resolve to EUR even though only one of them is EUR's own locale", () => {
  // CURRENCY_META records de-DE against EUR. Ireland and France would otherwise
  // fall through to the schema default, which happens to be EUR by luck, not logic.
  for (const locale of ["de-DE", "fr-FR", "en-IE", "it-IT", "es-ES", "pt-PT"]) {
    assert.equal(currencyCatalog.currencyForLocale(locale), "EUR", locale);
  }
});

test("a locale that names no region resolves to nothing rather than a guess", () => {
  for (const locale of ["en", "de", "", "  ", "xx-ZZ", null, undefined, 42, {}]) {
    assert.equal(currencyCatalog.currencyForLocale(locale), null, String(locale));
  }
});

function createSettingsService({ stored = {}, locale, supported }) {
  const codes = supported || ["AUD", "BRL", "EUR", "GBP", "JPY", "TRY", "USD"];
  const syncStore = { ...stored };
  const removed = [];
  const context = load([
    "shared/currencies.js",
    "shared/settings.js",
    "background/settings-service.js"
  ], {
    // settings-service builds a module-level singleton on load, so the globals
    // the real background provides have to be present before it evaluates.
    ExtensionAPI: { storage: { sync: { get: async () => ({}), set: async () => {} }, local: { remove: async () => {} } } },
    CurrencySitePreferences: {},
    CurrencyCatalogService: {},
    CurrencyRateService: {},
    CurrencyCatalogSnapshot: { read: async () => ({ currencies: [] }) }
  });
  const service = context.CurrencySettingsService.create({
    api: {
      storage: {
        sync: {
          get: async () => ({ ...syncStore }),
          set: async (value) => Object.assign(syncStore, value)
        },
        local: { remove: async (key) => removed.push(key) }
      }
    },
    catalogService: { getCurrencies: async () => ({ currencies: codes.map((code) => ({ code })) }) },
    rateService: { getRates: async () => ({ ok: true, rates: {} }) },
    currencyCatalog,
    settingsSchema,
    sitePreferences: {},
    catalogSnapshot: { read: async () => ({ currencies: codes.map((code) => ({ code })) }) },
    resolveLocale: () => locale
  });
  return { service, syncStore, removed };
}

test("a fresh install takes its target currency from the browser region", async () => {
  const { service, syncStore } = createSettingsService({ locale: "en-GB" });
  await service.initializeDefaults();
  assert.equal(syncStore.toCurrency, "GBP");
});

test("a fresh install in an unsupported region keeps the schema default", async () => {
  const { service, syncStore } = createSettingsService({ locale: "az-AZ", supported: ["EUR", "USD"] });
  await service.initializeDefaults();
  // AZN is a real currency the detector knows, but this provider does not quote
  // it, so sanitize() must drop the guess instead of persisting a dead target.
  assert.equal(syncStore.toCurrency, settingsSchema.DEFAULTS.toCurrency);
});

test("a locale with no region falls back to the schema default", async () => {
  const { service, syncStore } = createSettingsService({ locale: "en" });
  assert.equal(await service.initializeDefaults().then(() => syncStore.toCurrency),
    settingsSchema.DEFAULTS.toCurrency);
});

test("an existing choice survives the seeding, including one that matches no region", async () => {
  const { service, syncStore } = createSettingsService({
    stored: { toCurrency: "JPY" },
    locale: "en-US"
  });
  await service.initializeDefaults();
  assert.equal(syncStore.toCurrency, "JPY");
});

function createOnboarding({ tabs = [], injectFails = new Set(), queryThrows = false } = {}) {
  const created = [];
  const injected = [];
  const context = load([
    "shared/messages.js",
    "shared/page-access.js",
    "shared/content-script-resources.js",
    "background/onboarding.js"
  ], {
    // The real background load order puts these before onboarding.js, so the
    // module-level singleton can resolve them the same way it does at runtime.
    ExtensionAPI: { runtime: { getManifest: () => ({ content_scripts: [] }) } }
  });
  const service = context.CurrencyOnboardingService.create({
    api: {
      runtime: { getURL: (page) => `moz-extension://test/${page}` },
      tabs: {
        create: async (options) => created.push(options.url),
        query: async () => {
          if (queryThrows) throw new Error("Tabs cannot be listed.");
          return tabs;
        }
      }
    },
    contentScriptResources: {
      createInjector: () => async (tabId) => {
        if (injectFails.has(tabId)) throw new Error("This page refused injection.");
        injected.push(tabId);
      }
    },
    messages: context.CurrencyMessages,
    pageAccess: context.CurrencyPageAccess
  });
  return { service, created, injected };
}

test("the welcome tab opens on a first install and on nothing else", async () => {
  for (const reason of ["update", "chrome_update", "browser_update", "shared_module_update", undefined]) {
    const { service, created } = createOnboarding();
    const result = await service.openOnInstall(reason === undefined ? undefined : { reason });
    assert.equal(result.opened, false, String(reason));
    assert.equal(created.length, 0, String(reason));
  }

  const { service, created } = createOnboarding();
  const result = await service.openOnInstall({ reason: "install" });
  assert.equal(result.opened, true);
  assert.deepEqual(created, ["moz-extension://test/onboarding/onboarding.html"]);
});

test("activating open tabs injects the converter and skips pages it cannot reach", async () => {
  const { service, injected } = createOnboarding({
    tabs: [
      { id: 1, url: "https://shop.example/product" },
      { id: 2, url: "https://other.example/cart" },
      { id: 3, url: "https://files.example/manual.pdf" },
      { id: 4, url: "about:blank" },
      { url: "https://no-id.example/" }
    ]
  });
  const result = await service.activateOpenTabs();
  assert.equal(result.ok, true);
  assert.deepEqual(injected, [1, 2]);
  assert.equal(result.activated, 2);
  assert.equal(result.skipped, 3);
});

test("one tab refusing injection does not abandon the rest", async () => {
  const { service, injected } = createOnboarding({
    tabs: [
      { id: 1, url: "https://shop.example/" },
      { id: 2, url: "https://locked.example/" },
      { id: 3, url: "https://last.example/" }
    ],
    injectFails: new Set([2])
  });
  const result = await service.activateOpenTabs();
  assert.deepEqual(injected, [1, 3]);
  assert.equal(result.activated, 2);
  assert.equal(result.skipped, 1);
});

test("a browser that refuses to list tabs reports the failure instead of throwing", async () => {
  const { service } = createOnboarding({ queryThrows: true });
  const result = await service.activateOpenTabs();
  assert.equal(result.ok, false);
  assert.match(result.error, /Tabs cannot be listed/);
});
