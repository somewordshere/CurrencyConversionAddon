const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const metadata = {
  getAttribute(name) {
    return name === "content" ? "CHF" : null;
  },
  textContent: ""
};
const context = vm.createContext({
  console,
  URL,
  document: {
    body: { innerText: "CHF 1'419.95" },
    documentElement: { innerHTML: "", lang: "de-CH" },
    querySelectorAll(selector) {
      return selector.includes("priceCurrency") ? [metadata] : [];
    },
    querySelector() {
      return null;
    }
  },
  window: {
    location: {
      hostname: "example.ch",
      href: "https://example.ch/product"
    }
  }
});

for (const file of [
  "shared/currencies.js",
  "content/number-parser.js",
  "content/detector.js"
]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, file), "utf8"),
    context,
    { filename: file }
  );
}

function element(className, textContent = "", parentElement = null) {
  return {
    id: "",
    className,
    textContent,
    parentElement,
    getAttribute() {
      return null;
    }
  };
}

const settings = { fromCurrency: "AUTO", toCurrency: "USD" };
const detector = context.CurrencyDetector;
const fixtures = JSON.parse(
  fs.readFileSync(path.join(root, "tests/fixtures/prices.json"), "utf8")
);

for (const fixture of fixtures) {
  const matches = detector.findCurrencyMatches(fixture.text, {
    pageDetection: {
      currency: fixture.pageCurrency,
      confidence: "high"
    }
  });
  assert.equal(matches.length, 1, `expected one match for ${fixture.text}`);
  assert.equal(matches[0].currency, fixture.currency);
  assert.equal(matches[0].amount, fixture.amount);
}

assert.equal(
  detector.findMatchesForContext(
    "AMD 7",
    element("product-title", "AMD 7", element("product-price-layout")),
    settings
  ).length,
  0,
  "word-like currency codes in product names must not be converted in AUTO mode"
);

for (const nonPrice of [
  "May 14 - 16",
  "4.8 out of 5",
  "Save 20%",
  "1920x1080",
  "RTX 5070 Ti",
  "Model 9800X3D"
]) {
  assert.equal(
    detector.findCurrencyMatches(nonPrice, {
      pageDetection: { currency: "USD", confidence: "high" }
    }).length,
    0,
    `must not convert non-price text: ${nonPrice}`
  );
}

assert.equal(
  detector.findMatchesForContext(
    "2 Stück",
    element("stock availability"),
    settings
  ).length,
  0,
  "stock quantities must not be treated as bare prices"
);

assert.equal(
  detector.findMatchesForContext(
    "26",
    element("delivery-date"),
    settings
  ).length,
  0,
  "delivery dates must not be treated as bare prices"
);

const splitPriceContainer = element("product-price", "3 999 ₴");
assert.equal(
  detector.findMatchesForContext(
    "3 999",
    element("price-whole", "3 999", splitPriceContainer),
    settings
  ).length,
  0,
  "a split amount must wait for its sibling currency marker"
);

const splitMatch = detector.findMatchesForContext(
  "3 999 ₴",
  splitPriceContainer,
  settings
);
assert.equal(splitMatch.length, 1);
assert.equal(splitMatch[0].currency, "UAH");
assert.equal(splitMatch[0].amount, 3999);

const compactCodeMatch = detector.findCurrencyMatches("PLN46.19", {
  pageDetection: { currency: "CHF", confidence: "high" }
});
assert.equal(compactCodeMatch.length, 1);
assert.equal(compactCodeMatch[0].currency, "PLN");
assert.equal(compactCodeMatch[0].amount, 46.19);

const providerCatalogCodeMatch = detector.findCurrencyMatches("AFN 250", {
  forcedCurrency: "AFN",
  pageDetection: { currency: "CHF", confidence: "high" }
});
assert.equal(providerCatalogCodeMatch.length, 1);
assert.equal(providerCatalogCodeMatch[0].currency, "AFN");
assert.equal(providerCatalogCodeMatch[0].amount, 250);

assert.equal(
  detector.findMatchesForContext(
    "250",
    element("product-price"),
    { fromCurrency: "AFN", toCurrency: "EUR" }
  )[0].currency,
  "AFN",
  "manual provider-catalog currencies should support bare amounts in price elements"
);

assert.equal(
  detector.findCurrencyMatches("9800X3D", {
    pageDetection: { currency: "CHF", confidence: "high" }
  }).length,
  0,
  "numbers embedded in product model names must not be converted"
);

console.log("detector tests passed");
