const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./fixtures");

const SHOP_URL = "https://api.frankfurter.dev/test-shop";
const SHOP_HTML = fs.readFileSync(path.resolve(__dirname, "../fixtures/shop.html"), "utf8");
const SPLIT_PRICE_URL = "https://api.frankfurter.dev/digitec-split-price";
const SPLIT_PRICE_HTML = fs.readFileSync(
  path.resolve(__dirname, "../fixtures/digitec-split-price.html"),
  "utf8"
);
const SPLIT_FRACTION_URL = "https://api.frankfurter.dev/allegro-split-fraction";
const SPLIT_FRACTION_HTML = fs.readFileSync(
  path.resolve(__dirname, "../fixtures/allegro-split-fraction.html"),
  "utf8"
);

async function seedExtension(extensionWorker, { showPagePrompt = false } = {}) {
  await extensionWorker.evaluate(async ({ showPagePrompt }) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const stored = await chrome.storage.sync.get("enabled");
      if (typeof stored.enabled === "boolean") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await chrome.storage.sync.set({
      enabled: true,
      fromCurrency: "AUTO",
      toCurrency: "EUR",
      displayMode: "beside",
      showPagePrompt
    });
    await chrome.storage.local.set({
      siteSourceCurrencies: {},
      providerCurrencyCatalog: {
        version: 1,
        fetchedAt: new Date().toISOString(),
        currencies: [
          { code: "CHF", name: "Swiss Franc", symbol: "CHF", startDate: "1999-01-04", endDate: "2026-07-10" },
          { code: "PLN", name: "Polish Zloty", symbol: "PLN", startDate: "1999-01-04", endDate: "2026-07-10" },
          { code: "AFN", name: "Afghan Afghani", symbol: "؋", startDate: "1999-01-01", endDate: "2026-07-10" },
          { code: "EUR", name: "Euro", symbol: "â‚¬", startDate: "1999-01-04", endDate: "2026-07-10" },
          { code: "USD", name: "United States Dollar", symbol: "$", startDate: "1999-01-04", endDate: "2026-07-10" }
        ]
      },
      ratesCache: {
        version: 3,
        bases: {
          USD: {
            fetchedAt: new Date().toISOString(),
            rateDate: "2026-07-10",
            catalogSignature: "AFN,CHF,EUR,PLN,USD",
            rates: { USD: 1, EUR: 0.9 }
          },
          CHF: {
            fetchedAt: new Date().toISOString(),
            rateDate: "2026-07-10",
            catalogSignature: "AFN,CHF,EUR,PLN,USD",
            rates: { CHF: 1, EUR: 1.08 }
          },
          PLN: {
            fetchedAt: new Date().toISOString(),
            rateDate: "2026-07-10",
            catalogSignature: "AFN,CHF,EUR,PLN,USD",
            rates: { PLN: 1, EUR: 0.235 }
          }
        }
      }
    });
  }, { showPagePrompt });
}

async function runPageCommand(extensionWorker, type, url = SHOP_URL) {
  return extensionWorker.evaluate(async ({ url, type }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
    await ensureContentScripts(tab.id);
    return chrome.tabs.sendMessage(tab.id, { type });
  }, { url, type });
}

test("shows a one-click conversion control without opening the toolbar popup", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker);

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);

  const control = shop.locator(".ccp-page-prompt");
  await expect(control.getByText("Currency Converter Pro", { exact: true })).toBeVisible();
  await expect(control).toContainText("Convert prices on this page to EUR.");
  await expect(control).toHaveCSS("top", "16px");
  await expect(control).toHaveCSS("right", "16px");
  await expect(control).toHaveCSS("animation-name", "ccp-page-prompt-enter");
  await control.getByRole("button", { name: "Convert page", exact: true }).click();

  await expect(shop.locator("#initial ccp-conversion[data-ccp-owned='true']")).toHaveCount(1);
  await expect(shop.locator("#initial")).toContainText("90,00");
  await expect(control).toContainText("Converted 1 price");
  await expect(control).toHaveAttribute("data-state", "success");
  await expect(control).toHaveCSS("animation-name", "ccp-page-prompt-success");
  await expect(shop.locator("#initial .ccp-badge")).toHaveCSS(
    "animation-name",
    "ccp-converted-value-enter"
  );
});

