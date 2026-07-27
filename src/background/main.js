const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  fromCurrency: "AUTO",
  toCurrency: "EUR",
  displayMode: "beside",
  showPagePrompt: true
});
const SITE_PREFERENCES_KEY = "autoConvertSites";
const SITE_SOURCE_CURRENCIES_KEY = "siteSourceCurrencies";
const SITE_ACCESS_RESET_NOTICE_KEY = "siteAccessResetNotice";
const SITE_ACCESS_RESET_PENDING_KEY = "siteAccessResetPending";
const LEGACY_ALL_SITE_ORIGINS = ["http://*/*", "https://*/*"];
const REQUIRED_PROVIDER_ORIGIN = "https://api.frankfurter.dev";
const M = CurrencyMessages;
let siteStateMutationQueue = Promise.resolve();
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

ExtensionAPI.runtime.onInstalled.addListener(async (details = {}) => {
  try {
    await runLegacySiteAccessMaintenance(details);
  } catch (error) {
    console.error("Currency Converter Pro could not remove legacy website access.", error);
    return;
  }

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
    await reconcileRememberedSites(supportedCodes);
  } catch (error) {
    console.error("Currency Converter Pro initialization failed.", error);
  }
});

ExtensionAPI.runtime.onStartup.addListener(() => {
  runLegacySiteAccessMaintenance().then(() => reconcileRememberedSites()).catch((error) => {
    console.error("Could not restore remembered-site registrations.", error);
  });
});

ExtensionAPI.permissions.onRemoved.addListener(() => {
  return reconcileRememberedSites().catch(() => {});
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
      return getSettings(message.origin || sender?.url);
    case M.UPDATE_SETTINGS:
      return updateSettings(message.payload, message.origin || sender?.url);
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

function getCurrencyCatalogFast() {
  return typeof CurrencyCatalogService.getCachedCurrencies === "function"
    ? CurrencyCatalogService.getCachedCurrencies()
    : CurrencyCatalogService.getCurrencies();
}

async function getSettings(originValue) {
  await waitForSiteStateMutations();
  const catalog = await getCurrencyCatalogFast();
  CurrencyCatalogService.getCurrencies().catch(() => {});
  const supportedCodes = catalog.currencies.map((currency) => currency.code);
  const globalSettings = await getGlobalSettings(supportedCodes);
  const settings = await resolveSettingsForOrigin(globalSettings, originValue, supportedCodes);
  return { ok: true, settings };
}

async function getGlobalSettings(supportedCodes = CurrencyCatalog.CURRENCY_CODES) {
  const stored = await ExtensionAPI.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored, supportedCodes) };
}

async function getAvailableCurrencies() {
  const catalog = await getCurrencyCatalogFast();
  CurrencyCatalogService.getCurrencies().catch(() => {});
  return {
    ok: true,
    currencies: catalog.currencies.map((currency) => currency.code),
    details: catalog.currencies,
    cached: catalog.cached,
    stale: catalog.stale,
    warning: catalog.warning
  };
}

async function updateSettings(payload, originValue) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid settings." };
  }

  return enqueueSiteStateMutation(() => updateSettingsUnlocked(payload, originValue));
}

async function updateSettingsUnlocked(payload, originValue) {
  const catalog = await getCurrencyCatalogFast();
  CurrencyCatalogService.getCurrencies().catch(() => {});
  const supportedCodes = catalog.currencies.map((currency) => currency.code);
  const globalSettings = await getGlobalSettings(supportedCodes);
  const currentSettings = await resolveSettingsForOrigin(
    globalSettings,
    originValue,
    supportedCodes
  );
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

  const site = normalizeSite(originValue);
  const remembered = site ? await isRememberedSite(site) : false;
  if (settings.toCurrency !== globalSettings.toCurrency) {
    const conflict = await findTargetCurrencyConflict(settings.toCurrency, globalSettings, site);
    if (conflict) {
      return { ok: false, settings: currentSettings, error: conflict };
    }
  }
  if (remembered) {
    return updateRememberedSiteSettingsUnlocked(
      site,
      settings,
      globalSettings,
      currentSettings,
      supportedCodes
    );
  } else {
    await ExtensionAPI.storage.sync.set(settings);
  }
  return { ok: true, settings };
}

