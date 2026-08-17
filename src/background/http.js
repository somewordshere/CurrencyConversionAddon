(function initializeBackgroundHttp(global) {
  const DEFAULT_TIMEOUT_MS = 5000;

  async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  global.CurrencyHttp = Object.freeze({ DEFAULT_TIMEOUT_MS, fetchWithTimeout });
})(globalThis);
