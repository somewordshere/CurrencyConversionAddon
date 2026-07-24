// This networked compatibility sweep is intentionally separate from Node's offline test discovery.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "dist", "chrome");
const matrixPath = path.join(root, "tests", "live-sites.json");
const outputDirectory = path.join(root, "artifacts", "live-sites");
const resultsPath = path.join(outputDirectory, "results.json");
const reportPath = path.join(outputDirectory, "report.md");
const screenshotsDirectory = path.join(outputDirectory, "screenshots");
const navigationTimeoutMs = Number(process.env.CCP_LIVE_NAVIGATION_TIMEOUT_MS || 30_000);
const settleTimeMs = Number(process.env.CCP_LIVE_SETTLE_MS || 4_000);
const conversionTimeoutMs = Number(process.env.CCP_LIVE_CONVERSION_TIMEOUT_MS || 15_000);
const args = new Set(process.argv.slice(2));

const currencyNames = {
  AUD: "Australian Dollar", BRL: "Brazilian Real", CAD: "Canadian Dollar",
  CHF: "Swiss Franc", CNY: "Chinese Yuan", EUR: "Euro", GBP: "British Pound",
  HKD: "Hong Kong Dollar", INR: "Indian Rupee", JPY: "Japanese Yen",
  KRW: "South Korean Won", MXN: "Mexican Peso", NOK: "Norwegian Krone",
  NZD: "New Zealand Dollar", PLN: "Polish Zloty", SEK: "Swedish Krona",
  SGD: "Singapore Dollar", TWD: "New Taiwan Dollar", USD: "US Dollar",
  ZAR: "South African Rand"
};

const currencySymbols = {
  AUD: "A$", BRL: "R$", CAD: "C$", CHF: "CHF", CNY: "¥", EUR: "€",
  GBP: "£", HKD: "HK$", INR: "₹", JPY: "¥", KRW: "₩", MXN: "MX$",
  NOK: "kr", NZD: "NZ$", PLN: "zł", SEK: "kr", SGD: "S$", TWD: "NT$",
  USD: "$", ZAR: "R"
};

