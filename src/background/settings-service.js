(function initializeSettingsService(global) {
  function createSettingsService({
    api,
    catalogService,
    rateService,
    currencyCatalog,
    settingsSchema,
    sitePreferences,
    catalogSnapshot = global.CurrencyCatalogSnapshot
  }) {
    async function initializeDefaults() {
      const catalog = await resolveService(catalogService, "catalog").getCurrencies();
      const supportedCodes = catalog.currencies.map((currency) => currency.code);
      const stored = await api.storage.sync.get(settingsSchema.KEYS);
      await api.storage.sync.set(settingsSchema.sanitize(stored, supportedCodes));
      await api.storage.local.remove("favoriteCurrencies");
      return supportedCodes;
    }

    async function getSettings(originValue) {
      await sitePreferences.waitForMutations();
      const catalog = await getCatalogSnapshot();
      const supportedCodes = catalog.currencies.map((currency) => currency.code);
      const globalSettings = await getGlobalSettings(supportedCodes);
      const settings = await sitePreferences.resolveSettingsForOrigin(
        globalSettings,
        originValue,
        supportedCodes
      );
      return { ok: true, settings };
    }

    async function getGlobalSettings(supportedCodes = currencyCatalog.CURRENCY_CODES) {
      const stored = await api.storage.sync.get(settingsSchema.KEYS);
      return settingsSchema.sanitize(stored, supportedCodes);
    }

    async function getAvailableCurrencies() {
      const catalog = await getCatalogSnapshot();
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
      return sitePreferences.runMutation(() => updateSettingsWithinMutation(payload, originValue));
    }

    async function updateSettingsWithinMutation(payload, originValue) {
      const catalog = await getCatalogSnapshot();
      const supportedCodes = catalog.currencies.map((currency) => currency.code);
      const globalSettings = await getGlobalSettings(supportedCodes);
      const currentSettings = await sitePreferences.resolveSettingsForOrigin(
        globalSettings,
        originValue,
        supportedCodes
      );
      const settings = settingsSchema.sanitize(
        { ...currentSettings, ...payload },
        supportedCodes
      );

      if (settings.fromCurrency === settings.toCurrency) {
        return { ok: false, error: "Choose two different currencies." };
      }

      const pairChanged = settings.fromCurrency !== currentSettings.fromCurrency ||
        settings.toCurrency !== currentSettings.toCurrency;
      if (pairChanged && settings.fromCurrency !== "AUTO") {
        const rates = await resolveService(rateService, "rate").getRates(settings.fromCurrency);
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

      const site = sitePreferences.normalizeSite(originValue);
      const remembered = site ? await sitePreferences.isRemembered(site) : false;
      if (settings.toCurrency !== globalSettings.toCurrency) {
        const conflict = await sitePreferences.findTargetCurrencyConflict(
          settings.toCurrency,
          remembered ? globalSettings.fromCurrency : settings.fromCurrency,
          site
        );
        if (conflict) {
          return { ok: false, settings: currentSettings, error: conflict };
        }
      }
      if (remembered) {
        return sitePreferences.updateRememberedSettingsWithinMutation(
          site,
          settings,
          globalSettings,
          currentSettings,
          supportedCodes
        );
      }

      await api.storage.sync.set(settings);
      return { ok: true, settings };
    }

    async function rememberSite(originValue) {
      return sitePreferences.remember(originValue, async () => {
        const catalog = await getCatalogSnapshot();
        const supportedCodes = catalog.currencies.map((currency) => currency.code);
        const settings = await getGlobalSettings(supportedCodes);
        return settings.fromCurrency;
      });
    }

    async function getCatalogSnapshot() {
      return catalogSnapshot.read(resolveService(catalogService, "catalog"));
    }

    return Object.freeze({
      getAvailableCurrencies,
      getGlobalSettings,
      getSettings,
      initializeDefaults,
      rememberSite,
      sanitizeSettings: settingsSchema.sanitize,
      updateSettings
    });
  }

  function resolveService(serviceOrSupplier, name) {
    const service = typeof serviceOrSupplier === "function"
      ? serviceOrSupplier()
      : serviceOrSupplier;
    if (!service || typeof service !== "object") {
      throw new TypeError(`Currency settings requires a ${name} service.`);
    }
    return service;
  }

  const service = createSettingsService({
    api: global.ExtensionAPI,
    catalogService: () => global.CurrencyCatalogService,
    rateService: () => global.CurrencyRateService,
    currencyCatalog: global.CurrencyCatalog,
    settingsSchema: global.CurrencySettings,
    sitePreferences: global.CurrencySitePreferences
  });
  global.CurrencySettingsService = Object.freeze({ ...service, create: createSettingsService });
})(globalThis);
