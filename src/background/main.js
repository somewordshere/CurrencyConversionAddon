const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  fromCurrency: "AUTO",
  toCurrency: "EUR",
  displayMode: "beside",
  showPagePrompt: true
});
const SITE_PREFERENCES_KEY = "autoConvertSites";
const M = CurrencyMessages;
const REGISTERED_CONTENT_SCRIPT_FILES = [
  "shared/browser-api.js",
  "shared/currencies.js",
  "shared/messages.js",
  "content/number-parser.js",
  "content/detector.js",
  "content/converter.js",
  "content/page-ui.js",
  "content/content.js"
];
const REGISTERED_CONTENT_STYLE_FILES = ["content/styles.css"];
const INJECTED_CONTENT_SCRIPT_FILES = REGISTERED_CONTENT_SCRIPT_FILES.map((file) => `/${file}`);
const INJECTED_CONTENT_STYLE_FILES = REGISTERED_CONTENT_STYLE_FILES.map((file) => `/${file}`);

ExtensionAPI.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await ExtensionAPI.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    const catalog = await CurrencyCatalogService.getCurrencies();
    const supportedCodes = catalog.currencies.map((currency) => currency.code);
    await ExtensionAPI.storage.sync.set({
      ...DEFAULT_SETTINGS,
      ...sanitizeSettings(stored, supportedCodes)
    });
    await ExtensionAPI.storage.local.remove("favoriteCurrencies");

    await ExtensionAPI.contextMenus.removeAll();
    ExtensionAPI.contextMenus.create({
      id: "convert-selection",
      title: "Convert selected currency",
      contexts: ["selection"]
    });
    await reconcileRememberedSites();
  } catch (error) {
    console.error("Currency Converter Pro initialization failed.", error);
  }
});

ExtensionAPI.runtime.onStartup.addListener(() => {
  reconcileRememberedSites().catch((error) => {
    console.error("Could not restore remembered-site registrations.", error);
  });
});

ExtensionAPI.permissions.onRemoved.addListener(() => {
  reconcileRememberedSites().catch(() => {});
});

ExtensionAPI.contextMenus.onClicked.addListener(async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== "convert-selection" || !isSupportedTab(tab)) return;

  try {
    await ensureContentScripts(tab.id);
    await ExtensionAPI.tabs.sendMessage(tab.id, { type: M.CONVERT_SELECTION });
  } catch (error) {
    console.info(
      "Currency Converter Pro could not access this page. Reload the page and try again.",
      error
    );
  }
});

ExtensionAPI.commands.onCommand.addListener(async (command) => {
  if (command !== "convert-page") return;
  const [tab] = await ExtensionAPI.tabs.query({ active: true, currentWindow: true });
  if (!isSupportedTab(tab)) return;
  try {
    await ensureContentScripts(tab.id);
    await ExtensionAPI.tabs.sendMessage(tab.id, { type: M.RUN_SITE_CONVERSION });
  } catch (error) {
    console.info("Could not run the keyboard conversion command.", error);
  }
});

ExtensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "The request could not be completed."
    }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case M.GET_SETTINGS:
      return getSettings();
    case M.UPDATE_SETTINGS:
      return updateSettings(message.payload);
    case M.GET_RATES:
      return CurrencyRateService.getRates(message.baseCurrency);
    case M.GET_CURRENCIES:
      return getAvailableCurrencies();
    case M.GET_SITE_STATUS:
      return getSiteStatus(message.origin || sender?.url);
    case M.REMEMBER_SITE:
      return rememberSite(message.origin || sender?.url);
    case M.FORGET_SITE:
      return forgetSite(message.origin || sender?.url);
    case M.SET_BADGE:
      return setBadge(sender?.tab?.id, message.count);
    default:
      return { ok: false, error: "Unknown extension request." };
  }
}

async function getSettings() {
  const catalog = await CurrencyCatalogService.getCurrencies();
  const supportedCodes = catalog.currencies.map((currency) => currency.code);
  const stored = await ExtensionAPI.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return { ok: true, settings: { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored, supportedCodes) } };
}

