const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  Browser,
  Builder,
  By,
  until
} = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");

const ROOT = path.resolve(__dirname, "../..");
const FIREFOX_DIST = path.join(ROOT, "dist", "firefox");
const ADDON_ID = "currency-converter-pro@somewordshere";
const ADDON_NAME = "Currency Converter Pro";
const SHOP_HTML = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "shop.html"), "utf8");
const FIREFOX_TIMEOUT_MS = 30_000;

test("Firefox page access and popup handlers convert and undo a real webpage", { timeout: 120_000 }, async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-firefox-runtime-"));
  let fixture;
  let driver;
  let installedAddonId;

  try {
    const archivePath = buildTemporaryArchive(temporaryDirectory);
    fixture = await startFixtureServer();
    driver = await createFirefoxDriver();
    await driver.manage().setTimeouts({
      pageLoad: FIREFOX_TIMEOUT_MS,
      script: FIREFOX_TIMEOUT_MS
    });

    installedAddonId = await driver.installAddon(archivePath, true);
    assert.equal(installedAddonId, ADDON_ID);

    const extensionOrigin = await getExtensionOrigin(driver, ADDON_ID);
    await seedExtensionState(driver, extensionOrigin, fixture.url);

    await driver.get(fixture.url);
    await driver.wait(until.elementLocated(By.id("initial")), FIREFOX_TIMEOUT_MS);
    assert.equal(await driver.findElement(By.id("initial")).getText(), "Price: $100.00");
    const shopWindow = await driver.getWindowHandle();
    const popupUrl = `${extensionOrigin}/popup/popup.html`;

    // Firefox's XUL action popup is not exposed as a WebDriver BiDi context, so drive
    // the same popup document in a background tab while the shopping page stays active.
    await driver.switchTo().newWindow("tab");
    await driver.get(popupUrl);
    const popupScript = await driver.getBidi();
    const popupContext = await driver.wait(
      () => findBidiContextByUrl(popupScript, popupUrl),
      FIREFOX_TIMEOUT_MS
    );
    await driver.switchTo().window(shopWindow);
    await navigateBidiContext(popupScript, popupContext.context, popupUrl);

    await waitForPopup(
      popupScript,
      popupContext.context,
      "document.querySelector('#fromCurrency').options.length >= 2 && " +
        "document.querySelector('#siteState').title.includes('provider currencies') && " +
        "!document.querySelector('#convertSite').disabled"
    );
    const rememberSiteHelp = await evaluatePopup(
      popupScript,
      popupContext.context,
      "document.querySelector('#rememberSiteHelp').textContent"
    );
    assert.match(rememberSiteHelp, /Automatically converts this website/);
    await evaluatePopup(
      popupScript,
      popupContext.context,
      "document.querySelector('#convertSite').click(); true"
    );

    try {
      await driver.wait(async () => (
        await driver.findElements(By.css("ccp-conversion[data-ccp-owned='true']"))
      ).length === 1, FIREFOX_TIMEOUT_MS);
    } catch (error) {
      const popupDiagnostic = await evaluatePopup(
        popupScript,
        popupContext.context,
        "browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => " +
          "JSON.stringify({ " +
            "status: document.querySelector('#status').textContent, " +
            "statusKind: document.querySelector('#status').dataset.kind, " +
            "activeTab: tabs.map(({ id, url, active }) => ({ id, url, active })) " +
          "}))"
      ).catch(() => "Popup diagnostics unavailable");
      throw new Error(`Firefox popup conversion did not complete. ${popupDiagnostic}`, {
        cause: error
      });
    }

    assert.match(await driver.findElement(By.id("initial")).getText(), /90[.,]00/);
    await waitForPopup(
      popupScript,
      popupContext.context,
      "document.querySelector('#clearPage') && !document.querySelector('#clearPage').disabled"
    );
    await evaluatePopup(
      popupScript,
      popupContext.context,
      "document.querySelector('#clearPage').click(); true"
    );

    await driver.wait(async () => (
      await driver.findElements(By.css("ccp-conversion[data-ccp-owned='true']"))
    ).length === 0, FIREFOX_TIMEOUT_MS);
    assert.equal(await driver.findElement(By.id("initial")).getText(), "Price: $100.00");
  } finally {
    if (driver) {
      if (installedAddonId) {
        await driver.uninstallAddon(installedAddonId).catch(() => {});
      }
      await driver.quit().catch(() => {});
    }
    if (fixture) await fixture.close();
    removeTemporaryDirectory(temporaryDirectory);
  }
});

