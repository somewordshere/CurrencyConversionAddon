(function initializeCatalogSnapshot(global) {
  // Reads the catalog without waiting on the network, then kicks off a refresh
  // that the next caller benefits from. The getCachedCurrencies guard keeps this
  // working against catalog services that only implement the blocking read.
  async function read(service) {
    const catalog = await (
      typeof service.getCachedCurrencies === "function"
        ? service.getCachedCurrencies()
        : service.getCurrencies()
    );
    service.getCurrencies().catch(() => {});
    return catalog;
  }

  async function readCodes(service) {
    const catalog = await read(service);
    return catalog.currencies.map((currency) => currency.code);
  }

  global.CurrencyCatalogSnapshot = Object.freeze({ read, readCodes });
})(globalThis);
