const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settingsContext = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../../src/shared/settings.js"), "utf8"),
  settingsContext,
  { filename: "src/shared/settings.js" }
);
const DEFAULT_SETTINGS = Object.freeze(
  JSON.parse(JSON.stringify(settingsContext.CurrencySettings.DEFAULTS))
);

const CATALOG_SIGNATURE = "AFN,CHF,EUR,PLN,USD";
const RATE_DATE = "2026-07-10";
const PROVIDER_CURRENCIES = Object.freeze([
  Object.freeze({
    code: "CHF",
    name: "Swiss Franc",
    symbol: "CHF",
    startDate: "1999-01-04",
    endDate: RATE_DATE
  }),
  Object.freeze({
    code: "PLN",
    name: "Polish Zloty",
    symbol: "PLN",
    startDate: "1999-01-04",
    endDate: RATE_DATE
  }),
  Object.freeze({
    code: "AFN",
    name: "Afghan Afghani",
    symbol: "؋",
    startDate: "1999-01-01",
    endDate: RATE_DATE
  }),
  Object.freeze({
    code: "EUR",
    name: "Euro",
    symbol: "€",
    startDate: "1999-01-04",
    endDate: RATE_DATE
  }),
  Object.freeze({
    code: "USD",
    name: "United States Dollar",
    symbol: "$",
    startDate: "1999-01-04",
    endDate: RATE_DATE
  })
]);

const RATES_BY_BASE = Object.freeze({
  USD: Object.freeze({ USD: 1, EUR: 0.9, CHF: 0.8 }),
  CHF: Object.freeze({ CHF: 1, EUR: 1.08 }),
  PLN: Object.freeze({ PLN: 1, EUR: 0.235 })
});

function createSeededExtensionState({
  now = new Date().toISOString(),
  settings = {},
  local = {}
} = {}) {
  return {
    sync: {
      ...DEFAULT_SETTINGS,
      ...settings
    },
    local: {
      providerCurrencyCatalog: {
        version: 1,
        fetchedAt: now,
        currencies: PROVIDER_CURRENCIES.map((currency) => ({ ...currency }))
      },
      ratesCache: {
        version: 3,
        bases: Object.fromEntries(Object.entries(RATES_BY_BASE).map(([base, rates]) => [
          base,
          {
            fetchedAt: now,
            rateDate: RATE_DATE,
            catalogSignature: CATALOG_SIGNATURE,
            rates: { ...rates }
          }
        ]))
      },
      ...local
    }
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  createSeededExtensionState
};
