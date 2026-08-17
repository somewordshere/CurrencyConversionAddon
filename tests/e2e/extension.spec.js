const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./fixtures");
const {
  DEFAULT_SHOP_URL: SHOP_URL,
  evaluateRealActionPopup,
  openPopupForPage,
  runContentUiScenario,
  runPageCommand,
  seedExtension
} = require("./harness");

const UNAPPROVED_SHOP_URL = "https://unapproved-shop.example.test/";
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

test("real action popup keeps its designed width and scrolls expanded options", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker);
  const activePage = await context.newPage();

  const metrics = await evaluateRealActionPopup(
    context,
    extensionWorker,
    activePage,
    `(async () => {
      const waitFor = (condition, description) => new Promise((resolve, reject) => {
        const deadline = performance.now() + 5000;
        const check = () => {
          if (condition()) {
            resolve();
            return;
          }
          if (performance.now() >= deadline) {
            reject(new Error(\`Timed out waiting for \${description}.\`));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
      await waitFor(() => {
        const app = document.querySelector("#popupApp");
        return document.readyState === "complete" && app?.clientWidth > 0 && app.clientHeight > 0;
      }, "the action popup layout");

      const measure = () => {
        const app = document.querySelector("#popupApp");
        const initialScrollTop = app.scrollTop;
        app.scrollTop = app.scrollHeight;
        const maxScrollTop = app.scrollTop;
        app.scrollTop = initialScrollTop;
        return {
          innerWidth,
          bodyWidth: document.body.getBoundingClientRect().width,
          pageScrollWidth: document.documentElement.scrollWidth,
          appClientHeight: app.clientHeight,
          appScrollHeight: app.scrollHeight,
          maxScrollTop
        };
      };

      const closed = measure();
      document.querySelector("#pageOptions").open = true;
      await waitFor(() => {
        const app = document.querySelector("#popupApp");
        return app.scrollHeight > app.clientHeight;
      }, "expanded page options to overflow the popup");
      return { closed, expanded: measure() };
    })()`
  );

  expect(metrics.closed.innerWidth).toBe(420);
  expect(metrics.closed.bodyWidth).toBe(420);
  expect(metrics.closed.appScrollHeight).toBeLessThanOrEqual(metrics.closed.appClientHeight);

  for (const state of [metrics.closed, metrics.expanded]) {
    expect(state.bodyWidth).toBe(420);
    expect(state.pageScrollWidth).toBeLessThanOrEqual(state.innerWidth);
  }
  expect(metrics.expanded.appClientHeight).toBe(600);
  expect(metrics.expanded.appScrollHeight).toBeGreaterThan(metrics.expanded.appClientHeight);
  expect(metrics.expanded.maxScrollTop).toBeGreaterThan(0);
});

test("automatically detects prices and offers conversion on an ordinary website", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, { settings: { fromCurrency: "USD", showPagePrompt: true } });
  const shop = await context.newPage();
  await shop.route(UNAPPROVED_SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(UNAPPROVED_SHOP_URL);

  await expect(shop.locator(".ccp-page-prompt")).toBeVisible();
  await expect(shop.locator(".ccp-page-prompt")).toContainText("Convert visible prices");
  // The offer states the rate it would apply before the user accepts it.
  await expect(shop.locator(".ccp-page-prompt-rate")).toBeVisible();
  await expect(shop.locator(".ccp-page-prompt-rate")).toHaveText(/^1 USD = 0\.9000 EUR/);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);
});

test("converts marked prices split across neutral, obfuscated elements", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: {
      convertedTextColor: "#0f172a",
      convertedBackgroundColor: "#f8fafc",
      convertedShape: "square"
    }
  });

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
  const splitBadge = shop.locator("#digitec-price .ccp-badge");
  await expect(splitBadge).toHaveCSS("color", "rgb(15, 23, 42)");
  await expect(splitBadge).toHaveCSS("background-color", "rgb(248, 250, 252)");
  await expect(splitBadge).toHaveAttribute("data-ccp-shape", "square");

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

test("off-state popup turns on and converts the active page with one click", async ({
  context,
  extensionWorker,
  extensionId
}) => {
  await seedExtension(extensionWorker, {
    settings: { enabled: false, fromCurrency: "USD" }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  const ready = await runPageCommand(extensionWorker, "CONTENT_READY");
  expect(ready.ok).toBe(true);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);

  const popup = await openPopupForPage(context, extensionId, shop);
  const convertButton = popup.getByRole("button", { name: "Turn on and convert page" });
  await expect(convertButton).toBeVisible();
  await expect(popup.locator("#pageOptions")).not.toHaveAttribute("open", "");

  await convertButton.click();

  await expect.poll(() => extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("enabled")).enabled
  )).toBe(true);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(1);
  await expect(shop.locator("#initial")).toContainText("90,00");
  await expect(popup.locator("#enabled")).toBeChecked();
  await expect(popup.getByRole("button", { name: "Convert page prices" })).toBeVisible();
  await expect(popup.locator("#status")).toContainText("Converted 1 price");
  await expect(popup.locator("#clearPage")).toBeVisible();

  await popup.locator("#clearPage").click();
  await expect(popup.locator("#clearPage")).toBeHidden();
  await expect(popup.locator("#convertSite")).toBeFocused();
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);
});