test("disables prompt and converted-value animations when reduced motion is requested", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker);

  const shop = await context.newPage();
  await shop.emulateMedia({ reducedMotion: "reduce" });
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);

  const control = shop.locator(".ccp-page-prompt");
  await expect(control).toBeVisible();
  await expect(control).toHaveCSS("animation-name", "none");
  await control.getByRole("button", { name: "Convert page", exact: true }).click();
  await expect(shop.locator("#initial .ccp-badge")).toHaveCSS("animation-name", "none");
  await expect(control).toHaveCSS("animation-name", "none");
});

test("restores the one-click control when a storefront replaces the page body", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker);

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);

  const control = shop.locator(".ccp-page-prompt");
  await expect(control).toBeVisible();
  await shop.evaluate(() => {
    const replacement = document.createElement("body");
    replacement.innerHTML = "<main><p>$25.00</p></main>";
    document.documentElement.replaceChild(replacement, document.body);
  });

  await expect(control).toBeVisible();
  await expect(control).toContainText("Convert prices on this page to EUR.");
});

test("converts marked prices split across neutral, obfuscated elements", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker);

  const shop = await context.newPage();
  await shop.route(SPLIT_PRICE_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SPLIT_PRICE_HTML
  }));
  await shop.goto(SPLIT_PRICE_URL);

  const conversion = await runPageCommand(
    extensionWorker,
    "RUN_SITE_CONVERSION",
    SPLIT_PRICE_URL
  );
  expect(conversion.ok).toBe(true);
  expect(conversion.count).toBe(1);
  expect(conversion.detectedCurrency).toBe("CHF");
  await expect(shop.locator("#digitec-price ccp-conversion")).toContainText("474");

  const allegro = await context.newPage();
  await allegro.route(SPLIT_FRACTION_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SPLIT_FRACTION_HTML
  }));
  await allegro.goto(SPLIT_FRACTION_URL);

  const splitFractionConversion = await runPageCommand(
    extensionWorker,
    "RUN_SITE_CONVERSION",
    SPLIT_FRACTION_URL
  );
  expect(splitFractionConversion.ok).toBe(true);
  expect(splitFractionConversion.count).toBe(1);
  expect(splitFractionConversion.detectedCurrency).toBe("PLN");
  const allegroPrice = allegro.locator("#allegro-price");
  expect(await allegroPrice.evaluate((element) =>
    [...element.children].slice(0, 2).map((child) => child.textContent)
  )).toEqual(["PLN\u00a079.", "00"]);
  await expect(allegro.locator("#allegro-price > ccp-conversion")).toHaveCount(1);
  await expect(allegro.locator("#allegro-row > ccp-conversion")).toHaveCount(0);
  await expect(allegro.locator("#allegro-title ccp-conversion")).toHaveCount(0);
});