async function findTargetCurrencyConflict(targetCurrency, globalSettings, activeSite) {
  if (
    globalSettings.fromCurrency !== "AUTO" &&
    globalSettings.fromCurrency === targetCurrency
  ) {
    return `The target ${targetCurrency} matches your default source currency. Change the default source first.`;
  }

  const [preferences, siteSources] = await Promise.all([
    getSitePreferences(),
    getSiteSourceCurrencies()
  ]);
  for (const [origin, sourceCurrency] of Object.entries(siteSources)) {
    if (
      origin === activeSite?.origin ||
      preferences[origin] !== true ||
      sourceCurrency === "AUTO" ||
      sourceCurrency !== targetCurrency
    ) continue;
    const site = normalizeSite(origin);
    if (!site || !(await isRememberedSite(site))) continue;
    return `The target ${targetCurrency} matches the saved source for ${site.hostname}. Change that site's source first.`;
  }
  return null;
}

function enqueueSiteStateMutation(task) {
  const operation = siteStateMutationQueue.then(task, task);
  siteStateMutationQueue = operation.catch(() => undefined);
  return operation;
}

async function waitForSiteStateMutations() {
  const pendingMutations = siteStateMutationQueue;
  await pendingMutations.catch(() => undefined);
}

async function updateRememberedSiteSettings(
  site,
  settings,
  globalSettings,
  currentSettings,
  supportedCodes
) {
  return enqueueSiteStateMutation(() => updateRememberedSiteSettingsUnlocked(
    site,
    settings,
    globalSettings,
    currentSettings,
    supportedCodes
  ));
}

