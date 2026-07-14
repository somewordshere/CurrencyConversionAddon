(function initializeContentEntry() {
  if (globalThis.__ccpContentInitialized) return;
  globalThis.__ccpContentInitialized = true;

  const M = CurrencyMessages;
  let settings = null;
  let settingsLoadPromise = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === M.CONTENT_READY) {
      sendResponse({ ok: true });
      return;
    }

    const task = handleMessage(message);
    if (!task) return;
    task.then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "The page request failed."
    }));
    return true;
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "sync" && (
      changes.enabled || changes.fromCurrency || changes.toCurrency ||
      changes.displayMode || changes.showPagePrompt
    )) {
      settingsLoadPromise = loadSettings();
      await settingsLoadPromise;
    }
    if (areaName === "local" && changes.autoConvertSites && settings?.enabled) {
      await applySitePreference();
    }
  });

  CurrencyPageUi.installSelectionListeners();
  settingsLoadPromise = loadSettings();

  function handleMessage(message) {
    switch (message?.type) {
      case M.RUN_SITE_CONVERSION:
        return ensureSettingsLoaded().then(async () => {
          const result = await runSiteConversion();
          CurrencyPageUi.removePageConvertPrompt();
          showConversionResult(result);
          return result;
        });
      case M.CLEAR_SITE_CONVERSION:
        return ensureSettingsLoaded().then(() => clearSiteConversion({
          forgetSite: message.forgetSite,
          suppressPrompt: message.suppressPrompt
        }));
      case M.SHOW_CONVERT_PROMPT:
        return ensureSettingsLoaded().then(applySitePreference).then(() => ({ ok: true }));
      case M.CONVERT_SELECTION:
        return ensureSettingsLoaded().then(convertCurrentSelection);
      default:
        return null;
    }
  }

  function ensureSettingsLoaded() {
    return settingsLoadPromise || Promise.resolve();
  }

  async function loadSettings() {
    const result = await chrome.runtime.sendMessage({ type: M.GET_SETTINGS });
    if (!result?.ok) return;
    settings = result.settings;
    CurrencyDetector.resetPageCurrencyDetection();
    CurrencyPageConverter.clearConversions();
    CurrencyPageConverter.configure(settings);
    CurrencyPageUi.configure({
      settings,
      runConversion: runSiteConversion,
      convertSelection: CurrencyPageConverter.convertSelectionText
    });
    CurrencyPageUi.clearTransientUi();

    if (settings.enabled) await applySitePreference();
    else {
      await updateBadge(0);
      CurrencyPageUi.removePageConvertPrompt();
    }
  }

  async function applySitePreference() {
    if (!settings?.enabled) {
      CurrencyPageUi.removePageConvertPrompt();
      CurrencyPageConverter.stopWatching();
      return;
    }

    const status = await getSiteStatus();
    if (status?.remembered) {
      CurrencyPageUi.removePageConvertPrompt();
      const result = await runSiteConversion();
      if (!result?.ok && result?.detectionConfidence !== "low") showConversionResult(result);
    } else if (settings.showPagePrompt) {
      CurrencyPageUi.showPageConvertPrompt();
    } else {
      CurrencyPageUi.removePageConvertPrompt();
    }
  }

  async function runSiteConversion() {
    const result = await CurrencyPageConverter.runSiteConversion({ clearExisting: true, observe: true });
    if (result?.ok) await updateBadge(result.count);
    return result;
  }

  async function clearSiteConversion({ forgetSite = false, suppressPrompt = false } = {}) {
    CurrencyPageConverter.clearConversions();
    await updateBadge(0);
    CurrencyPageUi.clearTransientUi();
    if (forgetSite) {
      await chrome.runtime.sendMessage({ type: M.FORGET_SITE, origin: getCurrentOrigin() });
    }
    if (settings?.enabled && settings.showPagePrompt && !suppressPrompt) CurrencyPageUi.showPageConvertPrompt();
    else CurrencyPageUi.removePageConvertPrompt();
    return { ok: true };
  }

  function getSiteStatus() {
    return chrome.runtime.sendMessage({ type: M.GET_SITE_STATUS, origin: getCurrentOrigin() });
  }

  function getCurrentOrigin() {
    return /^https?:$/.test(window.location.protocol) ? window.location.origin : window.location.href;
  }

  async function convertCurrentSelection() {
    if (!settings?.enabled) {
      CurrencyPageUi.showToast("Turn the extension on first.");
      return { ok: false, error: "Extension is turned off." };
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      CurrencyPageUi.showToast("Select a price first.");
      return { ok: false, error: "No selection found." };
    }

    const text = selection.toString().trim();
    const result = await CurrencyPageConverter.convertSelectionText(
      text,
      selection.anchorNode?.parentElement
    );
    const stale = result?.staleRates
      ? ` Cached rate${result.cacheAgeLabel ? `: ${result.cacheAgeLabel}` : ""}.`
      : "";
    CurrencyPageUi.showToast(
      result?.ok
        ? `${text} (${result.sourceCurrency}) = ${result.converted}.${stale}`
        : result?.error || "Could not convert selection."
    );
    return result;
  }

  function showConversionResult(result) {
    if (result?.ok && result.count > 0) {
      const detected = settings.fromCurrency === "AUTO"
        ? ` Detected: ${result.detectedCurrencies}.`
        : "";
      const rate = result.rateDate
        ? ` Rate: ${result.rateDate}${result.rateProvider ? ` via ${result.rateProvider}` : ""}${
          result.staleRates ? ` (cached${result.cacheAgeLabel ? `, ${result.cacheAgeLabel}` : ""})` : ""
        }.`
        : "";
      const scan = result.scanLimited
        ? " Large page: prioritized prices were converted; some unstructured text was not scanned."
        : "";
      CurrencyPageUi.showToast(
        `Converted ${result.count} price${result.count === 1 ? "" : "s"}.${detected}${rate}${scan}`,
        {
          actionLabel: "Undo",
          onAction: () => clearSiteConversion({ suppressPrompt: true }),
          duration: 8000
        }
      );
    } else {
      CurrencyPageUi.showToast(result?.error || "No confidently identified prices found.");
    }
  }

  function updateBadge(count) {
    return chrome.runtime.sendMessage({ type: M.SET_BADGE, count }).catch(() => {});
  }
})();
