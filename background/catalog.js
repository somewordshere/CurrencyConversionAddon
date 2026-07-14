(function initializeProviderCurrencyCatalog(global) {
  const CACHE_KEY = "providerCurrencyCatalog";
  const CACHE_VERSION = 1;
  const FRESH_FOR_MS = 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 5000;
  const CATALOG_URL = "https://api.frankfurter.dev/v2/currencies";
  let pendingRequest = null;

  async function getCurrencies({ forceRefresh = false } = {}) {
    if (pendingRequest) return pendingRequest;
    pendingRequest = loadCurrencies(forceRefresh).finally(() => {
      pendingRequest = null;
    });
    return pendingRequest;
  }

  async function loadCurrencies(forceRefresh) {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const cache = stored[CACHE_KEY];
    if (!forceRefresh && isFresh(cache)) return buildResult(cache.currencies, true, false);

    try {
      const response = await fetchWithTimeout(CATALOG_URL);
      if (!response.ok) throw new Error(`Could not refresh currencies (${response.status}).`);
      const currencies = sanitizeCurrencyResponse(await response.json());
      if (currencies.length < 2) throw new Error("The currency provider returned no usable catalog.");
      await chrome.storage.local.set({
        [CACHE_KEY]: {
          version: CACHE_VERSION,
          fetchedAt: new Date().toISOString(),
          currencies
        }
      });
      return buildResult(currencies, false, false);
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Could not refresh currencies.";
      if (isUsableCache(cache)) return buildResult(cache.currencies, true, true, warning);
      return buildResult(buildFallbackCurrencies(), true, true, warning);
    }
  }

  function sanitizeCurrencyResponse(value) {
    if (!Array.isArray(value)) return [];
    const currencies = new Map();
    for (const item of value) {
      const code = String(item?.iso_code || "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      currencies.set(code, {
        code,
        name: String(item.name || code).trim() || code,
        symbol: typeof item.symbol === "string" && item.symbol.trim() ? item.symbol.trim() : null,
        startDate: typeof item.start_date === "string" ? item.start_date : null,
        endDate: typeof item.end_date === "string" ? item.end_date : null
      });
    }
    return [...currencies.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  function buildFallbackCurrencies() {
    let displayNames;
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "currency" });
    } catch (_error) {
      displayNames = null;
    }
    return CurrencyCatalog.CURRENCY_CODES.map((code) => ({
      code,
      name: displayNames?.of(code) || code,
      symbol: CurrencyCatalog.CURRENCY_META[code]?.symbols?.[0] || null,
      startDate: null,
      endDate: null
    }));
  }

  function isUsableCache(cache) {
    return cache?.version === CACHE_VERSION && Array.isArray(cache.currencies) && cache.currencies.length > 1;
  }

  function isFresh(cache) {
    if (!isUsableCache(cache)) return false;
    const fetchedAt = Date.parse(cache.fetchedAt || "");
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < FRESH_FOR_MS;
  }

  function buildResult(currencies, cached, stale, warning = null) {
    return { ok: true, currencies, cached, stale, warning };
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

  global.CurrencyCatalogService = Object.freeze({
    getCurrencies,
    sanitizeCurrencyResponse,
    buildFallbackCurrencies,
    isFresh,
    fetchWithTimeout
  });
})(globalThis);