test("real extension popup, injection, dynamic conversion, and undo work together", async ({
  context,
  extensionWorker,
  extensionId
}) => {
  await seedExtension(extensionWorker);

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 440, height: 600 });
  await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.getByRole("heading", { name: "Currency Converter Pro" })).toBeVisible();
  await expect(popup.getByText("Page conversion", { exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Favorite target currency" })).toHaveCount(0);
  await expect(popup.getByRole("button", { name: "Undo conversion" })).toBeDisabled();
  await expect(popup.getByRole("button", { name: "Forget site" })).toBeHidden();
  await expect(popup.locator("#pageOptions")).not.toHaveAttribute("open", "");
  await expect(popup.getByRole("combobox", { name: "Source currency", exact: true })).toHaveValue("AUTO");
  await expect(popup.locator("#fromCurrency option").first()).toHaveText("AUTO");
  await expect(popup.locator("#quickResult")).toHaveText("—");
  await expect(popup.locator("#quickResult")).toHaveAttribute("data-kind", "empty");
  await expect(popup.getByRole("combobox", { name: "Target currency", exact: true })).toHaveValue(/^EUR/);
  const sourceCurrency = popup.getByRole("combobox", { name: "Source currency", exact: true });
  await sourceCurrency.fill("USD");
  await popup.getByRole("option", { name: /^USD/ }).click();
  await expect.poll(() => extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("fromCurrency")).fromCurrency
  )).toBe("AUTO");
  await expect.poll(() => extensionWorker.evaluate(async (origin) =>
    (await chrome.storage.local.get("siteSourceCurrencies")).siteSourceCurrencies?.[origin],
  new URL(SHOP_URL).origin)).toBe("USD");
  expect(await extensionWorker.evaluate(async () =>
    (await getSettings("https://another-shop.example/product")).settings.fromCurrency
  )).toBe("AUTO");
  expect(await extensionWorker.evaluate(async (origin) =>
    (await getSettings(origin)).settings.fromCurrency,
  SHOP_URL)).toBe("USD");
  await expect(sourceCurrency).toHaveValue(/^USD/);
  await expect(popup.locator("#quickResult")).toContainText("0,90");
  await popup.getByRole("textbox", { name: "Amount", exact: true }).fill("25");
  await expect(popup.locator("#quickResult")).toContainText("22,50");
  await expect(popup.locator("#quickRateInfo")).toContainText("1 USD = 0.9 EUR");
  await expect(popup.locator("#quickRateInfo")).toHaveAttribute("title", /Frankfurter/);
  await expect(popup.locator("#fromCurrency option[value='AFN']")).toHaveCount(1);
  await expect(popup.locator("#toCurrency option[value='AFN']")).toHaveCount(0);
  expect(await popup.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  await popup.getByText("Page options", { exact: true }).click();
  await expect(popup.locator("#pageOptions")).toHaveAttribute("open", "");
  await popup.getByLabel("Price display").selectOption("replace");
  await expect.poll(() => extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("displayMode")).displayMode
  )).toBe("replace");
  await popup.close();
  await extensionWorker.evaluate(() => chrome.storage.sync.set({ displayMode: "beside" }));

  await shop.evaluate(() => globalThis.addLargeCatalog());
  const conversionStartedAt = Date.now();
  const conversion = await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION");
  const conversionDurationMs = Date.now() - conversionStartedAt;
  expect(conversion.ok).toBe(true);
  expect(conversion.count).toBe(2);
  expect(conversion.scannedTextNodes).toBeLessThanOrEqual(5000);
  expect(conversion.inspectedTextNodes).toBeLessThanOrEqual(20000);
  expect(conversionDurationMs).toBeLessThan(4000);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(2);
  await expect(shop.locator("#initial")).toContainText("90,00");
  await expect(shop.locator("#large-price")).toContainText("36,00");
  await expect(shop.locator("#hidden-price ccp-conversion")).toHaveCount(0);
  await expect(shop.locator(".ccp-badge").first()).toHaveAttribute("title", /1 USD = 0\.9 EUR.*Frankfurter/);

  await shop.evaluate(() => globalThis.addDynamicPrice());
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(3);
  await expect(shop.locator("#dynamic")).toContainText("22,50");

  const cleared = await runPageCommand(extensionWorker, "CLEAR_SITE_CONVERSION");
  expect(cleared.ok).toBe(true);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);
  await expect(shop.locator("#initial")).toHaveText("Price: $100.00");
  await expect(shop.locator("#large-price")).toHaveText("Large catalog price: $40.00");
  await expect(shop.locator("#dynamic")).toHaveText("Later price: $25.00");
});