async function updateRememberedSiteSettingsUnlocked(
  site,
  settings,
  globalSettings,
  currentSettings,
  supportedCodes
) {
  if (!(await isRememberedSite(site))) {
    return {
      ok: false,
      settings: currentSettings,
      error: "This site's automatic-access state changed. Reopen the popup and try again."
    };
  }
  if (settings.fromCurrency !== "AUTO" && !supportedCodes.includes(settings.fromCurrency)) {
    return { ok: false, settings: currentSettings, error: "Unsupported source currency." };
  }

  const previousSources = await getSiteSourceCurrencies();
  const nextSources = { ...previousSources, [site.origin]: settings.fromCurrency };
  delete nextSources[site.hostname];
  const sourceChanged = previousSources[site.origin] !== settings.fromCurrency ||
    Object.hasOwn(previousSources, site.hostname);
  const nextGlobalSettings = {
    ...settings,
    fromCurrency: globalSettings.fromCurrency
  };
  const globalChanged = Object.keys(DEFAULT_SETTINGS).some(
    (key) => nextGlobalSettings[key] !== globalSettings[key]
  );

  try {
    if (sourceChanged) {
      await ExtensionAPI.storage.local.set({ [SITE_SOURCE_CURRENCIES_KEY]: nextSources });
    }
  } catch (error) {
    return {
      ok: false,
      settings: currentSettings,
      error: `Could not save this site's source currency: ${errorMessage(error)}.`
    };
  }

  try {
    if (globalChanged) await ExtensionAPI.storage.sync.set(nextGlobalSettings);
  } catch (error) {
    let rollbackFailed = false;
    if (sourceChanged) {
      try {
        await ExtensionAPI.storage.local.set({
          [SITE_SOURCE_CURRENCIES_KEY]: previousSources
        });
      } catch (_rollbackError) {
        rollbackFailed = true;
      }
    }
    return {
      ok: false,
      settings: rollbackFailed
        ? await resolveSettingsForOrigin(globalSettings, site.origin, supportedCodes)
        : currentSettings,
      partial: rollbackFailed,
      error: rollbackFailed
        ? `Global settings were not saved, and the site-source rollback failed: ${errorMessage(error)}. Reopen the popup to refresh its state.`
        : `Global settings were not saved: ${errorMessage(error)}.`
    };
  }

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
  const providerError = providerSiteMemoryError(site);
  if (providerError) return { ok: false, remembered: false, error: providerError };
  await waitForSiteStateMutations();

  if (hasAlwaysOnPageAccess()) {
    const [preferences, siteSources] = await Promise.all([
      getSitePreferences(),
      getSiteSourceCurrencies()
    ]);
    const preferencePresent = preferences[site.origin] === true ||
      preferences[site.hostname] === true;
    const sourcePresent = Object.hasOwn(siteSources, site.origin) ||
      Object.hasOwn(siteSources, site.hostname);
    return {
      ok: true,
      origin: site.origin,
      pattern: site.pattern,
      hasPermission: true,
      requiresPermission: false,
      revocablePermission: false,
      remembered: preferencePresent,
      registrationRemaining: false,
      dataRemaining: preferencePresent || sourcePresent,
      cleanupRequired: false
    };
  }

  const [preferences, siteSources, registered, hasPermission] = await Promise.all([
    getSitePreferences(),
    getSiteSourceCurrencies(),
    ExtensionAPI.scripting.getRegisteredContentScripts({ ids: [siteScriptId(site.origin)] }),
    ExtensionAPI.permissions.contains({ origins: [site.pattern] })
  ]);
  const preferencePresent = preferences[site.origin] === true ||
    preferences[site.hostname] === true;
  const sourcePresent = Object.hasOwn(siteSources, site.origin) ||
    Object.hasOwn(siteSources, site.hostname);
  const remembered = preferencePresent && hasPermission;
  const revocablePermission = hasPermission && site.origin !== REQUIRED_PROVIDER_ORIGIN;
  const registrationRemaining = registered.length > 0;
  const dataRemaining = preferencePresent || sourcePresent;
  return {
    ok: true,
    origin: site.origin,
    pattern: site.pattern,
    hasPermission,
    revocablePermission,
    remembered,
    registrationRemaining,
    dataRemaining,
    cleanupRequired: !remembered && (
      revocablePermission || registrationRemaining || dataRemaining
    )
  };
}

async function rememberSite(originValue) {
  const unsupportedPage = CurrencyPageAccess.unsupportedPageMessage(originValue);
  if (unsupportedPage) return { ok: false, error: unsupportedPage };
  const site = normalizeSite(originValue);
  if (!site) return { ok: false, error: siteMemoryError(originValue) };
  const providerError = providerSiteMemoryError(site);
  if (providerError) return { ok: false, remembered: false, error: providerError };

  return enqueueSiteStateMutation(() => rememberSiteUnlocked(site));
}

async function rememberSiteUnlocked(site) {
  const alwaysOnAccess = hasAlwaysOnPageAccess();
  if (!alwaysOnAccess) {
    const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
    if (!hasPermission) {
      return { ok: false, needsPermission: true, pattern: site.pattern, error: "Site access was not granted." };
    }
  }

  try {
    const catalog = await getCurrencyCatalogFast();
    CurrencyCatalogService.getCurrencies().catch(() => {});
    const supportedCodes = catalog.currencies.map((currency) => currency.code);
    const settings = await getGlobalSettings(supportedCodes);
    const preferences = await getSitePreferences();
    const siteSources = await getSiteSourceCurrencies();
    preferences[site.origin] = true;
    delete preferences[site.hostname];
    siteSources[site.origin] = settings.fromCurrency;
    delete siteSources[site.hostname];

    if (!alwaysOnAccess) await registerSiteContentScript(site);
    await ExtensionAPI.storage.local.set({
      [SITE_PREFERENCES_KEY]: preferences,
      [SITE_SOURCE_CURRENCIES_KEY]: siteSources
    });
    return { ok: true, remembered: true, origin: site.origin };
  } catch (error) {
    const state = await rollbackRememberSite(site);
    return {
      ok: false,
      remembered: state.remembered,
      permissionRemaining: state.permissionRemaining,
      registrationRemaining: state.registrationRemaining,
      dataRemaining: state.preferenceRemaining || state.sourceRemaining,
      origin: site.origin,
      error: state.clean
        ? `Could not enable automatic conversion: ${errorMessage(error)}. The site ${
          alwaysOnAccess ? "setting" : "permission"
        } was rolled back.`
        : `Could not enable automatic conversion: ${errorMessage(error)}. Some site access remains; use Remove site access and try again.`
    };
  }
}

