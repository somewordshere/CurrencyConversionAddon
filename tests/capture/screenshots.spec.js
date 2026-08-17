// Captures the product shots that scripts/build-store-screenshots.mjs composes.
// Kept out of the e2e suite so `playwright test` stays free of side effects.
//
//   npm run capture
//
// The shop content is fictional, but it must be served from the one origin the
// extension holds a standing host permission for: everything else runs on
// activeTab, so the service worker cannot see or drive those tabs. The in-page
// shots carry no address bar, so the origin never appears in them.
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("../e2e/fixtures");
const { openPopupForPage, runPageCommand, seedExtension } = require("../e2e/harness");

const SHOP_URL = "https://api.frankfurter.dev/shop/ceramics";
const SHOP_HTML = fs.readFileSync(path.resolve(__dirname, "../fixtures/capture-shop.html"), "utf8");
const OUT = path.resolve(__dirname, "../../screenshots");

async function openShop(context) {
  const shop = await context.newPage();
  await shop.setViewportSize({ width: 1180, height: 770 });
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  return shop;
}

test("capture popup", async ({ context, extensionWorker, extensionId }) => {
  await seedExtension(extensionWorker, { settings: { fromCurrency: "USD", toCurrency: "EUR" } });
  const shop = await openShop(context);

  const popup = await openPopupForPage(context, extensionId, shop);
  await popup.setViewportSize({ width: 420, height: 620 });
  await popup.waitForFunction(() => document.getElementById("rateValue").textContent !== "—");
  await popup.waitForTimeout(1000);

  // Chrome sizes the real popup to its content, so clip to that rather than
  // baking the viewport's leftover whitespace into the image.
  const clip = await popup.evaluate(() => {
    const app = document.getElementById("popupApp");
    return { x: 0, y: 0, width: 420, height: Math.ceil(app.getBoundingClientRect().height) };
  });
  await popup.screenshot({ path: path.join(OUT, "v2-popup-light.png"), clip });

  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.waitForTimeout(250);
  await popup.screenshot({ path: path.join(OUT, "v2-popup-dark.png"), clip });
});

test("capture in-page surfaces", async ({ context, extensionWorker }) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", toCurrency: "EUR", showPagePrompt: true }
  });
  const shop = await openShop(context);
  await runPageCommand(extensionWorker, "CONTENT_READY", SHOP_URL);

  // Prompt first, on an unconverted page: that is the only state it appears in.
  await runPageCommand(extensionWorker, "SHOW_CONVERT_PROMPT", SHOP_URL);
  await shop.waitForTimeout(600);
  await shop.screenshot({ path: path.join(OUT, "v2-inpage-prompt.png") });

  // Then convert, so the badges in the next shot are real conversions.
  await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION", SHOP_URL);
  await shop.waitForTimeout(600);
  await shop.screenshot({ path: path.join(OUT, "v2-inpage.png") });
});