test("offers conversion when a dynamic page adds a price later", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: true }
  });

  const shop = await context.newPage();
  await shop.route(UNAPPROVED_SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><main><h1>Dynamic shop</h1><div id='price-slot'></div></main>"
  }));
  await shop.goto(UNAPPROVED_SHOP_URL);
  await expect(shop.locator(".ccp-page-prompt")).toHaveCount(0);

  await shop.locator("#price-slot").evaluate((element) => {
    element.className = "product-price";
    element.textContent = "$125.00";
  });
  await expect(shop.locator(".ccp-page-prompt")).toBeVisible();
});

test("continues converting mutations inside a late-added open shadow root", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });
  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><main><h1>Shadow shop</h1></main>"
  }));
  await shop.goto(SHOP_URL);
  expect((await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION")).ok).toBe(false);

  await shop.evaluate(() => {
    const host = document.createElement("section");
    host.id = "late-shadow-host";
    host.attachShadow({ mode: "open" }).innerHTML =
      '<p id="late-shadow-price" class="product-price">Shadow: $10.00</p>';
    document.body.appendChild(host);
  });
  const shadowPrice = shop.locator("#late-shadow-price");
  await expect(shadowPrice.locator(".ccp-badge")).toContainText("9,00");

  await shadowPrice.evaluate((element) => {
    element.textContent = "Shadow updated: $20.00";
  });
  await expect(shadowPrice.locator(".ccp-badge")).toContainText("18,00");

  const shadowWrapper = shadowPrice.locator("ccp-conversion[data-ccp-owned='true']");
  await shadowWrapper.evaluate((element) => {
    element.dataset.presentationIdentity = "late-shadow";
  });
  await extensionWorker.evaluate(() => chrome.storage.sync.set({
    convertedTextColor: "#123456"
  }));
  await expect(shadowPrice.locator(".ccp-badge")).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(shadowWrapper).toHaveAttribute("data-presentation-identity", "late-shadow");
});

