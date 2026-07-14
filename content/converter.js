(function initializePageConverter(global) {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "SVG", "CANVAS"
  ]);
  const OWNED_SELECTOR = "ccp-conversion[data-ccp-owned='true']";
  const UI_SELECTOR = ".ccp-toast, .ccp-selection-popup, .ccp-page-prompt";
  const MAX_TEXT_NODES_PER_SCAN = 5000;
  const MAX_TEXT_NODES_INSPECTED_PER_SCAN = 20000;
  const MAX_SPLIT_CANDIDATES_PER_SCAN = 1000;
  const MAX_SHADOW_HOSTS_PER_SCAN = 10000;
  const MAX_PENDING_ROOTS = 100;
  const DOM_WRITE_BATCH_SIZE = 200;
  const POSSIBLE_PRICE_TEXT_PATTERN = /[0-9０-９]/;
  const QUICK_CURRENCY_MARKER_PATTERN = new RegExp(
    [...new Set(Object.entries(CurrencyCatalog.CURRENCY_META).flatMap(([currency, meta]) =>
      [currency, ...meta.symbols]
    ))]
      .map(CurrencyNumberParser.buildMarkerPattern)
      .sort((a, b) => b.length - a.length)
      .join("|") + "|(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])",
    "u"
  );
  const PRICE_FRAGMENT_SELECTOR = [
    ".a-offscreen",
    ".a-price-symbol",
    ".a-price-whole",
    ".a-price-decimal",
    ".a-price-fraction"
  ].join(",");
  const SPLIT_CANDIDATE_SELECTOR = [
    "[itemprop*='price' i]",
    "[class*='price' i]",
    "[id*='price' i]",
    "[data-price]",
    "[data-testid*='price' i]",
    "[aria-label*='price' i]"
  ].join(",");

  let settings = null;
  let activeRatesByBase = {};
  let activeRateMetaByBase = {};
  let currentConversion = null;
  let observer = null;
  let observerHandle = null;
  let observerUsesIdleCallback = false;
  let observedUrl = window.location.href;
  const pendingRoots = new Set();
  const observedShadowRoots = new WeakSet();

  function configure(nextSettings) {
    settings = nextSettings;
    activeRatesByBase = {};
    activeRateMetaByBase = {};
  }

  function runSiteConversion(options = {}) {
    if (!settings?.enabled) {
      return Promise.resolve({ ok: false, error: "Extension is turned off." });
    }

    if (currentConversion) return currentConversion;
    currentConversion = performConversion(options).finally(() => {
      currentConversion = null;
      if (pendingRoots.size) schedulePendingConversion();
    });
    return currentConversion;
  }

  async function performConversion({
    clearExisting = true,
    observe = true,
    roots = null
  } = {}) {
    if (clearExisting) removeConversionsOnly();
    const scanRoots = normalizeRoots(roots || [document.body]);
    const textScan = collectTextNodes(scanRoots);
    const textPlans = textScan.nodes
      .map((node) => ({
        node,
        originalText: node.nodeValue,
        matches: CurrencyDetector.findMatchesForContext(
          node.nodeValue,
          node.parentElement,
          settings
        )
      }))
      .filter((plan) => plan.matches.length);
    const splitPlans = collectSplitPricePlans(scanRoots);
    const bases = collectSourceCurrencies(textPlans, splitPlans);

    if (bases.size === 0) {
      if (observe) startWatching();
      return buildNoMatchesResult(textPlans, splitPlans);
    }

    const rateResults = await Promise.all([...bases].map(ensureRates));
    const rateError = rateResults.find((result) => !result.ok);
    const count = await applyPlansInBatches(textPlans, splitPlans);
    observer?.takeRecords();
    if (observe) startWatching();

    const usedMeta = [...bases]
      .map((base) => activeRateMetaByBase[base])
      .filter(Boolean);
    return {
      ok: count > 0,
      count,
      detectedCurrency: CurrencyDetector.getPageCurrencyDetection().currency,
      detectionConfidence: CurrencyDetector.getPageCurrencyDetection().confidence,
      detectedCurrencies: CurrencyDetector.describeDetectedCurrencies(textPlans, splitPlans),
      rateDate: usedMeta.map((meta) => meta.date).filter(Boolean).sort().at(-1) || null,
      staleRates: usedMeta.some((meta) => meta.stale),
      rateProvider: [...new Set(usedMeta.map((meta) => meta.provider).filter(Boolean))].join(", ") || null,
      cacheAgeLabel: usedMeta
        .filter((meta) => meta.stale && Number.isFinite(meta.cacheAgeMs))
        .sort((a, b) => b.cacheAgeMs - a.cacheAgeMs)[0]?.cacheAgeLabel || null,
      rateWarning: [...new Set(usedMeta.map((meta) => meta.warning).filter(Boolean))].join(" ") || null,
      scanLimited: textScan.limited,
      scannedTextNodes: textScan.nodes.length,
      inspectedTextNodes: textScan.inspected,
      error: count === 0
        ? rateError?.error || "Prices were identified, but none could be converted."
        : undefined
    };
  }

  function buildNoMatchesResult(textPlans, splitPlans) {
    const detection = CurrencyDetector.getPageCurrencyDetection();
    const sameAsTarget = settings.fromCurrency === "AUTO" && detection.currency === settings.toCurrency;
    const autoDetectionFailed = settings.fromCurrency === "AUTO" &&
      (!detection.currency || detection.confidence === "low");
    return {
      ok: false,
      count: 0,
      detectedCurrency: detection.currency,
      detectionConfidence: detection.confidence,
      detectedCurrencies: CurrencyDetector.describeDetectedCurrencies(textPlans, splitPlans),
      error: sameAsTarget
        ? `The detected page currency is already ${settings.toCurrency}. Choose a different target currency.`
        : autoDetectionFailed
          ? "Currency could not be detected confidently. Select the source currency manually."
          : settings.fromCurrency !== "AUTO"
            ? `Could not find the manually selected currency (${settings.fromCurrency}) on this page.`
            : "No confidently identified prices found on this page."
    };
  }

  async function convertSelectionText(selectedText, element) {
    if (!settings?.enabled) return { ok: false, error: "Extension is turned off." };
    const match = CurrencyDetector.findMatchesForContext(
      selectedText,
      element,
      settings,
      { selection: true }
    )[0];

    if (!match) {
      return {
        ok: false,
        error: settings.fromCurrency === "AUTO"
          ? "Could not confidently identify the selected currency."
          : `The selection does not look like ${settings.fromCurrency}.`
      };
    }

    const ratesResult = await ensureRates(match.currency);
    if (!ratesResult?.ok) return ratesResult;
    const meta = activeRateMetaByBase[match.currency] || {};
    return {
      ok: true,
      original: selectedText,
      sourceCurrency: match.currency,
      converted: convertAmount(match.amount, match.currency),
      rateDate: meta.date || null,
      staleRates: Boolean(meta.stale),
      rateProvider: meta.provider || null,
      cacheAgeLabel: meta.cacheAgeLabel || null,
      rateWarning: meta.warning || null
    };
  }

  function normalizeRoots(roots) {
    const expanded = new Set();
    for (const root of roots.filter(Boolean)) collectOpenRoots(root, expanded);
    const unique = [...expanded].filter((root) => root.isConnected !== false);
    return unique.filter((root, index) => !unique.some((other, otherIndex) =>
      index !== otherIndex && other !== root && other.nodeType === Node.ELEMENT_NODE &&
      !root.host && other.contains?.(root)
    ));
  }

  function collectOpenRoots(root, output) {
    output.add(root);
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.shadowRoot) collectOpenRoots(root.shadowRoot, output);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let inspected = 0;
    while (walker.nextNode() && inspected < MAX_SHADOW_HOSTS_PER_SCAN) {
      inspected += 1;
      if (walker.currentNode.shadowRoot) collectOpenRoots(walker.currentNode.shadowRoot, output);
    }
  }

  function collectTextNodes(roots) {
    const nodes = new Set();
    const scanState = { inspected: 0 };
    let limited = false;

    for (const root of roots) {
      if (nodes.size >= MAX_TEXT_NODES_PER_SCAN) {
        limited = true;
        break;
      }
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || isOwnedElement(root)) continue;
      const priceRoots = [];
      if (root.matches?.(SPLIT_CANDIDATE_SELECTOR)) priceRoots.push(root);
      for (const element of root.querySelectorAll?.(SPLIT_CANDIDATE_SELECTOR) || []) {
        priceRoots.push(element);
        if (priceRoots.length >= MAX_SPLIT_CANDIDATES_PER_SCAN) break;
      }
      prioritizeViewportElements(priceRoots);
      for (const priceRoot of priceRoots) {
        limited = collectTextNodesFromRoot(priceRoot, nodes, scanState) || limited;
        if (nodes.size >= MAX_TEXT_NODES_PER_SCAN) break;
      }
    }

    for (const root of roots) {
      if (nodes.size >= MAX_TEXT_NODES_PER_SCAN) {
        limited = true;
        break;
      }
      if (root.nodeType === Node.TEXT_NODE) {
        if (acceptTextNode(root)) nodes.add(root);
        continue;
      }
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || isOwnedElement(root)) continue;
      limited = collectTextNodesFromRoot(root, nodes, scanState) || limited;
      if (scanState.inspected >= MAX_TEXT_NODES_INSPECTED_PER_SCAN) break;
    }
    return { nodes: [...nodes], limited, inspected: scanState.inspected };
  }

  function collectTextNodesFromRoot(root, nodes, scanState) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      scanState.inspected += 1;
      if (acceptTextNode(walker.currentNode) === NodeFilter.FILTER_ACCEPT) {
        nodes.add(walker.currentNode);
      }
      if (nodes.size >= MAX_TEXT_NODES_PER_SCAN) return true;
      if (scanState.inspected >= MAX_TEXT_NODES_INSPECTED_PER_SCAN) return true;
    }
    return false;
  }

  function acceptTextNode(node) {
    if (!node.nodeValue?.trim() || !POSSIBLE_PRICE_TEXT_PATTERN.test(node.nodeValue)) {
      return NodeFilter.FILTER_REJECT;
    }
    const parent = node.parentElement;
    if (
      !parent ||
      SKIP_TAGS.has(parent.tagName) ||
      (!QUICK_CURRENCY_MARKER_PATTERN.test(node.nodeValue) && !CurrencyDetector.isLikelyPriceElement(parent)) ||
      parent.isContentEditable ||
      parent.closest(PRICE_FRAGMENT_SELECTOR) ||
      parent.closest("[hidden], [inert], [aria-hidden='true'], template") ||
      !isRendered(parent) ||
      parent.closest(`${OWNED_SELECTOR}, ${UI_SELECTOR}`)
    ) {
      return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
  }

  function collectSplitPricePlans(roots) {
    const elements = new Set();
    for (const root of roots) {
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || isOwnedElement(root)) continue;
      if (root.matches?.(SPLIT_CANDIDATE_SELECTOR)) elements.add(root);
      for (const element of root.querySelectorAll?.(SPLIT_CANDIDATE_SELECTOR) || []) {
        elements.add(element);
        if (elements.size >= MAX_SPLIT_CANDIDATES_PER_SCAN) break;
      }
      if (elements.size >= MAX_SPLIT_CANDIDATES_PER_SCAN) break;
    }

    const plans = [];
    for (const element of [...elements].reverse()) {
      if (
        element.childElementCount === 0 ||
        element.matches(PRICE_FRAGMENT_SELECTOR) ||
        element.closest("[hidden], [inert], [aria-hidden='true'], template") ||
        element.isContentEditable ||
        !isRendered(element) ||
        element.closest(OWNED_SELECTOR) ||
        element.querySelector(OWNED_SELECTOR) ||
        plans.some((plan) => element.contains(plan.element))
      ) continue;

      const text = element.textContent?.trim();
      if (!text || text.length > 100) continue;
      const matches = CurrencyDetector.findMatchesForContext(text, element, settings);
      if (!matches.length || elementHasCompletePriceNode(element)) continue;
      plans.push({ element, originalText: text, matches: [matches[0]] });
    }
    return plans;
  }

  function elementHasCompletePriceNode(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement?.closest(PRICE_FRAGMENT_SELECTOR)) continue;
      if (CurrencyDetector.findMatchesForContext(
        walker.currentNode.nodeValue || "",
        walker.currentNode.parentElement,
        settings
      ).length) return true;
    }
    return false;
  }

  function collectSourceCurrencies(...planGroups) {
    const bases = new Set();
    for (const plans of planGroups) {
      for (const plan of plans) {
        for (const match of plan.matches) {
          if (match.currency !== settings.toCurrency) bases.add(match.currency);
        }
      }
    }
    return bases;
  }

  async function ensureRates(baseCurrency) {
    if (activeRatesByBase[baseCurrency]?.[settings.toCurrency]) return { ok: true };
    const result = await chrome.runtime.sendMessage({
      type: CurrencyMessages.GET_RATES,
      baseCurrency
    });
    if (result?.ok) {
      activeRatesByBase[baseCurrency] = result.rates;
      activeRateMetaByBase[baseCurrency] = {
        date: result.date,
        fetchedAt: result.fetchedAt,
        stale: Boolean(result.stale),
        provider: result.provider,
        cacheAgeMs: result.cacheAgeMs,
        cacheAgeLabel: result.cacheAgeLabel,
        warning: result.warning
      };
    }
    return result || { ok: false, error: "Could not load exchange rates." };
  }

  async function applyPlansInBatches(textPlans, splitPlans) {
    let count = 0;
    let processed = 0;
    for (const plan of textPlans) {
      count += applyTextPlan(plan);
      processed += 1;
      if (processed % DOM_WRITE_BATCH_SIZE === 0) await yieldToMainThread();
    }
    for (const plan of splitPlans) {
      count += applySplitPlan(plan);
      processed += 1;
      if (processed % DOM_WRITE_BATCH_SIZE === 0) await yieldToMainThread();
    }
    return count;
  }

  function yieldToMainThread() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function applyTextPlan({ node, originalText, matches }) {
    if (!node.parentNode || node.nodeValue !== originalText) return 0;
    const usable = matches.filter((match) => activeRatesByBase[match.currency]?.[settings.toCurrency]);
    if (!usable.length) return 0;

    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of usable) {
      fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
      fragment.append(buildConvertedNode(match));
      lastIndex = match.index + match.raw.length;
    }
    fragment.append(document.createTextNode(text.slice(lastIndex)));
    node.parentNode.replaceChild(fragment, node);
    return usable.length;
  }

  function applySplitPlan({ element, originalText, matches }) {
    if (!element.isConnected || element.closest(OWNED_SELECTOR) || element.querySelector(OWNED_SELECTOR)) {
      return 0;
    }
    if (element.textContent?.trim() !== originalText) return 0;
    const match = matches.find((candidate) => activeRatesByBase[candidate.currency]?.[settings.toCurrency]);
    if (!match) return 0;

    const badge = document.createElement("ccp-conversion");
    badge.dataset.ccpOwned = "true";
    badge.dataset.ccpAppended = "true";
    badge.className = "ccp-conversion";
    const converted = document.createElement("span");
    converted.className = "ccp-badge";
    converted.textContent = ` ≈ ${convertAmount(match.amount, match.currency)}`;
    converted.title = conversionTitle(match.currency);
    badge.appendChild(converted);
    element.appendChild(badge);
    return 1;
  }

  function buildConvertedNode(match) {
    const wrapper = document.createElement("ccp-conversion");
    wrapper.dataset.ccpOwned = "true";
    wrapper.dataset.sourceCurrency = match.currency;
    wrapper.dataset.displayMode = settings.displayMode === "replace" ? "replace" : "beside";
    wrapper.className = "ccp-conversion";
    const original = document.createElement("span");
    original.className = "ccp-original";
    original.textContent = match.raw;
    const converted = document.createElement("span");
    converted.className = "ccp-badge";
    converted.textContent = ` ≈ ${convertAmount(match.amount, match.currency)}`;
    converted.title = conversionTitle(match.currency);
    wrapper.append(original, converted);
    return wrapper;
  }

  function conversionTitle(baseCurrency) {
    const meta = activeRateMetaByBase[baseCurrency] || {};
    const rate = activeRatesByBase[baseCurrency]?.[settings.toCurrency];
    const provider = meta.provider ? ` Provider: ${meta.provider}.` : "";
    const exchangeRate = Number.isFinite(rate)
      ? ` Exchange rate: 1 ${baseCurrency} = ${rate} ${settings.toCurrency}.`
      : "";
    const date = meta.date ? ` Rate date: ${meta.date}.` : "";
    const stale = meta.stale
      ? ` Cached rate${meta.cacheAgeLabel ? `: ${meta.cacheAgeLabel}` : ""}.`
      : "";
    return `Converted from ${baseCurrency} to ${settings.toCurrency}.${exchangeRate}${provider}${date}${stale}`;
  }

  function convertAmount(amount, baseCurrency) {
    const rate = activeRatesByBase[baseCurrency]?.[settings.toCurrency];
    return CurrencyCatalog.formatCurrencyAmount(amount * rate, settings.toCurrency);
  }

  function startWatching() {
    if (observer || !document.body || typeof MutationObserver === "undefined") return;
    observedUrl = window.location.href;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    observeOpenShadowRoots(document.body);
  }

  function handleMutations(mutations) {
    if (!settings?.enabled) return;
    if (window.location.href !== observedUrl) {
      observedUrl = window.location.href;
      CurrencyDetector.resetPageCurrencyDetection();
      pendingRoots.add(document.body);
    }

    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        queueMutationRoot(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) queueMutationRoot(node);
    }
    if (pendingRoots.size) schedulePendingConversion();
  }

  function queueMutationRoot(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element || element.nodeType !== Node.ELEMENT_NODE || isOwnedElement(element)) return;
    if (pendingRoots.size >= MAX_PENDING_ROOTS) {
      pendingRoots.clear();
      pendingRoots.add(document.body);
      return;
    }
    pendingRoots.add(element);
  }

  function observeOpenShadowRoots(root) {
    if (!observer || !root) return;
    const candidates = [];
    if (root.shadowRoot) candidates.push(root.shadowRoot);
    root.querySelectorAll?.("*").forEach((element) => {
      if (element.shadowRoot) candidates.push(element.shadowRoot);
    });
    for (const shadowRoot of candidates) {
      if (observedShadowRoots.has(shadowRoot)) continue;
      observedShadowRoots.add(shadowRoot);
      observer.observe(shadowRoot, { childList: true, characterData: true, subtree: true });
    }
  }

  function isOwnedElement(element) {
    return Boolean(element.matches?.(`${OWNED_SELECTOR}, ${UI_SELECTOR}`) ||
      element.closest?.(`${OWNED_SELECTOR}, ${UI_SELECTOR}`));
  }

  function schedulePendingConversion() {
    if (observerHandle !== null) return;
    const run = async () => {
      observerHandle = null;
      if (!pendingRoots.size || !settings?.enabled) return;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      await runSiteConversion({ clearExisting: false, observe: true, roots }).catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      observerUsesIdleCallback = true;
      observerHandle = window.requestIdleCallback(run, { timeout: 750 });
    } else {
      observerUsesIdleCallback = false;
      observerHandle = window.setTimeout(run, 150);
    }
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    if (observerHandle !== null) {
      if (observerUsesIdleCallback) window.cancelIdleCallback(observerHandle);
      else window.clearTimeout(observerHandle);
    }
    observerHandle = null;
    pendingRoots.clear();
  }

  function isRendered(element) {
    if (typeof element.getClientRects !== "function" || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse");
  }

  function prioritizeViewportElements(elements) {
    const viewportState = new Map(elements.map((element) => [element, isInViewport(element)]));
    elements.sort((a, b) => Number(viewportState.get(b)) - Number(viewportState.get(a)));
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.bottom >= 0 && rect.right >= 0 &&
      rect.top <= window.innerHeight && rect.left <= window.innerWidth);
  }

  function removeConversionsOnly() {
    for (const wrapper of document.querySelectorAll(OWNED_SELECTOR)) {
      if (wrapper.dataset.ccpAppended === "true") {
        wrapper.remove();
      } else {
        wrapper.replaceWith(document.createTextNode(
          wrapper.querySelector(".ccp-original")?.textContent || ""
        ));
      }
    }
  }

  function clearConversions() {
    stopWatching();
    removeConversionsOnly();
  }

  global.CurrencyPageConverter = Object.freeze({
    configure,
    runSiteConversion,
    convertSelectionText,
    clearConversions,
    startWatching,
    stopWatching
  });
})(globalThis);
