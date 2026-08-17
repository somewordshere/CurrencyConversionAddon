const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../src/shared/settings.js"), "utf8"),
  context,
  { filename: "src/shared/settings.js" }
);
const settings = context.CurrencySettings;

test("shared settings schema sanitizes every persisted field", () => {
  const actual = settings.sanitize({
    enabled: "yes",
    fromCurrency: "BTC",
    toCurrency: "DOGE",
    displayMode: "html",
    convertedTextColor: "#ABCDEF",
    convertedBackgroundColor: "invalid",
    convertedShape: "cloud",
    showPagePrompt: "yes"
  }, ["EUR", "USD"]);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "EUR",
    displayMode: "beside",
    convertedTextColor: "#abcdef",
    convertedBackgroundColor: "#dcfce7",
    convertedShape: "rounded",
    showPagePrompt: true
  });
});

test("shared settings schema validates and compares complete snapshots", () => {
  const snapshot = {
    ...JSON.parse(JSON.stringify(settings.DEFAULTS)),
    fromCurrency: "USD",
    convertedTextColor: "#ABCDEF"
  };
  const normalized = settings.normalizeSnapshot(snapshot, ["EUR", "USD"]);

  assert.equal(normalized.convertedTextColor, "#abcdef");
  assert.equal(settings.snapshotEquals(normalized, { ...normalized }), true);
  assert.equal(settings.normalizeSnapshot({ ...snapshot, convertedShape: "cloud" }), null);
  assert.equal(settings.normalizeSnapshot({ ...snapshot, toCurrency: "JPY" }, ["EUR", "USD"]), null);
});

test("shared settings schema classifies rate and presentation changes", () => {
  assert.equal(settings.changesInclude(
    { convertedShape: { oldValue: "rounded", newValue: "pill" } },
    settings.PRESENTATION_KEYS
  ), true);
  assert.equal(settings.changesInclude(
    { convertedShape: { oldValue: "rounded", newValue: "pill" } },
    settings.RATE_AFFECTING_KEYS
  ), false);
});