async function getAvailableCurrencies() {
  const catalog = await CurrencyCatalogService.getCurrencies();
  return {
    ok: true,
    currencies: catalog.currencies.map((currency) => currency.code),
    details: catalog.currencies,
    cached: catalog.cached,
    stale: catalog.stale,
    warning: catalog.warning
  };
}

async function updateSettings(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid settings." };
  }

  const currentResult = await getSettings();
  const currentSettings = currentResult.settings;
  const catalog = await CurrencyCatalogService.getCurrencies();
  const supportedCodes = catalog.currencies.map((currency) => currency.code);
  const settings = sanitizeSettings({ ...currentSettings, ...payload }, supportedCodes);

  if (settings.fromCurrency === settings.toCurrency) {
    return { ok: false, error: "Choose two different currencies." };
  }

  const pairChanged = settings.fromCurrency !== currentSettings.fromCurrency ||
    settings.toCurrency !== currentSettings.toCurrency;
  if (pairChanged && settings.fromCurrency !== "AUTO") {
    const rates = await CurrencyRateService.getRates(settings.fromCurrency);
    if (!rates?.ok) {
      return {
        ok: false,
        settings: currentSettings,
        error: rates?.error || "Could not verify this currency pair."
      };
    }
    if (!Number.isFinite(rates.rates?.[settings.toCurrency])) {
      return {
        ok: false,
        settings: currentSettings,
        error: `No ${settings.fromCurrency} to ${settings.toCurrency} rate is currently available.`
      };
    }
  }

  await ExtensionAPI.storage.sync.set(settings);
  return { ok: true, settings };
}

function sanitizeSettings(value, supportedCodes = CurrencyCatalog.CURRENCY_CODES) {
  const fromOptions = new Set(["AUTO", ...supportedCodes]);
  return {
    enabled: typeof value?.enabled === "boolean"
      ? value.enabled
      : DEFAULT_SETTINGS.enabled,
    fromCurrency: fromOptions.has(value?.fromCurrency)
      ? value.fromCurrency
      : DEFAULT_SETTINGS.fromCurrency,
    toCurrency: supportedCodes.includes(value?.toCurrency)
      ? value.toCurrency
      : DEFAULT_SETTINGS.toCurrency,
    displayMode: ["beside", "replace"].includes(value?.displayMode)
      ? value.displayMode
      : DEFAULT_SETTINGS.displayMode,
    showPagePrompt: typeof value?.showPagePrompt === "boolean"
      ? value.showPagePrompt
      : DEFAULT_SETTINGS.showPagePrompt
  };
}

async function setBadge(tabId, count) {
  if (!tabId) return { ok: false };
  const text = Number.isInteger(count) && count > 0 ? String(Math.min(count, 999)) : "";
  await ExtensionAPI.action.setBadgeBackgroundColor({ tabId, color: "#047857" });
  await ExtensionAPI.action.setBadgeText({ tabId, text });
  return { ok: true };
}

async function getSiteStatus(originValue) {
  const unsupportedPage = CurrencyPageAccess.unsupportedPageMessage(originValue);
  if (unsupportedPage) {
    return { ok: false, remembered: false, error: unsupportedPage };
  }
  const site = normalizeSite(originValue);
  if (!site) return { ok: false, remembered: false, error: siteMemoryError(originValue) };

  const preferences = await getSitePreferences();
  const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
  return {
    ok: true,
    origin: site.origin,
    pattern: site.pattern,
    remembered: preferences[site.origin] === true && hasPermission
  };
}

async function rememberSite(originValue) {
  const unsupportedPage = CurrencyPageAccess.unsupportedPageMessage(originValue);
  if (unsupportedPage) return { ok: false, error: unsupportedPage };
  const site = normalizeSite(originValue);
  if (!site) return { ok: false, error: siteMemoryError(originValue) };

  const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
  if (!hasPermission) {
    return { ok: false, needsPermission: true, pattern: site.pattern, error: "Site access was not granted." };
  }

  const preferences = await getSitePreferences();
  preferences[site.origin] = true;
  await ExtensionAPI.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
  await registerSiteContentScript(site);
  return { ok: true, remembered: true, origin: site.origin };
}