const markerPatterns = {
  AUD: /(?:A\$|AUD)\s*\d|\d[\d.,\s]*\s*AUD/gi,
  BRL: /(?:R\$|BRL)\s*\d|\d[\d.,\s]*\s*BRL/gi,
  CAD: /(?:C\$|CAD)\s*\d|\d[\d.,\s]*\s*CAD/gi,
  CHF: /CHF\s*\d|\d[\d.,'’\s]*\s*CHF/gi,
  CNY: /(?:CNY|RMB|CN¥|￥|¥)\s*\d|\d[\d.,\s]*\s*(?:CNY|RMB|元)/gi,
  EUR: /(?:€|EUR)\s*\d|\d[\d.,\s]*\s*(?:€|EUR)/gi,
  GBP: /(?:£|GBP)\s*\d|\d[\d.,\s]*\s*(?:£|GBP)/gi,
  HKD: /(?:HK\$|HKD)\s*\d|\d[\d.,\s]*\s*HKD/gi,
  INR: /(?:₹|INR|Rs\.?)\s*\d|\d[\d.,\s]*\s*(?:INR|₹)/gi,
  JPY: /(?:JPY|￥|¥)\s*\d|\d[\d.,\s]*\s*(?:JPY|円)/gi,
  KRW: /(?:KRW|₩)\s*\d|\d[\d.,\s]*\s*(?:KRW|원)/gi,
  MXN: /(?:MX\$|MXN)\s*\d|\d[\d.,\s]*\s*MXN/gi,
  NOK: /NOK\s*\d|\d[\d.,\s]*\s*(?:NOK|kr)/gi,
  NZD: /(?:NZ\$|NZD)\s*\d|\d[\d.,\s]*\s*NZD/gi,
  PLN: /PLN\s*\d|\d[\d.,\s]*\s*(?:PLN|zł)/gi,
  SEK: /SEK\s*\d|\d[\d.,\s]*\s*(?:SEK|kr)/gi,
  SGD: /(?:S\$|SGD)\s*\d|\d[\d.,\s]*\s*SGD/gi,
  TWD: /(?:NT\$|TWD)\s*\d|\d[\d.,\s]*\s*TWD/gi,
  USD: /(?:US\$|USD|\$)\s*\d|\d[\d.,\s]*\s*USD/gi,
  ZAR: /ZAR\s*\d|R\s*\d|\d[\d.,\s]*\s*ZAR/gi
};

async function main() {
  assertInputs();
  fs.mkdirSync(screenshotsDirectory, { recursive: true });

  const allSites = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  const selectedSites = selectSites(allSites);
  const savedPayload = args.has("--resume") && fs.existsSync(resultsPath)
    ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : [];
  const existingResults = Array.isArray(savedPayload)
    ? savedPayload
    : Array.isArray(savedPayload.results)
      ? savedPayload.results
      : [];
  const completedKeys = new Set(existingResults.map(siteKey));
  const results = [...existingResults];
  const rerun = args.has("--rerun");

  console.log(`Currency Converter Pro live-site run: ${selectedSites.length} selected, ${completedKeys.size} already completed.`);
  const context = await chromium.launchPersistentContext(path.join(outputDirectory, "profile"), {
    channel: "chromium",
    headless: !args.has("--headed"),
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--no-default-browser-check"
    ]
  });
  context.setDefaultTimeout(10_000);
  await context.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (["font", "media"].includes(resourceType)) await route.abort();
    else await route.continue();
  });

  try {
    const worker = await getExtensionWorker(context);
    await seedExtension(worker, allSites);

    let position = 0;
    for (const site of selectedSites) {
      position += 1;
      if (completedKeys.has(siteKey(site)) && !rerun) {
        console.log(`[${position}/${selectedSites.length}] SKIP ${site.currency} ${site.name}`);
        continue;
      }

      console.log(`[${position}/${selectedSites.length}] TEST ${site.currency} ${site.name} ${site.url}`);
      const result = await testSite(context, worker, site).catch((error) => ({
        ...site,
        testedAt: new Date().toISOString(),
        classification: "runner_error",
        error: error instanceof Error ? error.message : String(error)
      }));
      const previousIndex = results.findIndex((candidate) => siteKey(candidate) === siteKey(site));
      if (previousIndex >= 0) results.splice(previousIndex, 1, result);
      else results.push(result);
      completedKeys.add(siteKey(site));
      saveResults(results, allSites.length);
      console.log(`[${position}/${selectedSites.length}] ${result.classification.toUpperCase()} ${site.name}${formatOutcome(result)}`);
    }
  } finally {
    await context.close();
  }

  saveResults(results, allSites.length);
  printSummary(results);
}

function assertInputs() {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("The Chrome build is missing. Run npm run prepare:chrome first.");
  }
  if (!fs.existsSync(matrixPath)) throw new Error(`Missing live-site matrix: ${matrixPath}`);
}

function selectSites(sites) {
  const currency = argumentValue("--currency")?.toUpperCase();
  const name = argumentValue("--name")?.toLowerCase();
  const start = Math.max(0, Number(argumentValue("--start") || 0));
  const limitValue = argumentValue("--limit");
  const limit = limitValue ? Math.max(1, Number(limitValue)) : sites.length;
  const filtered = sites.filter((site) =>
    (!currency || site.currency === currency) &&
    (!name || site.name.toLowerCase().includes(name))
  );
  return filtered.slice(start, start + limit);
}

function argumentValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function getExtensionWorker(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  return worker;
}

