const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../content/number-parser.js"), "utf8"),
  context
);
const { parseLocaleNumber, normalizeDigits } = context.CurrencyNumberParser;

test("parses common international price formats", () => {
  assert.equal(parseLocaleNumber("1,234.56"), 1234.56);
  assert.equal(parseLocaleNumber("1.234,56"), 1234.56);
  assert.equal(parseLocaleNumber("1'234.56"), 1234.56);
  assert.equal(parseLocaleNumber("1\u202f234,56"), 1234.56);
  assert.equal(parseLocaleNumber("1.234"), 1234);
});

test("normalizes full-width digits", () => {
  assert.equal(normalizeDigits("１２３４"), "1234");
  assert.equal(parseLocaleNumber("１，２３４．５０"), 1234.5);
});

test("supports three-decimal currencies without changing ordinary thousands parsing", () => {
  assert.equal(parseLocaleNumber("1.234"), 1234);
  assert.equal(parseLocaleNumber("1.234", { allowThreeDecimals: true }), 1.234);
});
