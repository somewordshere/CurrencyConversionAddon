(function initializeCurrencyDetector(global) {
  const {
    CURRENCY_META,
    CURRENCY_CODES,
    CONTEXT_REQUIRED_SYMBOLS
  } = global.CurrencyCatalog;
  const {
    NUMBER_CAPTURE,
    parseLocaleNumber,
    buildMarkerPattern
  } = global.CurrencyNumberParser;
  const SYMBOL_GROUPS = createSymbolGroups();
  const CURRENCY_CODE_PATTERN = new RegExp(
    `(?<![A-Za-z])(${CURRENCY_CODES.join("|")})(?![A-Za-z])`,
    "g"
  );
  const WORD_LIKE_CURRENCY_CODES = new Set(["AMD", "MAD", "TRY"]);
  const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR"]);
  const NON_PRICE_CONTEXT_PATTERN =
    /\b(?:available|availability|delivery|items?|left|quantity|rating|reviews?|stock|stück|stueck|verfügbar|lieferung|anzahl|оцінок|наявност[іи]|товар(?:ів|а)?|залишилось)\b/iu;
  let pageCurrencyDetection = null;

  function resetPageCurrencyDetection() {
    pageCurrencyDetection = null;
  }

  function getPageCurrencyDetection() {
    pageCurrencyDetection ||= detectPageCurrency();
    return pageCurrencyDetection;
  }

  function findMatchesForContext(text, element, settings, { selection = false } = {}) {
    const detection = getPageCurrencyDetection();
    const manualCurrency = settings.fromCurrency !== "AUTO"
      ? settings.fromCurrency
      : null;
    const allowBare = manualCurrency
      ? selection || (
        isLikelyStandalonePriceText(text, element) &&
        !hasMarkedPriceInContainer(element)
      )
      : detection.confidence === "high" && (
        selection || (
          isLikelyStandalonePriceText(text, element) &&
          !hasMarkedPriceInContainer(element)
        )
      );

    return findCurrencyMatches(text, {
      forcedCurrency: manualCurrency,
      allowBare,
      pageDetection: detection
    }).filter((match) =>
      match.currency !== settings.toCurrency &&
      (selection || !isLikelyLinkedTitle(text, element, match)) &&
      (
        match.strength !== "code" ||
        !WORD_LIKE_CURRENCY_CODES.has(match.currency) ||
        detection.currency === match.currency ||
        (
          manualCurrency === match.currency &&
          isLikelyPriceElement(element)
        )
      )
    );
  }

  function isLikelyLinkedTitle(text, element, match) {
    const link = element?.closest?.("a[href]");
    if (!link || isLikelyPriceElement(element)) return false;
    const surroundingText = `${text.slice(0, match.index)} ${text.slice(match.index + match.raw.length)}`;
    return (surroundingText.match(/\p{L}{2,}/gu) || []).length >= 2;
  }

  function findCurrencyMatches(
    text,
    { forcedCurrency = null, allowBare = false, pageDetection = getPageCurrencyDetection() } = {}
  ) {
    if (!text?.trim()) {
      return [];
    }

    if (forcedCurrency) {
      const marked = findMarkedMatchesForCurrency(text, forcedCurrency);
      return marked.length
        ? marked
        : allowBare
          ? findBareMatches(text, forcedCurrency)
          : [];
    }

    const matches = [];
    const upperText = text.toUpperCase();
    const lowerText = text.toLocaleLowerCase();

    for (const currency of CURRENCY_CODES) {
      if (!upperText.includes(currency)) continue;
      matches.push(...findMatchesWithMarkers(text, [currency], currency, "code"));
    }

    for (const group of SYMBOL_GROUPS) {
      if (!group.markers.some((marker) => lowerText.includes(marker.toLocaleLowerCase()))) {
        continue;
      }
      const needsContext = group.markers.some((marker) =>
        CONTEXT_REQUIRED_SYMBOLS.has(marker.toLocaleLowerCase())
      );
      let currency =
        group.currencies.length === 1 && !needsContext
          ? group.currencies[0]
          : null;

      if (
        !currency &&
        pageDetection.currency &&
        pageDetection.confidence !== "low" &&
        group.currencies.includes(pageDetection.currency)
      ) {
        currency = pageDetection.currency;
      }

      if (currency) {
        matches.push(
          ...findMatchesWithMarkers(text, group.markers, currency, "symbol")
        );
      }
    }

    const merged = mergeNonOverlappingMatches(matches);

    if (!merged.length && allowBare && pageDetection.currency) {
      return findBareMatches(text, pageDetection.currency);
    }

    return merged;
  }

  function findMarkedMatchesForCurrency(text, currency) {
    const meta = CURRENCY_META[currency];

    if (!meta) {
      return findMatchesWithMarkers(text, [currency], currency, "code");
    }

    return mergeNonOverlappingMatches([
      ...findMatchesWithMarkers(text, [currency], currency, "code"),
      ...findMatchesWithMarkers(text, meta.symbols, currency, "symbol")
    ]);
  }

  function hasCurrencyMarker(text, currency) {
    const meta = CURRENCY_META[currency];
    const markers = [currency, ...(meta?.symbols || [])];
    const markerPattern = [...new Set(markers)]
      .map(buildMarkerPattern)
      .sort((a, b) => b.length - a.length)
      .join("|");
    return Boolean(markerPattern && new RegExp(`(?:${markerPattern})`, "iu").test(text || ""));
  }

  function findMatchesWithMarkers(text, markers, currency, strength) {
    const markerPattern = [...new Set(markers)]
      .map(buildMarkerPattern)
      .sort((a, b) => b.length - a.length)
      .join("|");

    if (!markerPattern) {
      return [];
    }

    const regex = new RegExp(
      `(?:(?:${markerPattern})[\\s\\u00a0\\u202f]*${NUMBER_CAPTURE}(?![\\p{L}\\p{N}.,\\uFF0C\\uFF0E])|(?<![\\p{L}\\p{N}])${NUMBER_CAPTURE}[\\s\\u00a0\\u202f]*(?:${markerPattern}))`,
      "giu"
    );
    const results = [];
    let found;

    while ((found = regex.exec(text)) !== null) {
      const amount = parseLocaleNumber(found[1] || found[2], {
        allowThreeDecimals: THREE_DECIMAL_CURRENCIES.has(currency)
      });

      if (Number.isFinite(amount)) {
        results.push({
          raw: found[0],
          amount,
          currency,
          index: found.index,
          strength
        });
      }
    }

    return results;
  }

  function findBareMatches(text, currency) {
    const regex = new RegExp(
      `(?<![\\p{L}\\p{N}])${NUMBER_CAPTURE}(?![\\p{L}\\p{N}])`,
      "gu"
    );
    const results = [];
    let found;

    while ((found = regex.exec(text)) !== null) {
      const before = text.slice(0, found.index).trimEnd();
      const after = text.slice(found.index + found[0].length).trimStart();

      if (before.endsWith("%") || after.startsWith("%")) {
        continue;
      }

      const amount = parseLocaleNumber(found[1], {
        allowThreeDecimals: THREE_DECIMAL_CURRENCIES.has(currency)
      });

      if (Number.isFinite(amount)) {
        results.push({
          raw: found[0],
          amount,
          currency,
          index: found.index,
          strength: "bare"
        });
      }
    }

    return results;
  }

  function mergeNonOverlappingMatches(matches) {
    const strength = { code: 3, symbol: 2, bare: 1 };
    const sorted = [...matches].sort((a, b) =>
      a.index - b.index ||
      strength[b.strength] - strength[a.strength] ||
      b.raw.length - a.raw.length
    );
    const merged = [];

    for (const match of sorted) {
      const overlaps = merged.some((existing) =>
        match.index < existing.index + existing.raw.length &&
        existing.index < match.index + match.raw.length
      );

      if (!overlaps) {
        merged.push(match);
      }
    }

    return merged.sort((a, b) => a.index - b.index);
  }

  function detectPageCurrency() {
    const scores = Object.fromEntries(CURRENCY_CODES.map((code) => [code, 0]));
    const signals = Object.fromEntries(CURRENCY_CODES.map((code) => [code, []]));
    const add = (currency, points, signal) => {
      if (!scores[currency]) scores[currency] = 0;
      if (!signals[currency]) signals[currency] = [];
      scores[currency] += points;
      signals[currency].push(signal);
    };

    const selectors = [
      "meta[itemprop='priceCurrency']",
      "meta[property='product:price:currency']",
      "meta[name='priceCurrency']",
      "[itemprop='priceCurrency']",
      "[data-currency]",
      "input[name='currencyCode']",
      "input[name$='[currencyCode]']",
      "input[id='currencyCode']",
      "input[id$='[currencyCode]']"
    ];

    for (const element of document.querySelectorAll(selectors.join(","))) {
      const value =
        element.getAttribute("content") ||
        element.getAttribute("data-currency") ||
        element.getAttribute("value") ||
        element.textContent;
      const currency = normalizeCurrencyCode(value);
      if (currency) add(currency, 100, "structured metadata");
    }

    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        collectStructuredCurrencies(JSON.parse(script.textContent), (currency) => {
          add(currency, 100, "JSON-LD priceCurrency");
        });
      } catch (_error) {
        // Ignore invalid third-party JSON-LD.
      }
    }

    const embeddedPattern =
      /["'](?:priceCurrency|currencyCode|currency)["']\s*:\s*["']([A-Z]{3})["']/gi;
    const embeddedSources = document.querySelectorAll(
      "script:not([type='application/ld+json'])"
    );

    let inspectedScriptCharacters = 0;
    for (const script of embeddedSources) {
      if (inspectedScriptCharacters >= 500000) break;
      const source = script.textContent?.slice(0, 100000) || "";
      inspectedScriptCharacters += source.length;
      let embedded;
      while ((embedded = embeddedPattern.exec(source)) !== null) {
        const currency = normalizeCurrencyCode(embedded[1]);
        if (currency) add(currency, 75, "embedded shop data");
      }
      embeddedPattern.lastIndex = 0;
    }

    addLocationSignals(add);
    const bodyText = document.body?.innerText?.slice(0, 100000) || "";
    const codeCounts = {};
    let visibleCode;
    CURRENCY_CODE_PATTERN.lastIndex = 0;
    while ((visibleCode = CURRENCY_CODE_PATTERN.exec(bodyText)) !== null) {
      codeCounts[visibleCode[1]] = (codeCounts[visibleCode[1]] || 0) + 1;
    }
    for (const [currency, count] of Object.entries(codeCounts)) {
      add(currency, Math.min(30, count * 10), "visible currency code");
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [currency, score] = ranked[0];
    const secondScore = ranked[1]?.[1] || 0;
    const confidence =
      score >= 70 && score >= secondScore + 20
        ? "high"
        : score >= 30 && score >= secondScore + 10
          ? "medium"
          : "low";

    return {
      currency: score > 0 ? currency : null,
      confidence,
      score,
      signals: currency ? signals[currency] : []
    };
  }

  function addLocationSignals(add) {
    const language = document.documentElement.lang?.toLowerCase() || "";
    const domainMap = {
      ch: "CHF", jp: "JPY", cn: "CNY", uk: "GBP", pl: "PLN", cz: "CZK",
      tr: "TRY", in: "INR", kr: "KRW", br: "BRL", ca: "CAD", au: "AUD",
      nz: "NZD", sg: "SGD", hk: "HKD", mx: "MXN", se: "SEK", no: "NOK",
      dk: "DKK", za: "ZAR", us: "USD", ua: "UAH", ro: "RON", hu: "HUF",
      il: "ILS", th: "THB", id: "IDR", my: "MYR", ph: "PHP", vn: "VND",
      tw: "TWD", pk: "PKR", bd: "BDT", lk: "LKR", ng: "NGN", ke: "KES",
      eg: "EGP", ma: "MAD", qa: "QAR", kw: "KWD", bh: "BHD", om: "OMR",
      jo: "JOD", ge: "GEL", am: "AMD", az: "AZN", kz: "KZT", ae: "AED",
      sa: "SAR"
    };
    const euroDomains = new Set([
      "de", "fr", "es", "it", "nl", "at", "be", "ie", "pt", "fi", "gr",
      "sk", "si", "ee", "lv", "lt", "lu", "cy", "mt"
    ]);
    const addDomainSignal = (host, points, signal) => {
      const tld = host.toLowerCase().split(".").pop();
      const currency = euroDomains.has(tld) ? "EUR" : domainMap[tld];
      if (currency) add(currency, points, signal);
    };

    const currentHost = window.location.hostname;
    if (currentHost) addDomainSignal(currentHost, 20, "country domain");

    const canonicalUrl = document.querySelector("link[rel='canonical']")?.href;
    if (canonicalUrl) {
      try {
        const canonicalHost = new URL(canonicalUrl, window.location.href).hostname;
        if (canonicalHost && canonicalHost !== currentHost) {
          addDomainSignal(canonicalHost, 40, "canonical country domain");
        }
      } catch (_error) {
        // Ignore malformed third-party canonical URLs.
      }
    }

    const region = language.match(/-([a-z]{2})\b/)?.[1];
    let languageCurrency = domainMap[region];
    const languagePrefixes = {
      ja: "JPY", ko: "KRW", pl: "PLN", cs: "CZK", tr: "TRY", uk: "UAH",
      ro: "RON", hu: "HUF", he: "ILS", th: "THB", id: "IDR", ms: "MYR",
      vi: "VND", ka: "GEL", hy: "AMD", az: "AZN", kk: "KZT"
    };
    languageCurrency ||= languagePrefixes[language.split("-")[0]];
    if (languageCurrency) add(languageCurrency, 15, "page language");
  }

  function collectStructuredCurrencies(value, callback) {
    if (!value || typeof value !== "object") return;

    if (typeof value.priceCurrency === "string") {
      const currency = normalizeCurrencyCode(value.priceCurrency);
      if (currency) callback(currency);
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        collectStructuredCurrencies(child, callback);
      }
    }
  }

  function normalizeCurrencyCode(value) {
    const code = String(value || "").trim().toUpperCase();
    return CURRENCY_CODES.includes(code) ? code : null;
  }

  function isLikelyPriceElement(element) {
    let current = element;

    for (let level = 0; current && level < 2; level += 1, current = current.parentElement) {
      const attributes = [
        current.id,
        current.className,
        current.getAttribute?.("data-testid"),
        current.getAttribute?.("data-test"),
        current.getAttribute?.("itemprop"),
        current.getAttribute?.("aria-label")
      ]
        .filter((value) => typeof value === "string")
        .join(" ");

      if (/(availability|delivery|quantity|rating|review|stock|inventory)/i.test(attributes)) {
        return false;
      }

      if (/(price|pricing|preis|amount|cost|subtotal|total|summe)/i.test(attributes)) {
        return true;
      }
    }

    return false;
  }

  function isLikelyStandalonePriceText(text, element) {
    const trimmed = text?.trim();
    if (
      !trimmed ||
      trimmed.length > 40 ||
      NON_PRICE_CONTEXT_PATTERN.test(trimmed) ||
      /[A-Za-z\p{L}]{2,}/u.test(trimmed)
    ) {
      return false;
    }

    return isLikelyPriceElement(element);
  }

  function hasMarkedPriceInContainer(element) {
    const container = element?.parentElement;
    const text = container?.textContent?.trim();
    if (!text || text.length > 100) return false;

    return findCurrencyMatches(text, {
      allowBare: false,
      pageDetection: getPageCurrencyDetection()
    }).length > 0;
  }

  function describeDetectedCurrencies(...planGroups) {
    const currencies = new Set();
    for (const plans of planGroups) {
      for (const plan of plans) {
        for (const match of plan.matches) currencies.add(match.currency);
      }
    }
    return [...currencies].join(", ") || "none";
  }

  function createSymbolGroups() {
    const groups = new Map();
    for (const [currency, meta] of Object.entries(CURRENCY_META)) {
      for (const symbol of meta.symbols) {
        const key = symbol.toLocaleLowerCase();
        const group = groups.get(key) || { markers: [], currencies: [] };
        group.markers.push(symbol);
        if (!group.currencies.includes(currency)) group.currencies.push(currency);
        groups.set(key, group);
      }
    }
    return [...groups.values()];
  }

  global.CurrencyDetector = Object.freeze({
    resetPageCurrencyDetection,
    getPageCurrencyDetection,
    findMatchesForContext,
    findCurrencyMatches,
    hasCurrencyMarker,
    isLikelyPriceElement,
    describeDetectedCurrencies
  });
})(globalThis);
