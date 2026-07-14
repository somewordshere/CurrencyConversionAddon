(function initializeRateService(global) {
  const { CURRENCY_CODES: FALLBACK_CURRENCY_CODES } = global.CurrencyCatalog;
  const CACHE_KEY = "ratesCache";
  const CACHE_VERSION = 3;
  const FRESH_FOR_MS = 18 * 60 * 60 * 1000;
  const WARN_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
  const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 5000;
  const RATE_PROVIDER = "Frankfurter";
  let cacheWriteQueue = Promise.resolve();
  const pendingRequests = new Map();

  async function getRates(baseCurrency) {
    const catalog = await CurrencyCatalogService.getCurrencies();
    const supportedCodes = catalog.currencies.map((currency) => currency.code);
    if (!supportedCodes.includes(baseCurrency)) {
      return { ok: false, error: `Unsupported source currency: ${baseCurrency}.` };
    }

    if (pendingRequests.has(baseCurrency)) return pendingRequests.get(baseCurrency);
    const request = loadRates(baseCurrency, supportedCodes).finally(() => pendingRequests.delete(baseCurrency));
    pendingRequests.set(baseCurrency, request);
    return request;
  }

  async function loadRates(baseCurrency, supportedCodes) {
    const cachedBase = await readCachedBase(baseCurrency);
    if (isFresh(cachedBase, supportedCodes)) return buildSuccess(cachedBase, true, false);

    try {
      const quotes = supportedCodes.filter((currency) => currency !== baseCurrency);
      const url = `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(baseCurrency)}&quotes=${quotes.join(",")}`;
      const response = await fetchWithRetry(url);

      if (!response.ok) throw new Error(`Could not fetch exchange rates (${response.status}).`);
      const parsed = parseRatesResponse(await response.json());
      const rates = sanitizeRates(parsed.rates, supportedCodes);
      if (!Object.keys(rates).length) {
        throw new Error("The exchange-rate service returned no usable rates.");
      }

      const baseCache = {
        fetchedAt: new Date().toISOString(),
        rateDate: parsed.date || new Date().toISOString().slice(0, 10),
        catalogSignature: supportedCodes.join(","),
        rates: { ...rates, [baseCurrency]: 1 }
      };
      await saveBaseRates(baseCurrency, baseCache);
      return buildSuccess(baseCache, false, false);
    } catch (error) {
      if (cachedBase?.rates && Object.keys(cachedBase.rates).length > 1) {
        const cacheAgeMs = getCacheAgeMs(cachedBase);
        const cacheAgeLabel = describeAge(cacheAgeMs);
        if (!Number.isFinite(cacheAgeMs) || cacheAgeMs > MAX_STALE_AGE_MS) {
          return {
            ok: false,
            error: `Live rates are unavailable and the cached rates are ${cacheAgeLabel}. Refusing to use rates older than 7 days.`
          };
        }
        const liveError = error instanceof Error ? error.message : "Live rates are unavailable.";
        return {
          ...buildSuccess(cachedBase, true, true),
          warning: cacheAgeMs >= WARN_STALE_AFTER_MS
            ? `${liveError} Using cached rates that are ${cacheAgeLabel}.`
            : liveError
        };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not load exchange rates."
      };
    }
  }

  async function readCachedBase(baseCurrency) {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const cache = stored[CACHE_KEY];
    return cache?.version === CACHE_VERSION ? cache.bases?.[baseCurrency] || null : null;
  }

  function isFresh(entry, supportedCodes = null) {
    if (supportedCodes && entry?.catalogSignature !== supportedCodes.join(",")) return false;
    return getCacheAgeMs(entry) < FRESH_FOR_MS;
  }

  function getCacheAgeMs(entry) {
    const fetchedAt = Date.parse(entry?.fetchedAt || "");
    return Number.isFinite(fetchedAt) ? Math.max(0, Date.now() - fetchedAt) : Infinity;
  }

  function describeAge(ageMs) {
    if (!Number.isFinite(ageMs)) return "of unknown age";
    const minutes = Math.floor(ageMs / (60 * 1000));
    if (minutes < 1) return "less than a minute old";
    if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} old`;
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    return `${days} day${days === 1 ? "" : "s"} old`;
  }

  function buildSuccess(entry, cached, stale) {
    const cacheAgeMs = cached ? getCacheAgeMs(entry) : 0;
    return {
      ok: true,
      rates: entry.rates,
      date: entry.rateDate || null,
      fetchedAt: entry.fetchedAt || null,
      provider: RATE_PROVIDER,
      cached,
      stale,
      cacheAgeMs,
      cacheAgeLabel: cached ? describeAge(cacheAgeMs) : null
    };
  }

  async function saveBaseRates(baseCurrency, baseCache) {
    cacheWriteQueue = cacheWriteQueue.catch(() => {}).then(async () => {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const cache = stored[CACHE_KEY];
      const existingBases = cache?.version === CACHE_VERSION ? cache.bases || {} : {};
      await chrome.storage.local.set({
        [CACHE_KEY]: {
          version: CACHE_VERSION,
          bases: { ...existingBases, [baseCurrency]: baseCache }
        }
      });
    });
    await cacheWriteQueue;
  }

  function parseRatesResponse(data) {
    if (Array.isArray(data)) {
      const rates = {};
      let date = null;
      for (const item of data) {
        if (item?.quote && Number.isFinite(item.rate)) {
          rates[item.quote] = item.rate;
          date ||= item.date || null;
        }
      }
      return { rates, date };
    }

    if (data?.rates && typeof data.rates === "object") {
      return { rates: data.rates, date: data.date || null };
    }
    return { rates: {}, date: null };
  }

  function sanitizeRates(rates, supportedCodes = FALLBACK_CURRENCY_CODES) {
    return Object.fromEntries(Object.entries(rates || {}).filter(([currency, rate]) =>
      supportedCodes.includes(currency) && Number.isFinite(rate) && rate > 0
    ));
  }

  async function fetchWithRetry(url) {
    let lastResponse;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        lastResponse = await fetchWithTimeout(url);
        if (lastResponse.ok || ![408, 429].includes(lastResponse.status) && lastResponse.status < 500) {
          return lastResponse;
        }
      } catch (error) {
        if (attempt === 2) throw error;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    return lastResponse;
  }

  async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  global.CurrencyRateService = Object.freeze({
    getRates,
    parseRatesResponse,
    sanitizeRates,
    isFresh,
    getCacheAgeMs,
    describeAge,
    fetchWithRetry,
    fetchWithTimeout
  });
})(globalThis);