async function seedExtension(worker, sites) {
  const sourceCodes = [...new Set(sites.map((site) => site.currency))];
  const codes = [...new Set([...sourceCodes, "EUR", "USD"])].sort();
  const now = new Date().toISOString();
  const signature = codes.join(",");
  const currencies = codes.map((code) => ({
    code,
    name: currencyNames[code] || code,
    symbol: currencySymbols[code] || null,
    startDate: "1999-01-01",
    endDate: null
  }));
  const bases = Object.fromEntries(codes.map((base) => [base, {
    fetchedAt: now,
    rateDate: now.slice(0, 10),
    catalogSignature: signature,
    rates: Object.fromEntries(codes.map((quote) => [quote, quote === base ? 1 : 1.1234]))
  }]));

  await worker.evaluate(async ({ currencies, bases, now }) => {
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
      showPagePrompt: true
    });
    await chrome.storage.local.set({
      autoConvertSites: {},
      siteSourceCurrencies: {},
      providerCurrencyCatalog: { version: 1, fetchedAt: now, currencies },
      ratesCache: { version: 3, bases }
    });
  }, { currencies, bases, now });
}

async function updateConversionSettings(worker, fromCurrency, toCurrency, siteUrl) {
  await worker.evaluate(async ({ fromCurrency, toCurrency, siteUrl }) => {
    const origin = new URL(siteUrl).origin;
    const stored = await chrome.storage.local.get("siteSourceCurrencies");
    const siteSourceCurrencies = { ...(stored.siteSourceCurrencies || {}) };
    if (fromCurrency === "AUTO") delete siteSourceCurrencies[origin];
    else siteSourceCurrencies[origin] = fromCurrency;
    await chrome.storage.sync.set({
      enabled: true,
      fromCurrency: "AUTO",
      toCurrency,
      displayMode: "beside",
      showPagePrompt: true
    });
    await chrome.storage.local.set({ siteSourceCurrencies });
  }, { fromCurrency, toCurrency, siteUrl });
}