test("rescans the full document when an SPA route changes", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "AUTO", showPagePrompt: false }
  });
  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html>
      <head><meta property="product:price:currency" content="USD"></head>
      <body>
        <main>
          <p id="initial-route-price" class="product-price">Initial: $10.00</p>
          <p id="next-route-price" class="product-price" hidden>Next route: $20.00</p>
        </main>
        <aside id="route-mutation-slot"></aside>
      </body>`
  }));
  await shop.goto(SHOP_URL);

  const initialResult = await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION");
  expect(initialResult.ok).toBe(true);
  expect(initialResult.count).toBe(1);
  const initialBadge = shop.locator("#initial-route-price .ccp-badge");
  await expect(initialBadge).toContainText("9,00");

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalSpaRateService = globalThis.CurrencyRateService;
    globalThis.__ccpSpaRateBase = null;
    globalThis.CurrencyRateService = Object.freeze({
      ...globalThis.CurrencyRateService,
      getRates: async (baseCurrency) => {
        if (baseCurrency !== "MXN") {
          return globalThis.__ccpOriginalSpaRateService.getRates(baseCurrency);
        }
        globalThis.__ccpSpaRateBase = baseCurrency;
        return {
          ok: true,
          rates: { MXN: 1, EUR: 0.05 },
          date: "2026-07-10",
          provider: "SPA route test rate"
        };
      }
    });
  });

  try {
    await shop.evaluate(() => {
      history.pushState({}, "", "/spa-route-two");
      document.querySelector("meta[property='product:price:currency']").content = "MXN";
      document.querySelector("#next-route-price").hidden = false;
    });

    // Exercise the idempotent startWatching path between pushState and the first
    // observable route mutation. It must not accept the new URL prematurely.
    await extensionWorker.evaluate(() => chrome.storage.sync.set({
      convertedTextColor: "#123456"
    }));
    await expect(initialBadge).toHaveCSS("color", "rgb(18, 52, 86)");
    await expect(shop.locator("#next-route-price ccp-conversion")).toHaveCount(0);

    await shop.locator("#route-mutation-slot").evaluate((element) => {
      const unrelated = document.createElement("span");
      unrelated.textContent = "Route UI ready";
      element.appendChild(unrelated);
    });

    const routeBadge = shop.locator("#next-route-price .ccp-badge");
    await expect(routeBadge).toContainText("1,00");
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpSpaRateBase
    )).toBe("MXN");
  } finally {
    await extensionWorker.evaluate(() => {
      if (globalThis.__ccpOriginalSpaRateService) {
        globalThis.CurrencyRateService = globalThis.__ccpOriginalSpaRateService;
      }
      delete globalThis.__ccpOriginalSpaRateService;
      delete globalThis.__ccpSpaRateBase;
    });
  }
});

test("an explicit full scan escalates an in-flight mutation subset scan", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });
  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><main><h1>Queued shop</h1></main>"
  }));
  await shop.goto(SHOP_URL);
  await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION");

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalEscalationRateService = globalThis.CurrencyRateService;
    globalThis.__ccpEscalationRateRequested = false;
    globalThis.__ccpEscalationRate = new Promise((resolve) => {
      globalThis.__ccpReleaseEscalationRate = () => resolve({
        ok: true,
        rates: { USD: 1, EUR: 0.9 },
        date: "2026-07-10",
        provider: "Escalation test rate"
      });
    });
    globalThis.CurrencyRateService = Object.freeze({
      ...globalThis.CurrencyRateService,
      getRates: async () => {
        globalThis.__ccpEscalationRateRequested = true;
        return globalThis.__ccpEscalationRate;
      }
    });
  });

  try {
    await shop.evaluate(() => {
      const subset = document.createElement("p");
      subset.id = "subset-price";
      subset.className = "product-price";
      subset.textContent = "Subset: $10.00";
      document.body.appendChild(subset);
    });
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpEscalationRateRequested
    )).toBe(true);

    await shop.evaluate(() => {
      const fullOnly = document.createElement("p");
      fullOnly.id = "full-only-price";
      fullOnly.className = "product-price";
      fullOnly.textContent = "Full only: $20.00";
      document.body.appendChild(fullOnly);
    });
    await extensionWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === url);
      if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
      globalThis.__ccpEscalatedFullConversion = chrome.tabs.sendMessage(tab.id, {
        type: "RUN_SITE_CONVERSION"
      });
    }, SHOP_URL);
    await extensionWorker.evaluate(() => globalThis.__ccpReleaseEscalationRate());
    const result = await extensionWorker.evaluate(() => globalThis.__ccpEscalatedFullConversion);

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    await expect(shop.locator("#subset-price .ccp-badge")).toContainText("9,00");
    await expect(shop.locator("#full-only-price .ccp-badge")).toContainText("18,00");
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.__ccpReleaseEscalationRate?.();
      globalThis.CurrencyRateService = globalThis.__ccpOriginalEscalationRateService;
      delete globalThis.__ccpOriginalEscalationRateService;
      delete globalThis.__ccpEscalationRateRequested;
      delete globalThis.__ccpEscalationRate;
      delete globalThis.__ccpReleaseEscalationRate;
      delete globalThis.__ccpEscalatedFullConversion;
    });
  }
});

test("page prompt and keyboard-selection control restore focus on Escape", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: true }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  const initialPrompt = shop.locator(".ccp-page-prompt");
  await expect(initialPrompt).toBeVisible();
  await initialPrompt.getByRole("button", { name: "Dismiss currency converter" }).click();
  await shop.evaluate(() => {
    const focusAnchor = document.createElement("button");
    focusAnchor.id = "focus-anchor";
    focusAnchor.textContent = "Focus anchor";
    document.body.prepend(focusAnchor);
    focusAnchor.focus();
  });

  await runPageCommand(extensionWorker, "SHOW_CONVERT_PROMPT");
  const prompt = shop.locator(".ccp-page-prompt");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Convert prices" }).focus();
  await shop.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(shop.locator("#focus-anchor")).toBeFocused();

  expect(await runContentUiScenario(extensionWorker, "selection-success")).toEqual({ ok: true });
  await shop.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("initial"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const selectionControl = shop.locator(".ccp-selection-popup");
  await shop.keyboard.down("Shift");
  await shop.keyboard.press("ArrowRight");
  await expect(selectionControl).toHaveCount(0);
  await shop.keyboard.up("Shift");
  await expect(selectionControl).toBeVisible();
  await expect(selectionControl).toBeFocused();
  await expect(selectionControl).toHaveAttribute(
    "aria-label",
    "Convert selected USD price to EUR"
  );
  await expect(selectionControl).toHaveAttribute("aria-live", "polite");
  await expect(selectionControl).toHaveAttribute("aria-atomic", "true");

  await shop.keyboard.press("Shift");
  await expect(selectionControl).toBeVisible();
  await expect(selectionControl).toBeFocused();

  await selectionControl.press("Enter");
  await expect(selectionControl).toHaveAttribute("aria-busy", "true");
  await expect(selectionControl).toHaveAttribute(
    "aria-label",
    "Converting selected USD price to EUR"
  );
  expect(await runContentUiScenario(
    extensionWorker,
    "complete-selection-success"
  )).toEqual({ ok: true });
  await expect(selectionControl).toHaveAttribute(
    "aria-label",
    "Converted selected USD price to EUR 90.00"
  );
  await expect(selectionControl).toHaveAttribute("data-state", "success");
  await expect(selectionControl).not.toHaveAttribute("aria-busy", "true");
  await shop.keyboard.press("Escape");
  await expect(selectionControl).toHaveCount(0);
  await expect(shop.locator("#focus-anchor")).toBeFocused();
});

test("transient page actions recover and announce rejected callbacks", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  expect((await runPageCommand(extensionWorker, "SHOW_CONVERT_PROMPT")).ok).toBe(true);
  await shop.evaluate(() => {
    const focusAnchor = document.createElement("button");
    focusAnchor.id = "rejection-focus-anchor";
    focusAnchor.textContent = "Rejection focus anchor";
    document.body.prepend(focusAnchor);
    focusAnchor.focus();
  });
  expect(await runContentUiScenario(extensionWorker, "rejected-actions")).toEqual({ ok: true });

  const prompt = shop.locator(".ccp-page-prompt");
  const promptMessage = prompt.locator(".ccp-page-prompt-message");
  await prompt.getByRole("button", { name: "Convert prices" }).click();
  await expect(prompt.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(promptMessage).toHaveText(
    "Prices could not be converted. Conversion callback rejected"
  );
  await expect(prompt).toHaveAttribute("data-state", "error");

  expect(await runContentUiScenario(extensionWorker, "undo-rejection")).toEqual({ ok: true });
  await prompt.getByRole("button", { name: "Try again" }).click();
  await expect(prompt.getByRole("button", { name: "Undo" })).toBeEnabled();
  await prompt.getByRole("button", { name: "Undo" }).click();
  await expect(prompt.getByRole("button", { name: "Try undo again" })).toBeEnabled();
  await expect(promptMessage).toHaveText(
    "Original prices could not be restored. Restore callback rejected"
  );
  await expect(prompt).toHaveAttribute("data-state", "error");
  await prompt.getByRole("button", { name: "Dismiss currency converter" }).click();
  await expect(shop.locator("#rejection-focus-anchor")).toBeFocused();

  await shop.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("initial"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await shop.keyboard.press("Shift");
  const selectionControl = shop.locator(".ccp-selection-popup");
  await expect(selectionControl).toHaveAttribute(
    "aria-label",
    "Convert selected USD price to EUR"
  );
  await selectionControl.press("Enter");
  await expect(selectionControl).toBeEnabled();
  await expect(selectionControl).toHaveAttribute("data-state", "error");
  await expect(selectionControl).toHaveAttribute(
    "aria-label",
    "Selection conversion failed: Selection could not be converted. Selection callback rejected"
  );
  await expect(selectionControl).not.toHaveAttribute("aria-busy", "true");
  await shop.keyboard.press("Escape");
  await expect(shop.locator("#rejection-focus-anchor")).toBeFocused();

  expect(await runContentUiScenario(extensionWorker, "toast-rejection")).toEqual({ ok: true });
  const toast = shop.locator(".ccp-toast");
  const toastAction = toast.getByRole("button", { name: "Undo" });
  await toastAction.click();
  await expect(toastAction).toBeEnabled();
  await expect(toast).toHaveAttribute("data-state", "error");
  await expect(toast.locator(".ccp-toast-message")).toHaveText(
    "Undo failed. Toast callback rejected"
  );
  await expect(toast.locator(".ccp-toast-message")).toHaveAttribute("aria-live", "polite");
  await toast.getByRole("button", { name: "Dismiss conversion result" }).click();
  await expect(shop.locator("#rejection-focus-anchor")).toBeFocused();
});

test("restoring prices invalidates in-flight and queued conversions", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  await runPageCommand(extensionWorker, "CONTENT_READY");

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalRateService = globalThis.CurrencyRateService;
    globalThis.__ccpDelayedRate = new Promise((resolve) => {
      globalThis.__ccpReleaseDelayedRate = () => resolve({
        ok: true,
        rates: { USD: 1, EUR: 0.9 },
        date: "2026-07-10",
        provider: "Delayed test rate"
      });
    });
    globalThis.__ccpDelayedRateRequested = false;
    globalThis.CurrencyRateService = Object.freeze({
      ...globalThis.CurrencyRateService,
      getRates: async () => {
        globalThis.__ccpDelayedRateRequested = true;
        return globalThis.__ccpDelayedRate;
      }
    });
  });

  try {
    await extensionWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === url);
      if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
      globalThis.__ccpInflightConversion = chrome.tabs.sendMessage(tab.id, {
        type: "RUN_SITE_CONVERSION"
      });
    }, SHOP_URL);

    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpDelayedRateRequested
    )).toBe(true);

    await extensionWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === url);
      if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
      globalThis.__ccpQueuedConversion = chrome.tabs.sendMessage(tab.id, {
        type: "RUN_SITE_CONVERSION"
      });
    }, SHOP_URL);

    const cleared = await runPageCommand(extensionWorker, "CLEAR_SITE_CONVERSION");
    expect(cleared.ok).toBe(true);
    await extensionWorker.evaluate(() => globalThis.__ccpReleaseDelayedRate());
    const [conversion, queuedConversion] = await extensionWorker.evaluate(
      () => Promise.all([
        globalThis.__ccpInflightConversion,
        globalThis.__ccpQueuedConversion
      ])
    );
    expect(conversion.cancelled).toBe(true);
    expect(queuedConversion.cancelled).toBe(true);
    await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);
    await expect(shop.locator("#initial")).toHaveText("Price: $100.00");
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.__ccpReleaseDelayedRate?.();
      globalThis.CurrencyRateService = globalThis.__ccpOriginalRateService;
      delete globalThis.__ccpOriginalRateService;
      delete globalThis.__ccpDelayedRate;
      delete globalThis.__ccpReleaseDelayedRate;
      delete globalThis.__ccpDelayedRateRequested;
      delete globalThis.__ccpInflightConversion;
      delete globalThis.__ccpQueuedConversion;
    });
  }
});

test("Restore suppresses stale settings-reload page actions", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  expect((await runPageCommand(extensionWorker, "SHOW_CONVERT_PROMPT")).ok).toBe(true);
  await expect(shop.locator(".ccp-page-prompt")).toHaveCount(0);

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalCatalogService = globalThis.CurrencyCatalogService;
    globalThis.__ccpDelayedCatalogRequested = false;
    globalThis.__ccpDelayedCatalog = new Promise((resolve) => {
      globalThis.__ccpReleaseDelayedCatalog = resolve;
    });
    globalThis.CurrencyCatalogService = Object.freeze({
      ...globalThis.CurrencyCatalogService,
      getCachedCurrencies: async () => {
        globalThis.__ccpDelayedCatalogRequested = true;
        await globalThis.__ccpDelayedCatalog;
        return globalThis.__ccpOriginalCatalogService.getCachedCurrencies();
      },
      getCurrencies: async () => {
        globalThis.__ccpDelayedCatalogRequested = true;
        await globalThis.__ccpDelayedCatalog;
        return globalThis.__ccpOriginalCatalogService.getCurrencies();
      }
    });
  });

  try {
    await extensionWorker.evaluate(() => chrome.storage.sync.set({
      displayMode: "replace",
      showPagePrompt: true
    }));
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpDelayedCatalogRequested
    )).toBe(true);

    const cleared = await extensionWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url === url);
      if (!tab?.id) throw new Error(`Could not find test page tab: ${url}`);
      return chrome.tabs.sendMessage(tab.id, {
        type: "CLEAR_SITE_CONVERSION",
        suppressPrompt: true
      });
    }, SHOP_URL);
    expect(cleared.ok).toBe(true);

    await extensionWorker.evaluate(() => globalThis.__ccpReleaseDelayedCatalog());
    const selectionResult = await runPageCommand(extensionWorker, "CONVERT_SELECTION");
    expect(selectionResult.ok).toBe(false);
    await expect(shop.locator(".ccp-page-prompt")).toHaveCount(0);
    await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.__ccpReleaseDelayedCatalog?.();
      globalThis.CurrencyCatalogService = globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpDelayedCatalogRequested;
      delete globalThis.__ccpDelayedCatalog;
      delete globalThis.__ccpReleaseDelayedCatalog;
    });
  }
});

test("coalesced settings reload reconverts existing prices to the final pair", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  expect((await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION")).ok).toBe(true);
  const conversion = shop.locator("#initial ccp-conversion");
  await expect(conversion).toHaveAttribute("data-display-mode", "beside");
  await expect(conversion.locator(".ccp-badge")).toHaveAttribute("title", /to EUR/);

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalCatalogService = globalThis.CurrencyCatalogService;
    globalThis.__ccpDelayedCatalogRequested = false;
    globalThis.__ccpDelayedCatalog = new Promise((resolve) => {
      globalThis.__ccpReleaseDelayedCatalog = resolve;
    });
    globalThis.CurrencyCatalogService = Object.freeze({
      ...globalThis.CurrencyCatalogService,
      getCachedCurrencies: async () => {
        globalThis.__ccpDelayedCatalogRequested = true;
        await globalThis.__ccpDelayedCatalog;
        return globalThis.__ccpOriginalCatalogService.getCachedCurrencies();
      },
      getCurrencies: async () => {
        globalThis.__ccpDelayedCatalogRequested = true;
        await globalThis.__ccpDelayedCatalog;
        return globalThis.__ccpOriginalCatalogService.getCurrencies();
      }
    });
  });

  try {
    await extensionWorker.evaluate(() => chrome.storage.sync.set({ displayMode: "replace" }));
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpDelayedCatalogRequested
    )).toBe(true);
    await extensionWorker.evaluate(() => chrome.storage.sync.set({ toCurrency: "CHF" }));
    await extensionWorker.evaluate(() => globalThis.__ccpReleaseDelayedCatalog());

    const selectionResult = await runPageCommand(extensionWorker, "CONVERT_SELECTION");
    expect(selectionResult.ok).toBe(false);
    await expect(conversion).toHaveAttribute("data-display-mode", "replace");
    await expect(conversion.locator(".ccp-badge")).toHaveAttribute("title", /to CHF/);
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.__ccpReleaseDelayedCatalog?.();
      globalThis.CurrencyCatalogService = globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpDelayedCatalogRequested;
      delete globalThis.__ccpDelayedCatalog;
      delete globalThis.__ccpReleaseDelayedCatalog;
    });
  }
});

test("failed reloads and removed site preferences stop stale page conversion", async ({
  context,
  extensionWorker
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  expect((await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION")).ok).toBe(true);
  await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(1);

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalCatalogService = globalThis.CurrencyCatalogService;
    globalThis.__ccpFailedCatalogRequested = false;
    globalThis.CurrencyCatalogService = Object.freeze({
      ...globalThis.CurrencyCatalogService,
      getCachedCurrencies: async () => {
        globalThis.__ccpFailedCatalogRequested = true;
        throw new Error("Forced settings reload failure");
      },
      getCurrencies: async () => {
        globalThis.__ccpFailedCatalogRequested = true;
        throw new Error("Forced settings reload failure");
      }
    });
  });

  try {
    await extensionWorker.evaluate(() => chrome.storage.sync.set({ toCurrency: "CHF" }));
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpFailedCatalogRequested
    )).toBe(true);
    const failedSelection = await runPageCommand(extensionWorker, "CONVERT_SELECTION");
    expect(failedSelection.ok).toBe(false);
    expect(failedSelection.error).toBe("Extension is turned off.");
    await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);

    await shop.evaluate(() => {
      const price = document.createElement("p");
      price.id = "after-failed-reload";
      price.textContent = "After failed reload: $30.00";
      document.body.appendChild(price);
    });
    await shop.waitForTimeout(250);
    await expect(shop.locator("#after-failed-reload ccp-conversion")).toHaveCount(0);

    await extensionWorker.evaluate(() => {
      globalThis.CurrencyCatalogService = globalThis.__ccpOriginalCatalogService;
    });
    const reconverted = await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION");
    expect(reconverted.ok).toBe(true);
    await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(2);

    const origin = new URL(SHOP_URL).origin;
    await extensionWorker.evaluate(
      ({ origin }) => chrome.storage.local.set({
        autoConvertSites: { [origin]: true },
        siteSourceCurrencies: { [origin]: "USD" }
      }),
      { origin }
    );
    await shop.waitForTimeout(100);
    await runPageCommand(extensionWorker, "CONVERT_SELECTION");
    await extensionWorker.evaluate(() => chrome.storage.local.set({
      autoConvertSites: {},
      siteSourceCurrencies: {}
    }));
    await shop.waitForTimeout(100);
    await runPageCommand(extensionWorker, "CONVERT_SELECTION");
    await expect(shop.locator("ccp-conversion[data-ccp-owned='true']")).toHaveCount(0);

    await shop.evaluate(() => {
      const price = document.createElement("p");
      price.id = "after-forget";
      price.textContent = "After forget: $45.00";
      document.body.appendChild(price);
    });
    await shop.waitForTimeout(250);
    await expect(shop.locator("#after-forget ccp-conversion")).toHaveCount(0);
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.CurrencyCatalogService = globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpOriginalCatalogService;
      delete globalThis.__ccpFailedCatalogRequested;
    });
  }
});

test("rapid popup changes remain consistent across close and validation races", async ({
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

  await extensionWorker.evaluate(() => {
    globalThis.__ccpOriginalRateService = globalThis.CurrencyRateService;
    globalThis.__ccpDelayedRateRequested = false;
    globalThis.__ccpDelayedPopupRate = new Promise((resolve) => {
      globalThis.__ccpReleaseDelayedPopupRate = () => resolve({
        ok: true,
        // USD is quoted here so it stays selectable as a target: the popup now
        // narrows the target list to quotable currencies from first paint.
        rates: { CHF: 1, EUR: 1.08, USD: 1.1 },
        date: "2026-07-10",
        provider: "Delayed popup test rate"
      });
    });
    globalThis.CurrencyRateService = Object.freeze({
      ...globalThis.CurrencyRateService,
      getRates: async () => {
        globalThis.__ccpDelayedRateRequested = true;
        return globalThis.__ccpDelayedPopupRate;
      }
    });
    globalThis.__ccpObservedPopupUpdates = [];
    globalThis.__ccpObservedPopupSettingsReads = 0;
    globalThis.__ccpPopupUpdateObserver = (message) => {
      if (message?.type === "UPDATE_SETTINGS") {
        globalThis.__ccpObservedPopupUpdates.push(structuredClone(message.payload));
      }
      if (message?.type === "GET_SETTINGS") {
        globalThis.__ccpObservedPopupSettingsReads += 1;
      }
    };
    chrome.runtime.onMessage.addListener(globalThis.__ccpPopupUpdateObserver);
  });

  try {
    const popup = await openPopupForPage(context, extensionId, shop);
    await expect(popup.locator("#fromCurrency")).toBeEnabled();
    await popup.evaluate(() => {
      const source = document.getElementById("fromCurrency");
      source.value = "CHF";
      source.dispatchEvent(new Event("change", { bubbles: true }));

      const displayMode = document.getElementById("displayMode");
      displayMode.value = "replace";
      displayMode.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpObservedPopupUpdates?.length
    )).toBe(2);
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpDelayedRateRequested
    )).toBe(true);
    await popup.close();

    const reopenedPopup = await openPopupForPage(context, extensionId, shop);
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpObservedPopupSettingsReads
    )).toBe(2);
    await extensionWorker.evaluate(() => globalThis.__ccpReleaseDelayedPopupRate());
    await expect.poll(() => extensionWorker.evaluate(async () => {
      const settings = await chrome.storage.sync.get(["fromCurrency", "displayMode"]);
      return `${settings.fromCurrency}:${settings.displayMode}`;
    })).toBe("CHF:replace");
    await expect(reopenedPopup.getByRole(
      "combobox",
      { name: "Source currency", exact: true }
    )).toHaveValue(/^CHF/);
    await expect(reopenedPopup.getByLabel("Price display")).toHaveValue("replace");

    await extensionWorker.evaluate(() => {
      globalThis.__ccpSecondDelayedRateRequested = false;
      globalThis.__ccpSecondDelayedPopupRate = new Promise((resolve) => {
        globalThis.__ccpReleaseSecondDelayedPopupRate = () => resolve({
          ok: true,
          rates: { USD: 1, EUR: 0.9 },
          date: "2026-07-10",
          provider: "Second delayed popup test rate"
        });
      });
      globalThis.CurrencyRateService = Object.freeze({
        ...globalThis.CurrencyRateService,
        getRates: async () => {
          globalThis.__ccpSecondDelayedRateRequested = true;
          return globalThis.__ccpSecondDelayedPopupRate;
        }
      });
    });
    await reopenedPopup.evaluate(() => {
      const source = document.getElementById("fromCurrency");
      source.value = "USD";
      source.dispatchEvent(new Event("change", { bubbles: true }));

      const target = document.getElementById("toCurrency");
      target.value = "USD";
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpObservedPopupUpdates?.length
    )).toBe(3);
    await expect.poll(() => extensionWorker.evaluate(
      () => globalThis.__ccpSecondDelayedRateRequested
    )).toBe(true);
    await extensionWorker.evaluate(() => globalThis.__ccpReleaseSecondDelayedPopupRate());
    await expect.poll(() => extensionWorker.evaluate(async () => {
      const settings = await chrome.storage.sync.get(["fromCurrency", "toCurrency"]);
      return `${settings.fromCurrency}:${settings.toCurrency}`;
    })).toBe("USD:EUR");
    await expect(reopenedPopup.getByRole(
      "combobox",
      { name: "Source currency", exact: true }
    )).toHaveValue(/^USD/);
    await expect(reopenedPopup.getByRole(
      "combobox",
      { name: "Target currency", exact: true }
    )).toHaveValue(/^EUR/);
    await expect(reopenedPopup.locator("#status")).toContainText("Choose two different currencies");
  } finally {
    await extensionWorker.evaluate(() => {
      globalThis.__ccpReleaseDelayedPopupRate?.();
      globalThis.__ccpReleaseSecondDelayedPopupRate?.();
      if (globalThis.__ccpPopupUpdateObserver) {
        chrome.runtime.onMessage.removeListener(globalThis.__ccpPopupUpdateObserver);
      }
      globalThis.CurrencyRateService = globalThis.__ccpOriginalRateService;
      delete globalThis.__ccpOriginalRateService;
      delete globalThis.__ccpDelayedRateRequested;
      delete globalThis.__ccpDelayedPopupRate;
      delete globalThis.__ccpReleaseDelayedPopupRate;
      delete globalThis.__ccpObservedPopupUpdates;
      delete globalThis.__ccpObservedPopupSettingsReads;
      delete globalThis.__ccpPopupUpdateObserver;
      delete globalThis.__ccpSecondDelayedRateRequested;
      delete globalThis.__ccpSecondDelayedPopupRate;
      delete globalThis.__ccpReleaseSecondDelayedPopupRate;
    });
  }
});

test("converted price appearance previews live, persists, and styles the page", async ({
  context,
  extensionWorker,
  extensionId
}) => {
  await seedExtension(extensionWorker, {
    settings: { fromCurrency: "USD", showPagePrompt: false }
  });

  const shop = await context.newPage();
  await shop.route(SHOP_URL, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: SHOP_HTML
  }));
  await shop.goto(SHOP_URL);
  await shop.evaluate(() => {
    const host = document.createElement("div");
    host.id = "shadow-price-host";
    host.attachShadow({ mode: "open" }).innerHTML = '<p id="shadow-price">Shadow price: $20.00</p>';
    document.body.appendChild(host);
  });

  const initialConversion = await runPageCommand(extensionWorker, "RUN_SITE_CONVERSION");
  expect(initialConversion.ok).toBe(true);
  const convertedBadge = shop.locator("#initial .ccp-badge");
  const shadowBadge = shop.locator("#shadow-price .ccp-badge");
  await expect(convertedBadge).toHaveCSS("color", "rgb(22, 101, 52)");
  await expect(shadowBadge).toHaveCSS("background-color", "rgb(220, 252, 231)");
  const appearanceConversion = shop.locator("#initial ccp-conversion");
  await appearanceConversion.evaluate((element) => {
    element.dataset.appearancePreservationCheck = "same-conversion";
  });

  const popup = await openPopupForPage(context, extensionId, shop);
  await popup.setViewportSize({ width: 440, height: 600 });
  await popup.getByText("Page options", { exact: true }).click();
  const appearanceGroup = popup.getByRole("group", {
    name: "Converted price appearance",
    exact: true
  });
  await expect(appearanceGroup).toBeVisible();
  const beforePreview = popup.locator(".preview-before");
  const afterPreview = popup.locator("#appearancePreview");
  const textHex = popup.getByRole("textbox", { name: "Text color hex value" });
  const backgroundHex = popup.getByRole("textbox", { name: "Background color hex value" });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await popup.setViewportSize({ width: 420, height: 600 });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(afterPreview).toBeVisible();
  await popup.setViewportSize({ width: 440, height: 600 });

  await expect(beforePreview).toHaveCSS("color", "rgb(21, 128, 61)");
  await textHex.fill("#FFFFFF");
  await expect(afterPreview).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(popup.locator("#appearanceContrast")).toContainText("fails WCAG AA");
  expect(await extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("convertedTextColor")).convertedTextColor
  )).toBe("#166534");

  await textHex.blur();
  await backgroundHex.fill("#111827");
  await expect.poll(() => extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("convertedTextColor")).convertedTextColor
  )).toBe("#ffffff");
  await expect(backgroundHex).toHaveValue("#111827");
  await expect(afterPreview).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(popup.locator("#appearanceContrast")).toContainText("passes WCAG AAA");
  await expect(convertedBadge).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(shadowBadge).toHaveCSS("color", "rgb(255, 255, 255)");
  await backgroundHex.blur();
  await popup.getByText("Pill", { exact: true }).click();
  await expect(popup.getByRole("radio", { name: "Pill" })).toBeChecked();
  await expect(afterPreview).toHaveCSS("border-radius", "999px");
  await expect.poll(() => extensionWorker.evaluate(async () => {
    const settings = await chrome.storage.sync.get([
      "convertedTextColor",
      "convertedBackgroundColor",
      "convertedShape"
    ]);
    return `${settings.convertedTextColor}:${settings.convertedBackgroundColor}:${settings.convertedShape}`;
  })).toBe("#ffffff:#111827:pill");

  await popup.close();
  const reopenedPopup = await openPopupForPage(context, extensionId, shop);
  await reopenedPopup.getByText("Page options", { exact: true }).click();
  await expect(reopenedPopup.getByRole("textbox", { name: "Text color hex value" })).toHaveValue("#FFFFFF");
  await expect(reopenedPopup.getByRole("textbox", { name: "Background color hex value" })).toHaveValue("#111827");
  await expect(reopenedPopup.getByRole("radio", { name: "Pill" })).toBeChecked();

  await expect(convertedBadge).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(convertedBadge).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(convertedBadge).toHaveAttribute("data-ccp-shape", "pill");
  await expect(shadowBadge).toHaveAttribute("data-ccp-shape", "pill");
  await expect(appearanceConversion).toHaveAttribute(
    "data-appearance-preservation-check",
    "same-conversion"
  );

  await reopenedPopup.getByLabel("Price display").selectOption("replace");
  await expect(shop.locator("#shadow-price .ccp-original")).toHaveCSS("display", "none");

  await reopenedPopup.getByRole("button", { name: "Reset appearance" }).click();
  await expect.poll(() => extensionWorker.evaluate(async () => {
    const settings = await chrome.storage.sync.get([
      "convertedTextColor",
      "convertedBackgroundColor",
      "convertedShape"
    ]);
    return `${settings.convertedTextColor}:${settings.convertedBackgroundColor}:${settings.convertedShape}`;
  })).toBe("#166534:#dcfce7:rounded");
  await expect(convertedBadge).toHaveCSS("color", "rgb(22, 101, 52)");
  await expect(shadowBadge).toHaveCSS("background-color", "rgb(220, 252, 231)");
  await expect(appearanceConversion).toHaveAttribute(
    "data-appearance-preservation-check",
    "same-conversion"
  );
  await expect(reopenedPopup.getByRole("button", { name: "Reset appearance" })).toBeFocused();
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

  const popup = await openPopupForPage(context, extensionId, shop);
  await popup.setViewportSize({ width: 440, height: 600 });
  await expect(popup.getByText("Enable converter", { exact: true })).toBeHidden();
  await expect(popup.getByRole("button", { name: "Favorite target currency" })).toHaveCount(0);
  await expect(popup.locator("#clearPage")).toBeHidden();
  await expect(popup.locator("#clearSite")).toBeHidden();
  await expect(popup.locator("#pageOptions")).not.toHaveAttribute("open", "");
  await expect(popup.getByRole("combobox", { name: "Source currency", exact: true })).toHaveValue("AUTO");
  await expect(popup.locator("#fromCurrency option").first()).toHaveText("AUTO");
  await expect(popup.getByRole("combobox", { name: "Target currency", exact: true })).toHaveValue(/^EUR/);
  expect(await popup.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  // The amount row is always visible in 2.0; only Page options stays behind a disclosure.
  await expect(popup.locator("#quickConverter")).toBeVisible();
  await expect(popup.locator("#quickSourceRequired")).toBeVisible();
  await expect(popup.locator("#quickConverterFields")).toBeHidden();
  const sourceCurrency = popup.getByRole("combobox", { name: "Source currency", exact: true });
  await popup.getByRole("button", { name: "Choose source currency" }).click();
  await expect(sourceCurrency).toBeFocused();
  await sourceCurrency.fill("USD");
  await popup.getByRole("option", { name: /^USD/ }).click();
  await expect.poll(() => extensionWorker.evaluate(async () =>
    (await chrome.storage.sync.get("fromCurrency")).fromCurrency
  )).toBe("USD");
  await expect(sourceCurrency).toHaveValue(/^USD/);
  await expect(popup.locator("#quickSourceRequired")).toBeHidden();
  await expect(popup.locator("#quickConverterFields")).toBeVisible();
  await expect(popup.locator("#quickResult")).toContainText("0,90");
  await popup.getByRole("textbox", { name: "Amount", exact: true }).fill("25");
  await expect(popup.locator("#quickResult")).toContainText("22,50");
  await expect(popup.locator("#quickRateInfo")).toContainText("1 USD = 0.9 EUR");
  await expect(popup.locator("#quickRateInfo")).toHaveAttribute("title", /Frankfurter/);
  await expect(popup.locator("#fromCurrency option[value='AFN']")).toHaveCount(1);
  await expect(popup.locator("#toCurrency option[value='AFN']")).toHaveCount(0);

  // The live rate hero reads from the same rate response as the amount row.
  await expect(popup.locator("#rateFrom")).toHaveText("USD");
  await expect(popup.locator("#rateTo")).toHaveText("EUR");
  await expect(popup.locator("#rateValue")).toHaveText("0.9000");
  await expect(popup.locator("#fromCurrencyDisc")).toHaveText("$");
  await expect(popup.locator("#toCurrencyDisc")).toHaveText("€");

  await popup.getByText("Page options", { exact: true }).click();
  await expect(popup.locator("#pageOptions")).toHaveAttribute("open", "");
  await expect(popup.getByText("Enable converter", { exact: true })).toBeVisible();
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

  const initialConversion = shop.locator("#initial ccp-conversion");
  await initialConversion.evaluate((element) => {
    element.dataset.preservationCheck = "same-conversion";
  });
  await extensionWorker.evaluate(() => chrome.storage.sync.set({ showPagePrompt: true }));
  await runPageCommand(extensionWorker, "SHOW_CONVERT_PROMPT");
  await expect(initialConversion).toHaveAttribute("data-preservation-check", "same-conversion");
  await expect(shop.locator(".ccp-page-prompt")).toHaveCount(0);

  await extensionWorker.evaluate(() => chrome.storage.sync.set({ displayMode: "replace" }));
  await expect(initialConversion).toHaveAttribute("data-display-mode", "replace");
  await expect(initialConversion).toHaveAttribute("data-preservation-check", "same-conversion");
  await expect(initialConversion.locator(".ccp-original")).toBeHidden();
  await extensionWorker.evaluate(() => chrome.storage.sync.set({ displayMode: "beside" }));
  await expect(initialConversion).toHaveAttribute("data-display-mode", "beside");
  await expect(initialConversion.locator(".ccp-original")).toBeVisible();

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
