(function initializeContentEntry() {
  if (globalThis.__ccpContentInitialized) return;
  globalThis.__ccpContentInitialized = true;

  const M = CurrencyMessages;
  let settings = null;
  let settingsLoadPromise = null;
  let pageCommandGeneration = 0;
  let renderedConversionSettingsKey = null;

  ExtensionAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  ExtensionAPI.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "sync") {
      const rateSettingsChanged = CurrencySettings.changesInclude(
        changes,
        CurrencySettings.RATE_AFFECTING_KEYS
      );
      const presentationSettingsChanged = CurrencySettings.changesInclude(
        changes,
        CurrencySettings.PRESENTATION_KEYS
      );
      const conversionSettingsChanged = rateSettingsChanged || presentationSettingsChanged;
      if (conversionSettingsChanged || changes.showPagePrompt) {
        if (rateSettingsChanged) invalidatePendingPageCommands();
        await queueSettingsReload({ failClosed: rateSettingsChanged });
      }
    }
    if (areaName === "local") {
      const sourceChanged = changes.siteSourceCurrencies &&
        siteSourceChangeAffectsCurrentOrigin(changes.siteSourceCurrencies);
      const preferenceChanged = changes.autoConvertSites &&
        sitePreferenceChangeAffectsCurrentOrigin(changes.autoConvertSites);
      if (!sourceChanged && !preferenceChanged) return;
      invalidatePendingPageCommands();
      const preferenceRemoved = preferenceChanged &&
        sitePreferenceWasRemovedFromCurrentOrigin(changes.autoConvertSites);
      if (preferenceRemoved) {
        clearRenderedConversions();
        CurrencyPageUi.clearTransientUi();
        CurrencyPageUi.removePageConvertPrompt();
      }
      const badgeUpdate = preferenceRemoved ? updateBadge(0) : Promise.resolve();
      await Promise.all([
        badgeUpdate,
        queueSettingsReload({ failClosed: true })
      ]);
    }
  });

  CurrencyPageUi.installSelectionListeners();
  settingsLoadPromise = loadSettings(pageCommandGeneration, { failClosed: true });

  function handleMessage(message) {
    switch (message?.type) {
      case M.RUN_SITE_CONVERSION: {
        const commandGeneration = pageCommandGeneration;
        return queueSettingsTask(async () => {
          if (commandGeneration !== pageCommandGeneration) return cancelledCommandResult();
          const refreshed = await refreshSettingsForCommand();
          if (!refreshed) {
            return { ok: false, error: "Could not refresh the saved conversion settings." };
          }
          if (commandGeneration !== pageCommandGeneration) return cancelledCommandResult();
          const result = await runSiteConversion();
          if (commandGeneration !== pageCommandGeneration) return cancelledCommandResult();
          CurrencyPageUi.removePageConvertPrompt();
          if (!result?.cancelled) showConversionResult(result);
          return result;
        });
      }
      case M.CLEAR_SITE_CONVERSION:
        return clearSiteConversion({
          forgetSite: message.forgetSite,
          suppressPrompt: message.suppressPrompt
        });
      case M.SHOW_CONVERT_PROMPT: {
        const commandGeneration = pageCommandGeneration;
        return ensureSettingsLoaded().then(async () => {
          if (
            commandGeneration === pageCommandGeneration &&
            !CurrencyPageConverter.hasConversions()
          ) {
            await applySitePreference(commandGeneration);
          }
          return { ok: true };
        });
      }
      case M.CONVERT_SELECTION:
        return ensureSettingsLoaded().then(convertCurrentSelection);
      default:
        return null;
    }
  }

  function ensureSettingsLoaded() {
    return settingsLoadPromise || Promise.resolve();
  }

  function queueSettingsReload({ failClosed = false } = {}) {
    const reloadGeneration = pageCommandGeneration;
    return queueSettingsTask(() => loadSettings(reloadGeneration, { failClosed }));
  }

  function queueSettingsTask(task) {
    const pendingTask = settingsLoadPromise || Promise.resolve();
    const nextTask = pendingTask.catch(() => {}).then(task);
    settingsLoadPromise = nextTask.then(() => undefined, () => undefined);
    return nextTask;
  }

  function invalidatePendingPageCommands() {
    pageCommandGeneration += 1;
    CurrencyPageConverter.cancelPendingConversion();
    CurrencyPageConverter.stopWatching();
    CurrencyPageConverter.stopDiscovering();
  }

  function cancelledCommandResult() {
    return {
      ok: false,
      count: 0,
      cancelled: true,
      error: "Conversion was cancelled before it could update the page."
    };
  }

  async function loadSettings(reloadGeneration, { failClosed = false } = {}) {
    const previousSettings = settings;
    let result;
    try {
      result = await ExtensionAPI.runtime.sendMessage({ type: M.GET_SETTINGS });
    } catch (_error) {
      if (failClosed) await failClosedSettingsReload(reloadGeneration);
      return;
    }
    if (!result?.ok) {
      if (failClosed) await failClosedSettingsReload(reloadGeneration);
      return;
    }
    const hadConversions = CurrencyPageConverter.hasConversions();
    const settingsChanges = adoptSettings(result.settings, previousSettings);
    if (reloadGeneration !== pageCommandGeneration) return;
    const renderedSettingsChanged = hadConversions &&
      renderedConversionSettingsKey !== null &&
      renderedConversionSettingsKey !== conversionSettingsKey(settings);

    if (hadConversions && settings.enabled) {
      if (settingsChanges.rateSettingsChanged || renderedSettingsChanged) {
        CurrencyPageUi.clearTransientUi();
        CurrencyPageUi.removePageConvertPrompt();
        const conversionResult = await runSiteConversion();
        if (reloadGeneration !== pageCommandGeneration || conversionResult?.cancelled) return;
        if (conversionResult?.ok) showConversionResult(conversionResult);
        else {
          CurrencyPageUi.showToast(
            `Settings changed, but prices could not be reconverted. Original prices were restored. ${
              conversionResult?.error || "Try converting the page again."
            }`
          );
        }
      } else {
        CurrencyPageConverter.startWatching();
        if (!settings.showPagePrompt) CurrencyPageUi.removePageConvertPrompt();
      }
      return;
    }

    if (
      !settingsChanges.rateSettingsChanged &&
      settingsChanges.presentationSettingsChanged &&
      !settingsChanges.pagePromptChanged
    ) return;

    clearRenderedConversions();
    CurrencyPageUi.clearTransientUi();
    CurrencyPageUi.removePageConvertPrompt();

    if (settings.enabled) await applySitePreference(reloadGeneration);
    else {
      await updateBadge(0);
      CurrencyPageUi.removePageConvertPrompt();
    }
  }

  async function refreshSettingsForCommand() {
    const result = await ExtensionAPI.runtime.sendMessage({ type: M.GET_SETTINGS });
    if (!result?.ok) return false;
    const previousSettings = settings;
    adoptSettings(result.settings, previousSettings);
    if (!settings.enabled) {
      clearRenderedConversions();
      CurrencyPageUi.clearTransientUi();
      CurrencyPageUi.removePageConvertPrompt();
      await updateBadge(0);
    }
    return true;
  }

  function adoptSettings(nextSettings, previousSettings) {
    settings = nextSettings;
    const rateSettingsChanged = !previousSettings || CurrencySettings.RATE_AFFECTING_KEYS.some(
      (key) => previousSettings[key] !== settings[key]
    );
    const presentationSettingsChanged = !previousSettings || CurrencySettings.PRESENTATION_KEYS.some(
      (key) => previousSettings[key] !== settings[key]
    );
    const pagePromptChanged = !previousSettings ||
      previousSettings.showPagePrompt !== settings.showPagePrompt;
    if (rateSettingsChanged) {
      CurrencyDetector.resetPageCurrencyDetection();
      CurrencyPageConverter.configure(settings);
    } else if (presentationSettingsChanged) {
      CurrencyPageConverter.updatePresentation(settings);
    }
    CurrencyPageUi.configure({
      settings,
      runConversion: runSiteConversion,
      clearConversion: clearPromptConversion,
      convertSelection: CurrencyPageConverter.convertSelectionText
    });
    return { rateSettingsChanged, presentationSettingsChanged, pagePromptChanged };
  }

  async function applySitePreference(expectedGeneration = pageCommandGeneration) {
    if (expectedGeneration !== pageCommandGeneration) return;
    if (!settings?.enabled) {
      CurrencyPageUi.removePageConvertPrompt();
      CurrencyPageConverter.stopWatching();
      CurrencyPageConverter.stopDiscovering();
      return;
    }

    if (CurrencyPageConverter.hasConversions()) {
      CurrencyPageConverter.stopDiscovering();
      CurrencyPageConverter.startWatching();
      if (!settings.showPagePrompt) CurrencyPageUi.removePageConvertPrompt();
      return;
    }

    const status = await getSiteStatus();
    if (expectedGeneration !== pageCommandGeneration) return;
    if (status?.remembered) {
      CurrencyPageConverter.stopDiscovering();
      CurrencyPageUi.removePageConvertPrompt();
      const result = await runSiteConversion();
      if (expectedGeneration !== pageCommandGeneration || result?.cancelled) return;
      if (!result?.ok) {
        if (settings.showPagePrompt) CurrencyPageUi.showPageConvertPrompt();
        if (result?.detectionConfidence !== "low") showConversionResult(result);
      }
    } else if (settings.showPagePrompt) {
      CurrencyPageConverter.stopWatching();
      await updateBadge(0);
      if (expectedGeneration !== pageCommandGeneration) return;
      offerPageConversion(expectedGeneration);
    } else {
      CurrencyPageConverter.stopWatching();
      CurrencyPageConverter.stopDiscovering();
      await updateBadge(0);
      if (expectedGeneration !== pageCommandGeneration) return;
      CurrencyPageUi.removePageConvertPrompt();
    }
  }

  function offerPageConversion(expectedGeneration = pageCommandGeneration) {
    if (
      expectedGeneration !== pageCommandGeneration ||
      !settings?.enabled ||
      !settings.showPagePrompt ||
      CurrencyPageConverter.hasConversions()
    ) return;

    const detection = CurrencyPageConverter.detectPagePrices();
    if (detection.found) {
      CurrencyPageConverter.stopDiscovering();
      CurrencyPageUi.showPageConvertPrompt();
      CurrencyPageConverter.prefetchRates(detection.currencies).catch(() => {});
      return;
    }

    CurrencyPageUi.removePageConvertPrompt();
    CurrencyPageConverter.startDiscovering((nextDetection) => {
      if (
        expectedGeneration !== pageCommandGeneration ||
        !settings?.enabled ||
        !settings.showPagePrompt ||
        CurrencyPageConverter.hasConversions()
      ) return;
      CurrencyPageUi.showPageConvertPrompt();
      CurrencyPageConverter.prefetchRates(nextDetection.currencies).catch(() => {});
    });
  }

  async function runSiteConversion() {
    CurrencyPageConverter.stopDiscovering();
    const runSettingsKey = conversionSettingsKey(settings);
    const result = await CurrencyPageConverter.runSiteConversion({ clearExisting: true, observe: true });
    if (!result?.cancelled) {
      renderedConversionSettingsKey = CurrencyPageConverter.hasConversions()
        ? runSettingsKey
        : null;
    } else {
      renderedConversionSettingsKey = null;
    }
    await updateBadge(result?.ok ? result.count : 0);
    return result;
  }

  async function clearSiteConversion({ forgetSite = false, suppressPrompt = false } = {}) {
    invalidatePendingPageCommands();
    clearRenderedConversions();
    await updateBadge(0);
    CurrencyPageUi.clearTransientUi();
    if (forgetSite) {
      const result = await ExtensionAPI.runtime.sendMessage({
        type: M.FORGET_SITE,
        origin: getCurrentOrigin()
      });
      if (!result?.ok) return result || { ok: false, error: "Site access could not be removed." };
    }
    if (settings?.enabled && settings.showPagePrompt && !suppressPrompt && !forgetSite) {
      CurrencyPageUi.showPageConvertPrompt();
    } else CurrencyPageUi.removePageConvertPrompt();
    return { ok: true };
  }

  async function clearPromptConversion() {
    invalidatePendingPageCommands();
    clearRenderedConversions();
    await updateBadge(0);
    return { ok: true };
  }

  function clearRenderedConversions() {
    CurrencyPageConverter.clearConversions();
    renderedConversionSettingsKey = null;
  }

  function conversionSettingsKey(value) {
    return JSON.stringify(CurrencySettings.RATE_AFFECTING_KEYS.map((key) => value?.[key]));
  }

  async function failClosedSettingsReload(reloadGeneration) {
    if (reloadGeneration !== pageCommandGeneration) return;
    const disabledSettings = {
      ...CurrencySettings.DEFAULTS,
      ...settings,
      enabled: false,
      showPagePrompt: false
    };
    adoptSettings(disabledSettings, settings);
    clearRenderedConversions();
    CurrencyPageUi.clearTransientUi();
    CurrencyPageUi.removePageConvertPrompt();
    await updateBadge(0);
  }

  function getSiteStatus() {
    return ExtensionAPI.runtime.sendMessage({ type: M.GET_SITE_STATUS, origin: getCurrentOrigin() });
  }

  function getCurrentOrigin() {
    return /^https?:$/.test(window.location.protocol) ? window.location.origin : window.location.href;
  }

  function siteSourceChangeAffectsCurrentOrigin(change) {
    const origin = getCurrentOrigin();
    return change?.oldValue?.[origin] !== change?.newValue?.[origin];
  }

  function sitePreferenceChangeAffectsCurrentOrigin(change) {
    const origin = getCurrentOrigin();
    return change?.oldValue?.[origin] !== change?.newValue?.[origin];
  }

  function sitePreferenceWasRemovedFromCurrentOrigin(change) {
    const origin = getCurrentOrigin();
    return change?.oldValue?.[origin] === true && change?.newValue?.[origin] !== true;
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
    return ExtensionAPI.runtime.sendMessage({ type: M.SET_BADGE, count }).catch(() => {});
  }
})();
