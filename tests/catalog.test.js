const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createCatalogService({ cache = null, fetchImpl }) {
  const storage = { providerCurrencyCatalog: cache };
  const context = vm.createContext({
    Date,
    Error,
    Intl,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    CurrencyCatalog: {
      CURRENCY_CODES: ["EUR", "USD"],
      CURRENCY_META: {
        EUR: { symbols: ["€"] },
        USD: { symbols: ["$"] }
      }
    },
    ExtensionAPI: {
      storage: {
        local: {
          async get() { return { providerCurrencyCatalog: storage.providerCurrencyCatalog }; },
          async set(value) { storage.providerCurrencyCatalog = value.providerCurrencyCatalog; }
        }
      }
    }
  });
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../src/background/catalog.js"), "utf8"),
    context
  );
  return { service: context.CurrencyCatalogService, storage };
}

test("sanitizes and caches the provider's active currency catalog", async () => {
  const { service, storage } = createCatalogService({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [
          { iso_code: "afn", name: "Afghan Afghani", symbol: "؋", start_date: "1999-01-01", end_date: "2026-07-10" },
          { iso_code: "USD", name: "United States Dollar", symbol: "$" },
          { iso_code: "invalid", name: "Invalid" }
        ];
      }
    })
  });
  const result = await service.getCurrencies();
  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.currencies.map((currency) => currency.code))),
    ["AFN", "USD"]
  );
  assert.equal(storage.providerCurrencyCatalog.version, 1);
});

test("uses a stale provider catalog when refresh fails", async () => {
  const cache = {
    version: 1,
    fetchedAt: "2020-01-01T00:00:00.000Z",
    currencies: [
      { code: "EUR", name: "Euro", symbol: "€" },
      { code: "USD", name: "United States Dollar", symbol: "$" }
    ]
  };
  const { service } = createCatalogService({
    cache,
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  const result = await service.getCurrencies();
  assert.equal(result.ok, true);
  assert.equal(result.cached, true);
  assert.equal(result.stale, true);
  assert.match(result.warning, /503/);
  assert.equal(result.currencies.length, 2);
});
