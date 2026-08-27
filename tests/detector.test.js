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
  "src/shared/currencies.js",
  "src/content/number-parser.js",
  "src/content/detector.js"
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

const linkedProductTitle = element("product-name", "Netflix Gift Card 80 PLN | Code | Top-up");
linkedProductTitle.closest = (selector) => selector === "a[href]" ? linkedProductTitle : null;
assert.equal(
  detector.findMatchesForContext(
    linkedProductTitle.textContent,
    linkedProductTitle,
    settings
  ).length,
  0,
  "currency amounts inside linked product titles must not be converted as sale prices"
);
assert.equal(
  detector.findMatchesForContext(
    linkedProductTitle.textContent,
    linkedProductTitle,
    settings,
    { selection: true }
  ).length,
  1,
  "explicitly selected currency text inside a product title must remain convertible"
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

assert.equal(
  detector.findCurrencyMatches("PLN\u00a079.", {
    pageDetection: { currency: "PLN", confidence: "high" }
  }).length,
  0,
  "a price fragment ending at its decimal separator must wait for its fraction sibling"
);
const completeSplitDecimal = detector.findCurrencyMatches("PLN\u00a079.00", {
  pageDetection: { currency: "PLN", confidence: "high" }
});
assert.equal(completeSplitDecimal.length, 1);
assert.equal(completeSplitDecimal[0].amount, 79);
assert.equal(detector.hasCurrencyMarker("PLN\u00a079.", "PLN"), true);
assert.equal(detector.hasCurrencyMarker("R134 refrigerant", "PLN"), false);

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

// Storefronts that price in symbols and never print an ISO code are the reason
// page detection exists; these pin down that a marker only resolves a currency
// when the rest of the page agrees it should.
function detectorForPage({ lang, hostname, bodyText }) {
  const pageContext = vm.createContext({
    console,
    URL,
    document: {
      body: { innerText: bodyText },
      documentElement: { innerHTML: "", lang },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    window: { location: { hostname, href: `https://${hostname}/` } }
  });
  for (const file of [
    "src/shared/currencies.js",
    "src/content/number-parser.js",
    "src/content/detector.js"
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), pageContext, { filename: file });
  }
  return pageContext.CurrencyDetector;
}

const turkishStorefront = detectorForPage({
  lang: "tr",
  hostname: "www.trendyol.com",
  bodyText: "Sepetim 249,90 TL Elbise 1.299,90 TL Ayakkabı 899,00 TL Indirim 79,90 TL"
});
const turkishDetection = turkishStorefront.getPageCurrencyDetection();
assert.equal(turkishDetection.currency, "TRY");
assert.notEqual(
  turkishDetection.confidence,
  "low",
  "lira prices written as TL must identify a Turkish storefront"
);
assert.equal(
  turkishStorefront.findCurrencyMatches("1.299,90 TL")
    .map((match) => `${match.currency}:${match.amount}`)
    .join(),
  "TRY:1299.9",
  "Turkish pages price in TL, not in the lira sign"
);

// A product page shows a price once or twice, not a grid of them. Detection has
// to resolve on that, or every Turkish detail page falls back to "select the
// source currency manually".
const sparseTurkishProduct = detectorForPage({
  lang: "tr",
  hostname: "www.trendyol.com",
  bodyText: "Kadın Elbise 1.250,00 TL Sepete Ekle 4,6 (218 değerlendirme)"
});
assert.notEqual(
  sparseTurkishProduct.getPageCurrencyDetection().confidence,
  "low",
  "a Turkish page with a single TL price must still resolve"
);

const germanRecipe = detectorForPage({
  lang: "de-DE",
  hostname: "www.chefkoch.de",
  bodyText: "Zutaten: 2 TL Zucker, 1 TL Salz, 3 TL Backpulver, 250 g Mehl, Preis 4,99 €"
});
assert.notEqual(
  germanRecipe.getPageCurrencyDetection().currency,
  "TRY",
  "teaspoons in a German recipe must not read as a Turkish storefront"
);
assert.equal(
  germanRecipe.findCurrencyMatches("2 TL").length,
  0,
  "TL must stay inert on pages that are not priced in lira"
);

const manatMarketplace = detectorForPage({
  lang: "az",
  hostname: "tap.az",
  bodyText: "Qiymət, AZN 2 600 ₼ 175 000 ₼ 65 ₼ 350 ₼ 220 ₼"
});
assert.equal(manatMarketplace.getPageCurrencyDetection().currency, "AZN");
assert.equal(
  manatMarketplace.getPageCurrencyDetection().confidence,
  "high",
  "a page full of manat prices must be identified confidently"
);

console.log("detector tests passed");