function buildTemporaryArchive(temporaryDirectory) {
  const filename = "currency-converter-pro-firefox-runtime.zip";
  const webExtCli = path.join(ROOT, "node_modules", "web-ext", "bin", "web-ext.js");
  const result = spawnSync(process.execPath, [
    webExtCli,
    "build",
    "--source-dir", FIREFOX_DIST,
    "--artifacts-dir", temporaryDirectory,
    "--filename", filename,
    "--overwrite-dest"
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" }
  });

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n") || "Could not package the Firefox test add-on."
  );
  const archivePath = path.join(temporaryDirectory, filename);
  assert.ok(fs.existsSync(archivePath), "Firefox test archive was not created.");
  return archivePath;
}

async function startFixtureServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/test-shop") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(SHOP_HTML);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://127.0.0.1:${address.port}/test-shop`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function createFirefoxDriver() {
  const options = new firefox.Options();
  options.enableBidi();
  options.windowSize({ width: 1280, height: 900 });
  if (process.env.FIREFOX_HEADLESS !== "0") options.addArguments("-headless");

  const binary = resolveFirefoxBinary();
  if (binary) options.setBinary(binary);

  const service = new firefox.ServiceBuilder().addArguments("--allow-system-access");
  return new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
}

function resolveFirefoxBinary() {
  if (process.env.FIREFOX_BIN) return path.resolve(process.env.FIREFOX_BIN);
  if (process.platform !== "win32") return null;
  const defaultPath = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

async function getExtensionOrigin(driver, addonId) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const hostname = await driver.wait(async () => driver.executeScript(`
      const addonId = arguments[0];
      if (typeof WebExtensionPolicy !== "undefined") {
        const policy = WebExtensionPolicy.getByID(addonId);
        if (policy?.mozExtensionHostname) return policy.mozExtensionHostname;
      }
      const services = globalThis.Services ??
        ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
      const mapping = JSON.parse(
        services.prefs.getStringPref("extensions.webextensions.uuids", "{}")
      );
      return mapping[addonId] || null;
    `, addonId), FIREFOX_TIMEOUT_MS);
    return `moz-extension://${hostname}`;
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

async function seedExtensionState(driver, extensionOrigin, fixtureUrl) {
  await driver.get(`${extensionOrigin}/popup/popup.html`);
  await driver.wait(until.elementLocated(By.id("convertSite")), FIREFOX_TIMEOUT_MS);
  const now = new Date().toISOString();
  const error = await driver.executeAsyncScript(`
    const state = arguments[0];
    const done = arguments[arguments.length - 1];
    (async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const stored = await browser.storage.sync.get("enabled");
        if (typeof stored.enabled === "boolean") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await browser.storage.sync.set(state.sync);
      await browser.storage.local.set(state.local);
    })().then(() => done(null), (failure) => done(String(failure?.message || failure)));
  `, {
    sync: {
      enabled: true,
      fromCurrency: "AUTO",
      toCurrency: "EUR",
      displayMode: "beside",
      showPagePrompt: false
    },
    local: {
      siteSourceCurrencies: {
        [new URL(fixtureUrl).origin]: "USD"
      },
      providerCurrencyCatalog: {
        version: 1,
        fetchedAt: now,
        currencies: [
          { code: "EUR", name: "Euro", symbol: "€", startDate: "1999-01-04", endDate: null },
          { code: "USD", name: "United States Dollar", symbol: "$", startDate: "1999-01-04", endDate: null }
        ]
      },
      ratesCache: {
        version: 3,
        bases: {
          USD: {
            fetchedAt: now,
            rateDate: now.slice(0, 10),
            catalogSignature: "EUR,USD",
            rates: { EUR: 0.9, USD: 1 }
          }
        }
      }
    }
  });
  assert.equal(error, null, `Could not seed Firefox extension state: ${error}`);
}

async function grantActiveTabFromAction(driver, addonId, addonName) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    let actionButton = await findActionButton(driver, addonId, addonName);
    if (!actionButton) {
      await driver.findElement(By.id("unified-extensions-button")).click();
      actionButton = await driver.wait(
        () => findActionButton(driver, addonId, addonName),
        FIREFOX_TIMEOUT_MS
      );
    }

    await actionButton.click();
    await driver.wait(async () => driver.executeScript(`
      const popupBrowser = [...document.querySelectorAll("browser.webextension-popup-browser")]
        .find((candidate) => candidate.currentURI?.spec?.includes("/popup/popup.html"));
      if (!popupBrowser) return false;
      popupBrowser.closest("panel")?.hidePopup();
      return true;
    `), FIREFOX_TIMEOUT_MS);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

async function findActionButton(driver, addonId, addonName) {
  return driver.executeScript(`
    const addonId = arguments[0];
    const addonName = arguments[1];
    const visible = (node) => Boolean(node && !node.hidden && node.getClientRects().length);
    const direct = [...document.querySelectorAll(".webextension-browser-action[data-extensionid]")]
      .find((node) => node.getAttribute("data-extensionid") === addonId && visible(node));
    if (direct) return direct;

    const item = [...document.querySelectorAll("unified-extensions-item")].find((node) => {
      const name = node.querySelector(".unified-extensions-item-name");
      return node.getAttribute("extension-id") === addonId ||
        node.addon?.id === addonId ||
        node.extension?.id === addonId ||
        name?.value === addonName ||
        name?.textContent?.trim() === addonName;
    });
    const itemAction = item?.querySelector(".unified-extensions-item-action-button");
    return visible(itemAction) ? itemAction : null;
  `, addonId, addonName);
}

async function findBidiContextByUrl(bidi, url) {
  const response = await bidi.send({
    method: "browsingContext.getTree",
    params: {}
  });
  assertBidiSuccess(response, "Could not read Firefox browsing contexts");

  const contexts = [];
  const visit = (context) => {
    contexts.push(context);
    for (const child of context.children || []) visit(child);
  };
  for (const context of response.result?.contexts || []) visit(context);
  return contexts.find((context) => context.parent === null && context.url === url) || null;
}

async function navigateBidiContext(bidi, contextId, url) {
  const response = await bidi.send({
    method: "browsingContext.navigate",
    params: {
      context: contextId,
      url,
      wait: "complete"
    }
  });
  assertBidiSuccess(response, "Could not reload the Firefox popup in the background");
}

async function waitForPopup(bidi, contextId, expression) {
  const deadline = Date.now() + FIREFOX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (await evaluatePopup(bidi, contextId, `Boolean(${expression})`)) return;
    } catch (error) {
      if (!/no such frame|no such window|realm/i.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the Firefox popup: ${expression}`);
}

async function evaluatePopup(bidi, contextId, expression) {
  const response = await bidi.send({
    method: "script.evaluate",
    params: {
      expression,
      awaitPromise: true,
      target: { context: contextId }
    }
  });
  assertBidiSuccess(response, "Firefox popup script failed");
  const result = response.result;
  if (result?.type !== "success") {
    throw new Error(result?.exceptionDetails?.text || "Firefox popup script failed.");
  }
  return result.result?.value;
}

function assertBidiSuccess(response, fallbackMessage) {
  if (response.type === "error" || response.error) {
    throw new Error(`${response.error || fallbackMessage}: ${response.message || "Unknown BiDi error"}`);
  }
}

function removeTemporaryDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  assert.ok(
    resolvedDirectory.startsWith(resolvedTemp),
    `Refusing to remove a non-temporary directory: ${resolvedDirectory}`
  );
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}
