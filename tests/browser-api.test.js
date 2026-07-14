const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const adapter = fs.readFileSync(
  path.resolve(__dirname, "../src/shared/browser-api.js"),
  "utf8"
);

test("uses Firefox's promise-based browser namespace when available", () => {
  const browser = { runtime: { id: "firefox" } };
  const context = vm.createContext({ browser, chrome: { runtime: { id: "chrome" } } });
  vm.runInContext(adapter, context);
  assert.equal(context.ExtensionAPI, browser);
});

test("falls back to Chrome's extension namespace", () => {
  const chrome = { runtime: { id: "chrome" } };
  const context = vm.createContext({ chrome });
  vm.runInContext(adapter, context);
  assert.equal(context.ExtensionAPI, chrome);
});