async function forgetSite(originValue) {
  const site = normalizeSite(originValue);
  if (!site) return { ok: false, error: "This page is not a supported website." };

  return enqueueSiteStateMutation(() => forgetSiteUnlocked(site));
}

async function forgetSiteUnlocked(site) {
  const failures = [];

  try {
    await unregisterSiteContentScript(site);
  } catch (error) {
    failures.push(errorMessage(error));
  }
  try {
    await removeRememberedSiteData(site);
  } catch (error) {
    failures.push(errorMessage(error));
  }
  if (!hasAlwaysOnPageAccess()) {
    try {
      const permissionRemoved = await removeSitePermission(site);
      if (!permissionRemoved) failures.push("browser permission is still present");
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  let state;
  try {
    state = await inspectSiteState(site);
  } catch (error) {
    failures.push(errorMessage(error));
    state = {
      clean: false,
      remembered: true,
      permissionRemaining: true,
      registrationRemaining: true,
      preferenceRemaining: true,
      sourceRemaining: true
    };
  }

  if (failures.length || !state.clean) {
    const remaining = [
      state.permissionRemaining ? "browser permission" : null,
      state.registrationRemaining ? "automatic registration" : null,
      state.preferenceRemaining || state.sourceRemaining ? "saved site data" : null
    ].filter(Boolean);
    return {
      ok: false,
      remembered: state.remembered,
      permissionRemaining: state.permissionRemaining,
      registrationRemaining: state.registrationRemaining,
      dataRemaining: state.preferenceRemaining || state.sourceRemaining,
      origin: site.origin,
      error: `Site-access cleanup is incomplete${
        remaining.length ? `; remaining: ${remaining.join(", ")}` : ""
      }. Try Remove site access again.${
        failures.length ? ` Details: ${[...new Set(failures)].join("; ")}.` : ""
      }`
    };
  }
  return {
    ok: true,
    remembered: false,
    permissionRemaining: false,
    origin: site.origin
  };
}

async function rollbackRememberSite(site) {
  const cleanups = [
    () => removeRememberedSiteData(site),
    () => unregisterSiteContentScript(site)
  ];
  if (!hasAlwaysOnPageAccess()) cleanups.push(() => removeSitePermission(site));
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (_error) {
      // Inspect the final browser and storage state after every cleanup attempt.
    }
  }
  try {
    return await inspectSiteState(site);
  } catch (_error) {
    return {
      clean: false,
      remembered: true,
      permissionRemaining: true,
      registrationRemaining: true,
      preferenceRemaining: true,
      sourceRemaining: true
    };
  }
}

async function inspectSiteState(site) {
  if (hasAlwaysOnPageAccess()) {
    const [preferences, siteSources, registered] = await Promise.all([
      getSitePreferences(),
      getSiteSourceCurrencies(),
      ExtensionAPI.scripting.getRegisteredContentScripts({ ids: [siteScriptId(site.origin)] })
    ]);
    const preferenceRemaining = preferences[site.origin] === true ||
      preferences[site.hostname] === true;
    const sourceRemaining = Object.hasOwn(siteSources, site.origin) ||
      Object.hasOwn(siteSources, site.hostname);
    const registrationRemaining = registered.length > 0;
    return {
      clean: !preferenceRemaining && !sourceRemaining && !registrationRemaining,
      remembered: preferenceRemaining,
      permissionRemaining: false,
      registrationRemaining,
      preferenceRemaining,
      sourceRemaining
    };
  }
  const [preferences, siteSources, registered, hasPermission] = await Promise.all([
    getSitePreferences(),
    getSiteSourceCurrencies(),
    ExtensionAPI.scripting.getRegisteredContentScripts({ ids: [siteScriptId(site.origin)] }),
    ExtensionAPI.permissions.contains({ origins: [site.pattern] })
  ]);
  const permissionRemaining = hasPermission && site.origin !== REQUIRED_PROVIDER_ORIGIN;
  const preferenceRemaining = preferences[site.origin] === true ||
    preferences[site.hostname] === true;
  const sourceRemaining = Object.hasOwn(siteSources, site.origin) ||
    Object.hasOwn(siteSources, site.hostname);
  const registrationRemaining = registered.length > 0;
  return {
    clean: !permissionRemaining && !preferenceRemaining &&
      !sourceRemaining && !registrationRemaining,
    remembered: preferenceRemaining && hasPermission,
    permissionRemaining,
    registrationRemaining,
    preferenceRemaining,
    sourceRemaining
  };
}

async function reconcileRememberedSites(supportedCodes) {
  return enqueueSiteStateMutation(() => reconcileRememberedSitesUnlocked(supportedCodes));
}

async function reconcileRememberedSitesUnlocked(supportedCodes) {
  if (!supportedCodes) {
    const catalog = await getCurrencyCatalogFast();
    CurrencyCatalogService.getCurrencies().catch(() => {});
    supportedCodes = catalog.currencies.map((currency) => currency.code);
  }
  const alwaysOnAccess = hasAlwaysOnPageAccess();
  const preferences = await getSitePreferences();
  const normalizedPreferences = {};
  const desiredIds = new Set();

  for (const [key, remembered] of Object.entries(preferences)) {
    if (!remembered) continue;
    if (CurrencyPageAccess.unsupportedPageMessage(key)) continue;
    const site = normalizeSite(key);
    if (!site || site.origin === REQUIRED_PROVIDER_ORIGIN) continue;
    if (!alwaysOnAccess) {
      const hasPermission = await ExtensionAPI.permissions.contains({ origins: [site.pattern] });
      if (!hasPermission) continue;
    }
    normalizedPreferences[site.origin] = true;
    if (!alwaysOnAccess) {
      desiredIds.add(siteScriptId(site.origin));
      await registerSiteContentScript(site);
    }
  }

  const registered = await ExtensionAPI.scripting.getRegisteredContentScripts();
  const obsoleteIds = registered
    .filter((script) => script.id.startsWith("ccp_site_") && !desiredIds.has(script.id))
    .map((script) => script.id);
  if (obsoleteIds.length) await ExtensionAPI.scripting.unregisterContentScripts({ ids: obsoleteIds });
  await ExtensionAPI.storage.local.set({ [SITE_PREFERENCES_KEY]: normalizedPreferences });
  await reconcileSiteSourceCurrencies(normalizedPreferences, supportedCodes);
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

async function getSiteSourceCurrencies() {
  const stored = await ExtensionAPI.storage.local.get(SITE_SOURCE_CURRENCIES_KEY);
  return { ...(stored[SITE_SOURCE_CURRENCIES_KEY] || {}) };
}

async function resolveSettingsForOrigin(globalSettings, originValue, supportedCodes) {
  const site = normalizeSite(originValue);
  if (!site || !(await isRememberedSite(site))) return { ...globalSettings };

  const siteSources = await getSiteSourceCurrencies();
  const hasSourceOverride = Object.hasOwn(siteSources, site.origin);
  const sourceCurrency = siteSources[site.origin];
  return {
    ...globalSettings,
    fromCurrency: hasSourceOverride && (
      sourceCurrency === "AUTO" || supportedCodes.includes(sourceCurrency)
    )
      ? sourceCurrency
      : globalSettings.fromCurrency
  };
}

async function isRememberedSite(site) {
  if (site.origin === REQUIRED_PROVIDER_ORIGIN) return false;
  const preferences = await getSitePreferences();
  if (preferences[site.origin] !== true) return false;
  if (hasAlwaysOnPageAccess()) return true;
  return ExtensionAPI.permissions.contains({ origins: [site.pattern] });
}

async function saveSiteSourceCurrency(site, currency, supportedCodes) {
  return enqueueSiteStateMutation(() => saveSiteSourceCurrencyUnlocked(site, currency, supportedCodes));
}

async function saveSiteSourceCurrencyUnlocked(site, currency, supportedCodes) {
  if (!site || !(await isRememberedSite(site))) return false;
  const siteSources = await getSiteSourceCurrencies();
  if (currency !== "AUTO" && !supportedCodes.includes(currency)) return false;
  siteSources[site.origin] = currency;
  delete siteSources[site.hostname];
  await ExtensionAPI.storage.local.set({ [SITE_SOURCE_CURRENCIES_KEY]: siteSources });
  return true;
}

async function removeRememberedSiteData(site) {
  const preferences = await getSitePreferences();
  const siteSources = await getSiteSourceCurrencies();
  delete preferences[site.origin];
  delete preferences[site.hostname];
  delete siteSources[site.origin];
  delete siteSources[site.hostname];
  await ExtensionAPI.storage.local.set({
    [SITE_PREFERENCES_KEY]: preferences,
    [SITE_SOURCE_CURRENCIES_KEY]: siteSources
  });
}

async function reconcileSiteSourceCurrencies(preferences, supportedCodes) {
  const siteSources = await getSiteSourceCurrencies();
  const normalizedSources = {};

  for (const [key, currency] of Object.entries(siteSources)) {
    const site = normalizeSite(key);
    if (
      !site ||
      preferences[site.origin] !== true ||
      (currency !== "AUTO" && !supportedCodes.includes(currency))
    ) continue;
    normalizedSources[site.origin] = currency;
  }

  await ExtensionAPI.storage.local.set({
    [SITE_SOURCE_CURRENCIES_KEY]: normalizedSources
  });
}

async function removeLegacyAllSitesPermission() {
  const failures = [];

  for (const pattern of LEGACY_ALL_SITE_ORIGINS) {
    try {
      const hadPermission = await ExtensionAPI.permissions.contains({ origins: [pattern] });
      if (hadPermission) await ExtensionAPI.permissions.remove({ origins: [pattern] });
      const stillPresent = await ExtensionAPI.permissions.contains({ origins: [pattern] });
      if (stillPresent) failures.push(pattern);
    } catch (_error) {
      failures.push(pattern);
    }
  }

  if (failures.length) {
    throw new Error(`Legacy website access remains for: ${[...new Set(failures)].join(", ")}`);
  }
  return true;
}

function isLegacyBroadAccessUpdate(details) {
  return details?.reason === "update" && /^1\.7\.[0-2]$/.test(details.previousVersion || "");
}

function runLegacySiteAccessMaintenance(details = {}) {
  if (hasAlwaysOnPageAccess()) {
    return enqueueSiteStateMutation(async () => {
      await ExtensionAPI.storage.local.remove([
        SITE_ACCESS_RESET_PENDING_KEY,
        SITE_ACCESS_RESET_NOTICE_KEY
      ]);
      return false;
    });
  }
  return enqueueSiteStateMutation(async () => {
    if (isLegacyBroadAccessUpdate(details)) {
      await ExtensionAPI.storage.local.set({ [SITE_ACCESS_RESET_PENDING_KEY]: true });
    }
    await removeLegacyAllSitesPermission();
    return retryPendingLegacySiteAccessResetUnlocked();
  });
}

async function retryPendingLegacySiteAccessResetUnlocked() {
  const stored = await ExtensionAPI.storage.local.get(SITE_ACCESS_RESET_PENDING_KEY);
  if (stored[SITE_ACCESS_RESET_PENDING_KEY] !== true) return false;
  await resetLegacySiteAccessUnlocked();
  return true;
}

async function resetLegacySiteAccess() {
  return enqueueSiteStateMutation(() => resetLegacySiteAccessUnlocked());
}

async function resetLegacySiteAccessUnlocked() {
  const registered = await ExtensionAPI.scripting.getRegisteredContentScripts();
  const legacyIds = registered
    .filter((script) => script.id.startsWith("ccp_site_"))
    .map((script) => script.id);
  if (legacyIds.length) {
    await ExtensionAPI.scripting.unregisterContentScripts({ ids: legacyIds });
  }
  await ExtensionAPI.storage.local.set({
    [SITE_PREFERENCES_KEY]: {},
    [SITE_SOURCE_CURRENCIES_KEY]: {}
  });

  const [remainingScripts, stored] = await Promise.all([
    ExtensionAPI.scripting.getRegisteredContentScripts(),
    ExtensionAPI.storage.local.get([
      SITE_PREFERENCES_KEY,
      SITE_SOURCE_CURRENCIES_KEY
    ])
  ]);
  const registrationsCleared = !remainingScripts.some((script) => script.id.startsWith("ccp_site_"));
  const preferencesCleared = isEmptyRecord(stored[SITE_PREFERENCES_KEY]);
  const sourcesCleared = isEmptyRecord(stored[SITE_SOURCE_CURRENCIES_KEY]);
  if (!registrationsCleared || !preferencesCleared || !sourcesCleared) {
    throw new Error("Legacy site-access reset could not be verified.");
  }

  await ExtensionAPI.storage.local.set({ [SITE_ACCESS_RESET_NOTICE_KEY]: true });
  const notice = await ExtensionAPI.storage.local.get(SITE_ACCESS_RESET_NOTICE_KEY);
  if (notice[SITE_ACCESS_RESET_NOTICE_KEY] !== true) {
    throw new Error("Legacy site-access reset notice could not be verified.");
  }
  await ExtensionAPI.storage.local.remove(SITE_ACCESS_RESET_PENDING_KEY);
  return true;
}

function isEmptyRecord(value) {
  return Boolean(value) && typeof value === "object" && Object.keys(value).length === 0;
}

async function removeSitePermission(site) {
  if (site.origin === REQUIRED_PROVIDER_ORIGIN) return true;
  const request = { origins: [site.pattern] };
  if (await ExtensionAPI.permissions.contains(request)) {
    await ExtensionAPI.permissions.remove(request);
  }
  return !(await ExtensionAPI.permissions.contains(request));
}

function errorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "an extension cleanup step failed";
}

function normalizeSite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isFirefoxBuild() && url.port && !hasAlwaysOnPageAccess()) return null;
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
    if (isFirefoxBuild() && url.port && !hasAlwaysOnPageAccess()) {
      return "Firefox cannot enable automatic access for websites that use a non-default port. You can still convert this page manually.";
    }
  } catch (_error) {
    // Fall through to the generic invalid-page explanation.
  }
  return "This page cannot be remembered.";
}

function providerSiteMemoryError(site) {
  if (site?.origin !== REQUIRED_PROVIDER_ORIGIN) return null;
  return "This exchange-rate provider cannot be enabled for automatic page conversion.";
}

function isFirefoxBuild() {
  return Boolean(ExtensionAPI.runtime.getManifest()?.browser_specific_settings?.gecko);
}

function hasAlwaysOnPageAccess() {
  const scripts = ExtensionAPI.runtime.getManifest()?.content_scripts;
  return Array.isArray(scripts) && scripts.some((script) =>
    Array.isArray(script?.matches) &&
    script.matches.includes("http://*/*") &&
    script.matches.includes("https://*/*")
  );
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
