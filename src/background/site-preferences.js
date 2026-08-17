(function initializeSitePreferences(global) {
  function createSitePreferences({
    api,
    pageAccess,
    catalogService,
    settingsSchema
  }) {
    const SITE_PREFERENCES_KEY = "autoConvertSites";
    const SITE_SOURCE_CURRENCIES_KEY = "siteSourceCurrencies";
    const LEGACY_SITE_ACCESS_KEYS = ["siteAccessResetNotice", "siteAccessResetPending"];
    const REQUIRED_PROVIDER_ORIGIN = "https://api.frankfurter.dev";
    let mutationQueue = Promise.resolve();

    function runMutation(task) {
      const operation = mutationQueue.then(task, task);
      mutationQueue = operation.catch(() => undefined);
      return operation;
    }

    async function waitForMutations() {
      const pendingMutations = mutationQueue;
      await pendingMutations.catch(() => undefined);
    }

    async function getStatus(originValue) {
      const unsupportedPage = pageAccess.unsupportedPageMessage(originValue);
      if (unsupportedPage) {
        return { ok: false, remembered: false, error: unsupportedPage };
      }
      const site = normalizeSite(originValue);
      if (!site) return { ok: false, remembered: false, error: siteMemoryError(originValue) };
      const providerError = providerSiteMemoryError(site);
      if (providerError) return { ok: false, remembered: false, error: providerError };
      await waitForMutations();

      const [preferences, siteSources] = await Promise.all([
        getPreferences(),
        getSourceCurrencies()
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

    async function remember(originValue, resolveSourceCurrency) {
      const unsupportedPage = pageAccess.unsupportedPageMessage(originValue);
      if (unsupportedPage) return { ok: false, error: unsupportedPage };
      const site = normalizeSite(originValue);
      if (!site) return { ok: false, error: siteMemoryError(originValue) };
      const providerError = providerSiteMemoryError(site);
      if (providerError) return { ok: false, remembered: false, error: providerError };

      return runMutation(() => rememberWithinMutation(site, resolveSourceCurrency));
    }

    async function rememberWithinMutation(site, resolveSourceCurrency) {
      try {
        const sourceCurrency = await resolveSourceCurrency();
        const preferences = await getPreferences();
        const siteSources = await getSourceCurrencies();
        preferences[site.origin] = true;
        delete preferences[site.hostname];
        siteSources[site.origin] = sourceCurrency;
        delete siteSources[site.hostname];

        await api.storage.local.set({
          [SITE_PREFERENCES_KEY]: preferences,
          [SITE_SOURCE_CURRENCIES_KEY]: siteSources
        });
        return { ok: true, remembered: true, origin: site.origin };
      } catch (error) {
        const state = await rollbackRemember(site);
        return {
          ok: false,
          remembered: state.remembered,
          permissionRemaining: false,
          registrationRemaining: false,
          dataRemaining: state.preferenceRemaining || state.sourceRemaining,
          origin: site.origin,
          error: state.clean
            ? `Could not enable automatic conversion: ${errorMessage(error)}. The site setting was rolled back.`
            : `Could not enable automatic conversion: ${errorMessage(error)}. Some saved site data remains; try again.`
        };
      }
    }

    async function forget(originValue) {
      const site = normalizeSite(originValue);
      if (!site) return { ok: false, error: "This page is not a supported website." };
      return runMutation(() => forgetWithinMutation(site));
    }

    async function forgetWithinMutation(site) {
      const failures = [];
      try {
        await removeRememberedData(site);
      } catch (error) {
        failures.push(errorMessage(error));
      }

      let state;
      try {
        state = await inspectState(site);
      } catch (error) {
        failures.push(errorMessage(error));
        state = failedInspectionState();
      }

      if (failures.length || !state.clean) {
        const remaining = state.preferenceRemaining || state.sourceRemaining
          ? "; remaining: saved site data"
          : "";
        return {
          ok: false,
          remembered: state.remembered,
          permissionRemaining: false,
          registrationRemaining: false,
          dataRemaining: state.preferenceRemaining || state.sourceRemaining,
          origin: site.origin,
          error: `Site-access cleanup is incomplete${remaining}. Try turning automatic conversion off again.${
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

    async function rollbackRemember(site) {
      try {
        await removeRememberedData(site);
      } catch (_error) {
        // Inspect the final storage state after the cleanup attempt.
      }
      try {
        return await inspectState(site);
      } catch (_error) {
        return failedInspectionState();
      }
    }

    function failedInspectionState() {
      return {
        clean: false,
        remembered: true,
        preferenceRemaining: true,
        sourceRemaining: true
      };
    }

    async function inspectState(site) {
      const [preferences, siteSources] = await Promise.all([
        getPreferences(),
        getSourceCurrencies()
      ]);
      const preferenceRemaining = preferences[site.origin] === true ||
        preferences[site.hostname] === true;
      const sourceRemaining = Object.hasOwn(siteSources, site.origin) ||
        Object.hasOwn(siteSources, site.hostname);
      return {
        clean: !preferenceRemaining && !sourceRemaining,
        remembered: preferenceRemaining,
        preferenceRemaining,
        sourceRemaining
      };
    }

    async function resolveSettingsForOrigin(globalSettings, originValue, supportedCodes) {
      const site = normalizeSite(originValue);
      if (!site || !(await isRemembered(site))) return { ...globalSettings };

      const siteSources = await getSourceCurrencies();
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

    async function findTargetCurrencyConflict(targetCurrency, globalSettings, activeSite) {
      if (
        globalSettings.fromCurrency !== "AUTO" &&
        globalSettings.fromCurrency === targetCurrency
      ) {
        return `The target ${targetCurrency} matches your default source currency. Change the default source first.`;
      }

      const [preferences, siteSources] = await Promise.all([
        getPreferences(),
        getSourceCurrencies()
      ]);
      for (const [origin, sourceCurrency] of Object.entries(siteSources)) {
        if (
          origin === activeSite?.origin ||
          preferences[origin] !== true ||
          sourceCurrency === "AUTO" ||
          sourceCurrency !== targetCurrency
        ) continue;
        const site = normalizeSite(origin);
        if (!site || !(await isRemembered(site))) continue;
        return `The target ${targetCurrency} matches the saved source for ${site.hostname}. Change that site's source first.`;
      }
      return null;
    }

    async function updateRememberedSettingsWithinMutation(
      site,
      settings,
      globalSettings,
      currentSettings,
      supportedCodes
    ) {
      if (!(await isRemembered(site))) {
        return {
          ok: false,
          settings: currentSettings,
          error: "This site's automatic-access state changed. Reopen the popup and try again."
        };
      }
      if (settings.fromCurrency !== "AUTO" && !supportedCodes.includes(settings.fromCurrency)) {
        return { ok: false, settings: currentSettings, error: "Unsupported source currency." };
      }

      const previousSources = await getSourceCurrencies();
      const nextSources = { ...previousSources, [site.origin]: settings.fromCurrency };
      delete nextSources[site.hostname];
      const sourceChanged = previousSources[site.origin] !== settings.fromCurrency ||
        Object.hasOwn(previousSources, site.hostname);
      const nextGlobalSettings = {
        ...settings,
        fromCurrency: globalSettings.fromCurrency
      };
      const globalChanged = !settingsSchema.snapshotEquals(nextGlobalSettings, globalSettings);

      try {
        if (sourceChanged) {
          await api.storage.local.set({ [SITE_SOURCE_CURRENCIES_KEY]: nextSources });
        }
      } catch (error) {
        return {
          ok: false,
          settings: currentSettings,
          error: `Could not save this site's source currency: ${errorMessage(error)}.`
        };
      }

      try {
        if (globalChanged) await api.storage.sync.set(nextGlobalSettings);
      } catch (error) {
        let rollbackFailed = false;
        if (sourceChanged) {
          try {
            await api.storage.local.set({ [SITE_SOURCE_CURRENCIES_KEY]: previousSources });
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

    async function reconcile(supportedCodes) {
      return runMutation(async () => {
        await cleanupLegacyArtifacts();
        const codes = supportedCodes || await loadSupportedCodes();
        const preferences = await getPreferences();
        const normalizedPreferences = {};

        for (const [key, remembered] of Object.entries(preferences)) {
          if (!remembered || pageAccess.unsupportedPageMessage(key)) continue;
          const site = normalizeSite(key);
          if (!site || site.origin === REQUIRED_PROVIDER_ORIGIN) continue;
          normalizedPreferences[site.origin] = true;
        }

        await api.storage.local.set({ [SITE_PREFERENCES_KEY]: normalizedPreferences });
        await reconcileSourceCurrencies(normalizedPreferences, codes);
      });
    }

    async function loadSupportedCodes() {
      const catalog = await (
        typeof catalogService.getCachedCurrencies === "function"
          ? catalogService.getCachedCurrencies()
          : catalogService.getCurrencies()
      );
      catalogService.getCurrencies().catch(() => {});
      return catalog.currencies.map((currency) => currency.code);
    }

    async function cleanupLegacyArtifacts() {
      const registered = await api.scripting.getRegisteredContentScripts();
      const legacyIds = registered
        .filter((script) => script.id?.startsWith("ccp_site_"))
        .map((script) => script.id);
      if (legacyIds.length) {
        await api.scripting.unregisterContentScripts({ ids: legacyIds });
      }
      await api.storage.local.remove(LEGACY_SITE_ACCESS_KEYS);
    }

    async function reconcileSourceCurrencies(preferences, supportedCodes) {
      const siteSources = await getSourceCurrencies();
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
      await api.storage.local.set({ [SITE_SOURCE_CURRENCIES_KEY]: normalizedSources });
    }

    async function getPreferences() {
      const stored = await api.storage.local.get(SITE_PREFERENCES_KEY);
      return { ...(stored[SITE_PREFERENCES_KEY] || {}) };
    }

    async function getSourceCurrencies() {
      const stored = await api.storage.local.get(SITE_SOURCE_CURRENCIES_KEY);
      return { ...(stored[SITE_SOURCE_CURRENCIES_KEY] || {}) };
    }

    async function isRemembered(site) {
      if (site.origin === REQUIRED_PROVIDER_ORIGIN) return false;
      const preferences = await getPreferences();
      return preferences[site.origin] === true;
    }

    async function removeRememberedData(site) {
      const preferences = await getPreferences();
      const siteSources = await getSourceCurrencies();
      delete preferences[site.origin];
      delete preferences[site.hostname];
      delete siteSources[site.origin];
      delete siteSources[site.hostname];
      await api.storage.local.set({
        [SITE_PREFERENCES_KEY]: preferences,
        [SITE_SOURCE_CURRENCIES_KEY]: siteSources
      });
    }

    function normalizeSite(value) {
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
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
      } catch (_error) {
        // Fall through to the generic invalid-page explanation.
      }
      return "This page cannot be remembered.";
    }

    function providerSiteMemoryError(site) {
      if (site?.origin !== REQUIRED_PROVIDER_ORIGIN) return null;
      return "This exchange-rate provider cannot be enabled for automatic page conversion.";
    }

    function errorMessage(error) {
      return error instanceof Error && error.message
        ? error.message
        : "an extension cleanup step failed";
    }

    return Object.freeze({
      findTargetCurrencyConflict,
      forget,
      getSourceCurrencies,
      getStatus,
      isRemembered,
      normalizeSite,
      reconcile,
      remember,
      resolveSettingsForOrigin,
      runMutation,
      siteMemoryError,
      updateRememberedSettingsWithinMutation,
      waitForMutations
    });
  }

  const service = createSitePreferences({
    api: global.ExtensionAPI,
    pageAccess: global.CurrencyPageAccess,
    catalogService: global.CurrencyCatalogService,
    settingsSchema: global.CurrencySettings
  });
  global.CurrencySitePreferences = Object.freeze({ ...service, create: createSitePreferences });
})(globalThis);