async function testSite(context, worker, site) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  page.on("pageerror", (error) => pageErrors.push(conciseError(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  const targetCurrency = site.currency === "EUR" ? "USD" : "EUR";
  const result = {
    ...site,
    targetCurrency,
    testedAt: new Date().toISOString(),
    navigation: null,
    promptInjected: false,
    auto: null,
    manual: null
  };

  try {
    await updateConversionSettings(worker, "AUTO", targetCurrency, site.url);
    let response;
    try {
      response = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      result.navigation = {
        ok: true,
        status: response?.status() || null,
        finalUrl: page.url()
      };
    } catch (error) {
      result.navigation = {
        ok: false,
        status: null,
        finalUrl: page.url(),
        error: conciseError(error)
      };
    }

    await page.waitForTimeout(settleTimeMs);
    result.title = await page.title().catch(() => "");
    const pageSignals = await collectPageSignals(page, site.currency);
    Object.assign(result, pageSignals);
    result.blocker = detectBlocker(result);
    result.promptInjected = await page.locator(".ccp-page-prompt").count() > 0;
    if (!result.promptInjected && result.navigation?.ok) {
      result.contentScriptHealth = await pingContentScript(worker, page.url());
    }

    if (result.promptInjected && !result.blocker) {
      result.auto = await convertWithPageControl(page);
      if (!result.auto.ok || !conversionIncludesCurrency(result.auto, site.currency)) {
        await updateConversionSettings(worker, site.currency, targetCurrency, site.url);
        await page.waitForTimeout(1_000);
        result.manual = await convertWithPageControl(page);
      }
    }

    result.classification = classifyResult(result);
    result.pageErrors = [...new Set(pageErrors)].slice(0, 10);
    result.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
    if (!result.classification.startsWith("pass_")) {
      result.screenshot = await captureFailureScreenshot(page, site);
    }
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

async function collectPageSignals(page, currency) {
  const raw = await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const visibleAnchors = [...document.querySelectorAll("a[href]")]
      .filter((anchor) => anchor.getClientRects().length)
      .slice(0, 2000);
    return {
      bodyText: text.slice(0, 250_000),
      bodyPreview: text.slice(0, 1_000),
      visibleTextLength: text.length,
      visibleLinkCount: visibleAnchors.length,
      htmlLanguage: document.documentElement.lang || ""
    };
  }).catch(() => ({
    bodyText: "", bodyPreview: "", visibleTextLength: 0, visibleLinkCount: 0, htmlLanguage: ""
  }));
  const pattern = markerPatterns[currency];
  const markerMatches = pattern ? raw.bodyText.match(pattern) || [] : [];
  return {
    bodyPreview: raw.bodyPreview,
    visibleTextLength: raw.visibleTextLength,
    visibleLinkCount: raw.visibleLinkCount,
    htmlLanguage: raw.htmlLanguage,
    currencyMarkerCount: Math.min(markerMatches.length, 999),
    currencyMarkerSamples: [...new Set(markerMatches.slice(0, 5).map((value) => value.trim()))]
  };
}

async function convertWithPageControl(page) {
  const prompt = page.locator(".ccp-page-prompt");
  if (await prompt.count() === 0) {
    return { ok: false, count: 0, error: "The one-click page control is missing." };
  }
  const action = prompt.locator(".ccp-page-prompt-action");
  try {
    await action.click({ timeout: 10_000 });
  } catch (error) {
    return { ok: false, count: 0, error: `The page control could not be clicked: ${conciseError(error)}` };
  }

  const deadline = Date.now() + conversionTimeoutMs;
  let lastMessage = "";
  while (Date.now() < deadline) {
    const count = await page.locator("ccp-conversion[data-ccp-owned='true']").count().catch(() => 0);
    if (count > 0) {
      const conversions = await page.locator("ccp-conversion[data-ccp-owned='true']").evaluateAll(
        (elements) => elements.slice(0, 20).map((element) => ({
          text: element.textContent?.trim() || "",
          sourceCurrency: element.dataset.sourceCurrency ||
            element.querySelector(".ccp-badge")?.getAttribute("title")?.match(/Converted from ([A-Z]{3}) to/)?.[1] ||
            null
        }))
      ).catch(() => []);
      return {
        ok: true,
        count,
        samples: conversions.slice(0, 5).map((conversion) => conversion.text),
        sourceCurrencies: [...new Set(conversions.map((conversion) => conversion.sourceCurrency).filter(Boolean))]
      };
    }
    const state = await prompt.getAttribute("data-state").catch(() => null);
    lastMessage = await prompt.locator(".ccp-page-prompt-message").textContent().catch(() => lastMessage) || lastMessage;
    if (state === "error") return { ok: false, count: 0, error: lastMessage || "Conversion failed." };
    await page.waitForTimeout(250);
  }
  return { ok: false, count: 0, error: lastMessage || "Conversion timed out." };
}

function detectBlocker(result) {
  const status = result.navigation?.status;
  if ([401, 403, 407, 429, 451, 503].includes(status)) return `HTTP ${status}`;
  const haystack = `${result.title || ""} ${result.bodyPreview || ""}`.toLowerCase();
  const blockers = [
    ["access denied", "Access denied"],
    ["verify you are human", "Human-verification challenge"],
    ["are you a human", "Human-verification challenge"],
    ["captcha", "CAPTCHA challenge"],
    ["robot check", "Robot check"],
    ["unusual traffic", "Traffic challenge"],
    ["temporarily unavailable", "Temporarily unavailable"],
    ["not available in your region", "Regional restriction"],
    ["not available in your country", "Regional restriction"],
    ["enable javascript", "JavaScript gate"]
  ];
  return blockers.find(([needle]) => haystack.includes(needle))?.[1] || null;
}

function classifyResult(result) {
  if (!result.navigation?.ok && (
    result.navigation?.finalUrl === "about:blank" || result.visibleTextLength < 500
  )) return "navigation_failed";
  if (result.blocker) return "site_blocked";
  if (!result.promptInjected) return "prompt_missing";
  if (result.auto?.error?.includes("page control could not be clicked")) return "interaction_blocked";
  if (conversionIncludesCurrency(result.auto, result.currency)) return "pass_auto";
  if (conversionIncludesCurrency(result.manual, result.currency)) return "pass_manual";
  if (result.currencyMarkerCount === 0 || noConverterRecognizedPrice(result.manual)) {
    return "no_prices_on_landing";
  }
  return "conversion_failed";
}

async function pingContentScript(worker, url) {
  return worker.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === targetUrl);
    if (!tab?.id) return { ok: false, error: "The loaded tab was not found." };
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "CONTENT_READY" });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, url).catch((error) => ({ ok: false, error: conciseError(error) }));
}