async function forgetSite(originValue) {
  const site = normalizeSite(originValue);
  if (!site) return { ok: false, error: "This page is not a supported website." };

  const preferences = await getSitePreferences();
  delete preferences[site.origin];
  delete preferences[site.hostname];
  await ExtensionAPI.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
  await unregisterSiteContentScript(site);

  const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
  if (hasPermission) await ExtensionAPI.permissions.remove({ origins: [site.pattern] });
  return { ok: true, remembered: false, origin: site.origin };
}

async function reconcileRememberedSites() {
  const preferences = await getSitePreferences();
  const normalizedPreferences = {};
  const desiredIds = new Set();

  for (const [key, remembered] of Object.entries(preferences)) {
    if (!remembered) continue;
    if (CurrencyPageAccess.unsupportedPageMessage(key)) continue;
    const site = normalizeSite(key);
    if (!site) continue;
    const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
    if (!hasPermission) continue;
    normalizedPreferences[site.origin] = true;
    desiredIds.add(siteScriptId(site.origin));
    await registerSiteContentScript(site);
  }

  const registered = await ExtensionAPI.scripting.getRegisteredContentScripts();
  const obsoleteIds = registered
    .filter((script) => script.id.startsWith("ccp_site_") && !desiredIds.has(script.id))
    .map((script) => script.id);
  if (obsoleteIds.length) await ExtensionAPI.scripting.unregisterContentScripts({ ids: obsoleteIds });
  await ExtensionAPI.storage.local.set({ [SITE_PREFERENCES_KEY]: normalizedPreferences });
}

async function registerSiteContentScript(site) {
  const id = siteScriptId(site.origin);
  const existing = await ExtensionAPI.scripting.getRegisteredContentScripts({ ids: [id] });
  const registration = {
    id,
    matches: [site.pattern],
    js: REGISTERED_CONTENT_SCRIPT_FILES,
    css: REGISTERED_CONTENT_STYLE_FILES,
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true
  };

  if (existing.length) {
    await ExtensionAPI.scripting.updateContentScripts([registration]);
  } else {
    await ExtensionAPI.scripting.registerContentScripts([registration]);
  }
}

async function unregisterSiteContentScript(site) {
  const id = siteScriptId(site.origin);
  const existing = await ExtensionAPI.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await ExtensionAPI.scripting.unregisterContentScripts({ ids: [id] });
}

async function getSitePreferences() {
  const stored = await ExtensionAPI.storage.local.get(SITE_PREFERENCES_KEY);
  return { ...(stored[SITE_PREFERENCES_KEY] || {}) };
}

function normalizeSite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isFirefoxBuild() && url.port) return null;
    return {
      origin: url.origin,
      hostname: url.hostname.toLowerCase().replace(/^www\./, ""),
      pattern: `${url.origin}/*`
    };
  } catch (_error) {
    return null;
  }
}

function siteMemoryError(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only normal HTTP and HTTPS websites can be remembered.";
    }
    if (isFirefoxBuild() && url.port) {
      return "Firefox cannot enable automatic access for websites that use a non-default port. You can still convert this page manually.";
    }
  } catch (_error) {
    // Fall through to the generic invalid-page explanation.
  }
  return "This page cannot be remembered.";
}

function isFirefoxBuild() {
  return Boolean(ExtensionAPI.runtime.getManifest()?.browser_specific_settings?.gecko);
}

function siteScriptId(origin) {
  let hash = 2166136261;
  for (const character of origin) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `ccp_site_${(hash >>> 0).toString(36)}`;
}

function isSupportedTab(tab) {
  return Boolean(tab?.id && tab.url && /^(https?|file):\/\//.test(tab.url));
}

async function ensureContentScripts(tabId) {
  try {
    await ExtensionAPI.tabs.sendMessage(tabId, { type: M.CONTENT_READY });
    return;
  } catch (_error) {
    await ExtensionAPI.scripting.insertCSS({
      target: { tabId },
      files: INJECTED_CONTENT_STYLE_FILES
    });
    await ExtensionAPI.scripting.executeScript({
      target: { tabId },
      files: INJECTED_CONTENT_SCRIPT_FILES
    });
  }
}
