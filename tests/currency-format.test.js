const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ Intl });
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../shared/currencies.js"), "utf8"),
  context
);

const { CURRENCY_META, formatCurrencyAmount } = context.CurrencyCatalog;

for (const [currency, expectedDigits] of [
  ["JPY", 0],
  ["USD", 2],
  ["KWD", 3]
]) {
  test(`formats ${currency} with its standard fraction digits`, () => {
    const expectedFormatter = new Intl.NumberFormat(CURRENCY_META[currency].locale, {
      style: "currency",
      currency
    });

    assert.equal(
      expectedFormatter.resolvedOptions().maximumFractionDigits,
      expectedDigits
    );
    assert.equal(formatCurrencyAmount(1234.5678, currency), expectedFormatter.format(1234.5678));
  });
}