function conversionIncludesCurrency(attempt, currency) {
  return Boolean(attempt?.ok && attempt.sourceCurrencies?.includes(currency));
}

function noConverterRecognizedPrice(attempt) {
  return Boolean(attempt?.error?.startsWith("Could not find the manually selected currency"));
}

async function captureFailureScreenshot(page, site) {
  const filename = `${String(site.currency).toLowerCase()}-${slug(site.name)}.png`;
  const target = path.join(screenshotsDirectory, filename);
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 10_000 });
    return path.relative(root, target).replaceAll("\\", "/");
  } catch (_error) {
    return null;
  }
}

function saveResults(results, totalSites) {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalSites,
    testedSites: results.length,
    results
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(reportPath, buildMarkdownReport(payload));
}

function buildMarkdownReport(payload) {
  const counts = countClassifications(payload.results);
  const lines = [
    "# Currency Converter Pro live-site report",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `Tested **${payload.testedSites}/${payload.totalSites}** sites sequentially with the real unpacked Chrome extension.`,
    "",
    "## Summary",
    "",
    "| Result | Sites |",
    "| --- | ---: |",
    ...Object.entries(counts).sort().map(([key, count]) => `| ${key} | ${count} |`),
    "",
    "## Results",
    "",
    "| Currency | Site | Result | Prompt | AUTO | Manual retry | Markers | Details |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |"
  ];

  for (const result of payload.results) {
    const sources = [
      result.auto?.sourceCurrencies?.length ? `AUTO: ${result.auto.sourceCurrencies.join(", ")}` : "",
      result.manual?.sourceCurrencies?.length ? `manual: ${result.manual.sourceCurrencies.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    const details = result.blocker || result.manual?.error || result.auto?.error || result.navigation?.error || sources;
    lines.push(
      `| ${result.currency} | [${escapeMarkdown(result.name)}](${result.url}) | ${result.classification} | ` +
      `${result.promptInjected ? "yes" : "no"} | ${result.auto?.count || 0} | ${result.manual?.count || 0} | ` +
      `${result.currencyMarkerCount || 0} | ${escapeMarkdown(details)} |`
    );
  }
  lines.push("", "## Classification guide", "",
    "- `pass_auto`: the default AUTO mode converted at least one visible price.",
    "- `pass_manual`: AUTO failed, but selecting the expected source currency converted at least one price.",
    "- `no_prices_on_landing`: the control loaded, but the landing page exposed no recognizable currency-marked prices.",
    "- `conversion_failed`: recognizable prices were present but neither AUTO nor the explicit source converted them.",
    "- `interaction_blocked`: the extension control loaded, but a site overlay prevented the automated click.",
    "- `prompt_missing`: the website loaded but the declarative page control was not injected.",
    "- `site_blocked`: the site returned an access, bot, CAPTCHA, regional, or JavaScript gate.",
    "- `navigation_failed` / `runner_error`: navigation or the test runner failed before behavior could be verified.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function countClassifications(results) {
  return results.reduce((counts, result) => {
    counts[result.classification] = (counts[result.classification] || 0) + 1;
    return counts;
  }, {});
}

function siteKey(site) {
  return `${site.currency}|${site.name}|${site.url}`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function conciseError(error) {
  return String(error?.message || error).split("\n")[0].slice(0, 500);
}

function escapeMarkdown(value) {
  return String(value || "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatOutcome(result) {
  const count = result.auto?.count || result.manual?.count || 0;
  const detail = result.blocker || result.manual?.error || result.auto?.error || result.navigation?.error;
  if (count) return ` (${count} conversions)`;
  return detail ? ` (${detail})` : "";
}

function printSummary(results) {
  console.log("Live-site summary:");
  for (const [classification, count] of Object.entries(countClassifications(results)).sort()) {
    console.log(`  ${classification}: ${count}`);
  }
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
