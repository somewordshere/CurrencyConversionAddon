const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("reuses Intl.NumberFormat instances by locale and currency", () => {
  const constructions = [];
  class FakeNumberFormat {
    constructor(locale, options) {
      constructions.push([locale, options.currency]);
      this.currency = options.currency;
    }

    format(amount) {
      return `${this.currency}:${amount}`;
    }
  }
  const context = vm.createContext({ Intl: { NumberFormat: FakeNumberFormat } });
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/shared/currencies.js"), "utf8"),
    context
  );

  assert.equal(context.CurrencyCatalog.formatCurrencyAmount(10, "EUR"), "EUR:10");
  assert.equal(context.CurrencyCatalog.formatCurrencyAmount(20, "EUR"), "EUR:20");
  assert.equal(context.CurrencyCatalog.formatCurrencyAmount(30, "USD"), "USD:30");
  assert.deepEqual(constructions, [["de-DE", "EUR"], ["en-US", "USD"]]);
});
