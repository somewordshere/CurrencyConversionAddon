(function initializeRateHistoryService(global) {
  const CACHE_KEY = "rateHistoryCache";
  const CACHE_VERSION = 1;
  const FRESH_FOR_MS = 12 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 5000;
  const WINDOW_DAYS = 9;
  const MAX_CACHED_PAIRS = 8;
  const MIN_POINTS = 2;

  const pendingRequests = new Map();
  let cacheWriteQueue = Promise.resolve();

  // The sparkline is decorative: every failure resolves to { ok: false } so a
  // history outage can never take the popup's live rate down with it.
  async function getHistory(baseCurrency, quoteCurrency) {
    if (!isCurrencyCode(baseCurrency) || !isCurrencyCode(quoteCurrency)) {
      return { ok: false, error: "A base and quote currency are required." };
    }
    if (baseCurrency === quoteCurrency) {
      return { ok: false, error: "The base and quote currency must differ." };
    }

    const pairKey = `${baseCurrency}:${quoteCurrency}`;
    if (pendingRequests.has(pairKey)) return pendingRequests.get(pairKey);
    const request = loadHistory(pairKey, baseCurrency, quoteCurrency)
      .catch(() => ({ ok: false, error: "Rate history is unavailable." }))
      .finally(() => pendingRequests.delete(pairKey));
    pendingRequests.set(pairKey, request);
    return request;
  }

  async function loadHistory(pairKey, baseCurrency, quoteCurrency) {
    const cached = await readCachedPair(pairKey);
    if (isFresh(cached)) return buildSuccess(cached, true);

    try {
      const points = await fetchSeries(baseCurrency, quoteCurrency);
      if (points.length < MIN_POINTS) {
        throw new Error("The rate provider returned too few history points.");
      }
      const entry = { fetchedAt: new Date().toISOString(), points };
      await savePair(pairKey, entry);
      return buildSuccess(entry, false);
    } catch (error) {
      if (cached?.points?.length >= MIN_POINTS) return buildSuccess(cached, true);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Rate history is unavailable."
      };
    }
  }

  async function fetchSeries(baseCurrency, quoteCurrency) {
    const end = new Date();
    const start = new Date(end.getTime() - (WINDOW_DAYS * 24 * 60 * 60 * 1000));
    const url = "https://api.frankfurter.dev/v2/rates" +
      `?from=${toIsoDate(start)}&to=${toIsoDate(end)}` +
      `&base=${encodeURIComponent(baseCurrency)}&quotes=${encodeURIComponent(quoteCurrency)}`;

    const response = await CurrencyHttp.fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Could not fetch rate history (${response.status}).`);
    return sanitizeSeries(await response.json());
  }

  // The provider answers with a flat array of { date, base, quote, rate }.
  function sanitizeSeries(value) {
    if (!Array.isArray(value)) return [];
    const byDate = new Map();
    for (const item of value) {
      const date = typeof item?.date === "string" ? item.date : null;
      const rate = Number(item?.rate);
      if (!date || !Number.isFinite(rate) || rate <= 0) continue;
      byDate.set(date, rate);
    }
    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, rate]) => ({ date, rate }));
  }

  function buildSuccess(entry, cached) {
    const points = entry.points;
    const rates = points.map((point) => point.rate);
    const first = rates[0];
    const last = rates[rates.length - 1];
    return {
      ok: true,
      cached,
      points,
      low: Math.min(...rates),
      high: Math.max(...rates),
      changeRatio: first > 0 ? (last - first) / first : 0
    };
  }

  async function readCachedPair(pairKey) {
    const stored = await ExtensionAPI.storage.local.get(CACHE_KEY);
    const cache = stored[CACHE_KEY];
    return cache?.version === CACHE_VERSION ? cache.pairs?.[pairKey] || null : null;
  }

  function savePair(pairKey, entry) {
    cacheWriteQueue = cacheWriteQueue.then(async () => {
      const stored = await ExtensionAPI.storage.local.get(CACHE_KEY);
      const cache = stored[CACHE_KEY];
      const existing = cache?.version === CACHE_VERSION ? cache.pairs || {} : {};
      const pairs = { ...existing, [pairKey]: entry };
      for (const key of stalestKeys(pairs, MAX_CACHED_PAIRS)) delete pairs[key];
      await ExtensionAPI.storage.local.set({
        [CACHE_KEY]: { version: CACHE_VERSION, pairs }
      });
    }).catch(() => {});
    return cacheWriteQueue;
  }

  function stalestKeys(pairs, keep) {
    const keys = Object.keys(pairs);
    if (keys.length <= keep) return [];
    return keys
      .sort((left, right) => Date.parse(pairs[right].fetchedAt || 0) - Date.parse(pairs[left].fetchedAt || 0))
      .slice(keep);
  }

  function isFresh(entry) {
    if (!entry?.points?.length) return false;
    const fetchedAt = Date.parse(entry.fetchedAt || "");
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < FRESH_FOR_MS;
  }

  function isCurrencyCode(value) {
    return typeof value === "string" && /^[A-Z]{3}$/.test(value);
  }

  function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  global.CurrencyRateHistoryService = Object.freeze({
    getHistory,
    sanitizeSeries
  });
})(globalThis);
