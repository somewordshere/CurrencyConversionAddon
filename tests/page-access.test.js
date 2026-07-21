const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const firefoxManifest = { browser_specific_settings: { gecko: { id: "test@example" } } };
const context = vm.createContext({
  URL,
  ExtensionAPI: { runtime: { getManifest: () => firefoxManifest } }
});
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../src/shared/page-access.js"), "utf8"),
  context
);

const pageAccess = context.CurrencyPageAccess;

test("allows ordinary web pages and local files to reach browser injection", () => {
  assert.equal(pageAccess.unsupportedPageMessage("https://shop.example/product"), null);
  assert.equal(pageAccess.unsupportedPageMessage("file:///tmp/shop.html"), null);
});

test("explains Firefox and browser-internal protected pages", () => {
  const restrictedHosts = [
    "accounts-static.cdn.mozilla.net",
    "accounts.firefox.com",
    "addons.cdn.mozilla.net",
    "addons.mozilla.org",
    "api.accounts.firefox.com",
    "content.cdn.mozilla.net",
    "discovery.addons.mozilla.org",
    "install.mozilla.org",
    "oauth.accounts.firefox.com",
    "profile.accounts.firefox.com",
    "support.mozilla.org",
    "sync.services.mozilla.com"
  ];
  for (const host of restrictedHosts) {
    assert.match(
      pageAccess.unsupportedPageMessage(`https://${host}/example`),
      /Firefox protects this Mozilla page/
    );
  }
  assert.equal(pageAccess.unsupportedPageMessage("https://addons.mozilla.org.evil.test/"), null);
  assert.match(pageAccess.unsupportedPageMessage("about:reader?url=https://example.com"), /Reader View/);
  assert.match(pageAccess.unsupportedPageMessage("moz-extension://example/popup.html"), /extension pages/);
});

test("does not apply Firefox's restricted-host list to Chrome", () => {
  const getManifest = context.ExtensionAPI.runtime.getManifest;
  context.ExtensionAPI.runtime.getManifest = () => ({});
  try {
    assert.equal(pageAccess.unsupportedPageMessage("https://addons.mozilla.org/firefox/"), null);
  } finally {
    context.ExtensionAPI.runtime.getManifest = getManifest;
  }
});

test("identifies likely browser PDF viewer pages", () => {
  for (const url of [
    "https://files.example/invoice.pdf",
    "https://files.example/invoice.PDF?download=1#page=2",
    "https://files.example/invoice%2Epdf",
    "file:///tmp/invoice.pdf"
  ]) {
    assert.match(pageAccess.unsupportedPageMessage(url), /PDF viewer/);
  }
  assert.equal(pageAccess.unsupportedPageMessage("https://files.example/invoice.pdf.html"), null);
  assert.equal(pageAccess.unsupportedPageMessage("https://files.example/view?file=invoice.pdf"), null);
});

test("preserves the real browser failure for supported pages", () => {
  assert.equal(
    pageAccess.describeFailure(
      { url: "https://shop.example/product" },
      new Error("The page converter could not be loaded: Missing host permission for the tab")
    ),
    "Could not start conversion on this page. The page converter could not be loaded: Missing host permission for the tab"
  );
});

test("does not expose an irrelevant browser error for a protected URL", () => {
  assert.equal(
    pageAccess.describeFailure(
      { url: "https://addons.mozilla.org/firefox/" },
      new Error("Missing host permission for the tab")
    ),
    "Firefox protects this Mozilla page from extensions. Open a regular shopping page and try again."
  );
  assert.equal(
    pageAccess.describeFailure(
      { url: "https://files.example/invoice.pdf?download=1" },
      new Error("Missing host permission for the tab")
    ),
    "Extensions cannot run inside the browser's PDF viewer. Open a regular webpage and try again."
  );
});
