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
  const MAX_DISCOVERY_TEXT_NODES = 6000;
  const MAX_DISCOVERY_PRICE_ELEMENTS = 300;
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
  let queuedConversion = null;
  let conversionGeneration = 0;
  let discoveryCallback = null;
  let observedUrl = window.location.href;
  const conversionRegistry = CurrencyConversionRegistry.create({
    updateWrapperPresentation: updateConvertedPresentation
  });
  const discoveryScheduler = CurrencyMutationRootScheduler.create({
    rootProvider: () => document.body,
    onFlush: inspectDiscoveryRoots,
    onError: () => {},
    shouldIgnore: isOwnedElement,
    maxPendingRoots: MAX_PENDING_ROOTS,
    maxShadowHosts: MAX_SHADOW_HOSTS_PER_SCAN,
    idleTimeout: 300,
    fallbackDelay: 75
  });
  const conversionScheduler = CurrencyMutationRootScheduler.create({
    rootProvider: () => document.body,
    onFlush: convertMutationRoots,
    onBeforeMutations: handleObservedMutations,
    onError: () => {},
    shouldIgnore: isOwnedElement,
    maxPendingRoots: MAX_PENDING_ROOTS,
    maxShadowHosts: MAX_SHADOW_HOSTS_PER_SCAN,
    idleTimeout: 750,
    fallbackDelay: 150
  });

  function configure(nextSettings) {
    cancelPendingConversion();
    settings = Object.freeze({ ...nextSettings });
    activeRatesByBase = {};
    activeRateMetaByBase = {};
  }

  function updatePresentation(nextSettings) {
    if (!settings) {
      settings = Object.freeze({ ...nextSettings });
      return;
    }
    const presentation = Object.fromEntries(CurrencySettings.PRESENTATION_KEYS.map((key) => [
      key,
      nextSettings[key]
    ]));
    settings = Object.freeze({ ...settings, ...presentation });
    conversionRegistry.updatePresentation(settings);
  }

  function runSiteConversion(options = {}) {
    if (!settings?.enabled) {
      return Promise.resolve({ ok: false, error: "Extension is turned off." });
    }

    const request = createConversionRequest(options);
    if (!currentConversion || currentConversion.generation !== request.generation) {
      return startConversionRequest(request);
    }
    if (conversionRequestCovers(currentConversion, request)) return currentConversion.promise;
    return enqueueConversionRequest(request);
  }

  function createConversionRequest(options = {}) {
    const roots = options.roots || null;
    return {
      generation: conversionGeneration,
      runSettings: settings,
      fullScan: roots === null,
      clearExisting: options.clearExisting !== false,
      observe: options.observe !== false,
      roots,
      waiters: []
    };
  }

  function startConversionRequest(request) {
    const task = { ...request, promise: null };
    task.promise = performConversion({
      clearExisting: request.clearExisting,
      observe: request.observe,
      roots: request.roots
    }, request.generation, request.runSettings).finally(() => {
      if (currentConversion !== task) return;
      currentConversion = null;
      startQueuedConversion(request.generation);
    });
    currentConversion = task;
    return task.promise;
  }

  function conversionRequestCovers(active, request) {
    return active.fullScan && request.fullScan &&
      (active.clearExisting || !request.clearExisting) &&
      (active.observe || !request.observe);
  }

  function enqueueConversionRequest(request) {
    if (!queuedConversion || queuedConversion.generation !== request.generation) {
      queuedConversion = { ...request, roots: request.roots ? new Set(request.roots) : null, waiters: [] };
    } else {
      queuedConversion.clearExisting ||= request.clearExisting;
      queuedConversion.observe ||= request.observe;
      if (request.fullScan) {
        queuedConversion.fullScan = true;
        queuedConversion.roots = null;
      } else if (!queuedConversion.fullScan) {
        for (const root of request.roots || []) queuedConversion.roots.add(root);
      }
    }
    return new Promise((resolve, reject) => {
      queuedConversion.waiters.push({ resolve, reject });
    });
  }

  function startQueuedConversion(completedGeneration) {
    const request = queuedConversion;
    if (!request || request.generation !== completedGeneration) return;
    queuedConversion = null;
    if (!isCurrentRun(request.generation, request.runSettings)) {
      const result = cancelledConversionResult();
      for (const waiter of request.waiters) waiter.resolve(result);
      return;
    }
    if (request.roots instanceof Set) request.roots = [...request.roots];
    startConversionRequest(request).then(
      (result) => request.waiters.forEach((waiter) => waiter.resolve(result)),
      (error) => request.waiters.forEach((waiter) => waiter.reject(error))
    );
  }

  async function performConversion({
    clearExisting = true,
    observe = true,
    roots = null
  } = {}, generation, runSettings) {
    if (!isCurrentRun(generation, runSettings)) return cancelledConversionResult();
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
    const splitPlans = collectSplitPricePlans(scanRoots, textScan.splitCandidates);
    const bases = collectSourceCurrencies(textPlans, splitPlans);

    if (bases.size === 0) {
      if (observe && isCurrentRun(generation, runSettings)) startWatching();
      return buildNoMatchesResult(textPlans, splitPlans);
    }

    const rateResults = await Promise.all([...bases].map(ensureRates));
    if (!isCurrentRun(generation, runSettings)) return cancelledConversionResult();
    const rateError = rateResults.find((result) => !result.ok);
    const applied = await applyPlansInBatches(
      textPlans,
      splitPlans,
      generation,
      runSettings
    );
    if (applied.cancelled || !isCurrentRun(generation, runSettings)) {
      return cancelledConversionResult();
    }
    const count = applied.count;
    conversionScheduler.discardRecords();
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
    const generation = conversionGeneration;
    const runSettings = settings;
    const match = CurrencyDetector.findMatchesForContext(
      selectedText,
      element,
      runSettings,
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
    if (!isCurrentRun(generation, runSettings)) {
      return { ok: false, cancelled: true, error: "Settings changed before the selection was converted." };
    }
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

  function detectPagePrices({ roots = null } = {}) {
    if (!settings?.enabled || !document.body) return { found: false, currencies: [] };
    const scanRoots = normalizeRoots(roots || [document.body]);
    const priceElements = new Set();

    for (const root of scanRoots) {
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || isOwnedElement(root)) continue;
      if (root.matches?.(SPLIT_CANDIDATE_SELECTOR)) priceElements.add(root);
      for (const element of root.querySelectorAll?.(SPLIT_CANDIDATE_SELECTOR) || []) {
        priceElements.add(element);
        if (priceElements.size >= MAX_DISCOVERY_PRICE_ELEMENTS) break;
      }
      if (priceElements.size >= MAX_DISCOVERY_PRICE_ELEMENTS) break;
    }

    const prioritizedPriceElements = [...priceElements];
    prioritizeViewportElements(prioritizedPriceElements);
    for (const element of prioritizedPriceElements) {
      if (
        element.closest("[hidden], [inert], [aria-hidden='true'], template") ||
        element.isContentEditable ||
        !isRendered(element) ||
        element.closest(`${OWNED_SELECTOR}, ${UI_SELECTOR}`)
      ) continue;
      const text = element.textContent?.trim();
      if (!text || text.length > 120) continue;
      const matches = CurrencyDetector.findMatchesForContext(text, element, settings);
      const currencies = usableDiscoveryCurrencies(matches);
      if (currencies.length) return { found: true, currencies };
    }

    let inspected = 0;
    for (const root of scanRoots) {
      if (root.nodeType === Node.TEXT_NODE) {
        const currencies = discoveryCurrenciesForTextNode(root);
        if (currencies.length) return { found: true, currencies };
        continue;
      }
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || isOwnedElement(root)) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && inspected < MAX_DISCOVERY_TEXT_NODES) {
        inspected += 1;
        const currencies = discoveryCurrenciesForTextNode(walker.currentNode);
        if (currencies.length) return { found: true, currencies };
      }
      if (inspected >= MAX_DISCOVERY_TEXT_NODES) break;
    }
    return { found: false, currencies: [] };
  }

  function discoveryCurrenciesForTextNode(node) {
    if (acceptTextNode(node) !== NodeFilter.FILTER_ACCEPT) return [];
    return usableDiscoveryCurrencies(CurrencyDetector.findMatchesForContext(
      node.nodeValue,
      node.parentElement,
      settings
    ));
  }

  function usableDiscoveryCurrencies(matches) {
    return [...new Set((matches || [])
      .map((match) => match.currency)
      .filter((currency) => currency && currency !== settings.toCurrency))];
  }

  function prefetchRates(currencies) {
    const bases = [...new Set(currencies || [])]
      .filter((currency) => currency && currency !== settings?.toCurrency)
      .slice(0, 3);
    if (!bases.length) return Promise.resolve([]);
    return Promise.allSettled(bases.map(ensureRates));
  }

  // Read-only view of an already-loaded rate, for surfaces that want to show what
  // a conversion would give before the user commits to it. Never fetches.
  function describeRate(baseCurrency) {
    const rate = activeRatesByBase[baseCurrency]?.[settings?.toCurrency];
    if (!Number.isFinite(rate)) return null;
    const meta = activeRateMetaByBase[baseCurrency] || {};
    return {
      base: baseCurrency,
      quote: settings.toCurrency,
      rate,
      date: meta.date || null,
      stale: Boolean(meta.stale),
      cacheAgeLabel: meta.cacheAgeLabel || null
    };
  }

  function startDiscovering(onFound) {
    if (!settings?.enabled || !document.body || typeof MutationObserver === "undefined") return;
    discoveryCallback = onFound;
    discoveryScheduler.start(document.body);
  }

  function inspectDiscoveryRoots(roots) {
    if (!roots.length || !settings?.enabled) return;
    const detection = detectPagePrices({ roots });
    if (!detection.found) return;
    const callback = discoveryCallback;
    stopDiscovering();
    prefetchRates(detection.currencies).catch(() => {});
    callback?.(detection);
  }

  function stopDiscovering() {
    discoveryScheduler.stop();
    discoveryCallback = null;
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
    const splitCandidates = new Set();
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
        limited = collectTextNodesFromRoot(priceRoot, nodes, splitCandidates, scanState) || limited;
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
      limited = collectTextNodesFromRoot(root, nodes, splitCandidates, scanState) || limited;
      if (scanState.inspected >= MAX_TEXT_NODES_INSPECTED_PER_SCAN) break;
    }
    return {
      nodes: [...nodes],
      splitCandidates: [...splitCandidates],
      limited,
      inspected: scanState.inspected
    };
  }

  function collectTextNodesFromRoot(root, nodes, splitCandidates, scanState) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      scanState.inspected += 1;
      collectSplitCandidateForTextNode(walker.currentNode, splitCandidates);
      if (acceptTextNode(walker.currentNode) === NodeFilter.FILTER_ACCEPT) {
        nodes.add(walker.currentNode);
      }
      if (nodes.size >= MAX_TEXT_NODES_PER_SCAN) return true;
      if (scanState.inspected >= MAX_TEXT_NODES_INSPECTED_PER_SCAN) return true;
    }
    return false;
  }

  function collectSplitCandidateForTextNode(node, splitCandidates) {
    const nodeText = node.nodeValue || "";
    if (
      !node.parentElement ||
      SKIP_TAGS.has(node.parentElement.tagName) ||
      !QUICK_CURRENCY_MARKER_PATTERN.test(nodeText)
    ) return;
    if (CurrencyDetector.findCurrencyMatches(nodeText, {
      pageDetection: CurrencyDetector.getPageCurrencyDetection()
    }).length) return;

    let element = node.parentElement;
    for (let level = 0; element && level < 3; level += 1, element = element.parentElement) {
      const text = element.textContent?.trim();
      if (!text || text.length > 100) continue;
      if (!POSSIBLE_PRICE_TEXT_PATTERN.test(text) || element.childElementCount === 0) continue;
      const matches = CurrencyDetector.findMatchesForContext(text, element, settings);
      if (!matches.some((match) => CurrencyDetector.hasCurrencyMarker(nodeText, match.currency))) {
        continue;
      }
      splitCandidates.add(element);
      return;
    }
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

  function collectSplitPricePlans(roots, discoveredElements = []) {
    const elements = new Set(discoveredElements);
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
    const result = await ExtensionAPI.runtime.sendMessage({
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

  async function applyPlansInBatches(textPlans, splitPlans, generation, runSettings) {
    let count = 0;
    let processed = 0;
    for (const plan of textPlans) {
      if (!isCurrentRun(generation, runSettings)) return { count, cancelled: true };
      count += applyTextPlan(plan);
      processed += 1;
      if (processed % DOM_WRITE_BATCH_SIZE === 0) {
        await yieldToMainThread();
        if (!isCurrentRun(generation, runSettings)) return { count, cancelled: true };
      }
    }
    for (const plan of splitPlans) {
      if (!isCurrentRun(generation, runSettings)) return { count, cancelled: true };
      count += applySplitPlan(plan);
      processed += 1;
      if (processed % DOM_WRITE_BATCH_SIZE === 0) {
        await yieldToMainThread();
        if (!isCurrentRun(generation, runSettings)) return { count, cancelled: true };
      }
    }
    return { count, cancelled: false };
  }

  function isCurrentRun(generation, runSettings) {
    return generation === conversionGeneration && settings?.enabled && runSettings?.enabled;
  }

  function cancelledConversionResult() {
    return {
      ok: false,
      count: 0,
      cancelled: true,
      error: "Conversion was cancelled because settings changed or original prices were restored."
    };
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
    badge.style.setProperty("display", "inline", "important");
    const converted = createConvertedBadge(match, { adjacent: true });
    badge.appendChild(converted);
    element.appendChild(badge);
    conversionRegistry.add(badge);
    return 1;
  }

  function buildConvertedNode(match) {
    const wrapper = document.createElement("ccp-conversion");
    wrapper.dataset.ccpOwned = "true";
    wrapper.dataset.sourceCurrency = match.currency;
    wrapper.dataset.displayMode = settings.displayMode === "replace" ? "replace" : "beside";
    wrapper.className = "ccp-conversion";
    wrapper.style.setProperty("display", "inline", "important");
    const original = document.createElement("span");
    original.className = "ccp-original";
    original.textContent = match.raw;
    original.style.setProperty(
      "display",
      settings.displayMode === "replace" ? "none" : "inline",
      "important"
    );
    const converted = createConvertedBadge(match, {
      adjacent: settings.displayMode !== "replace"
    });
    wrapper.append(original, converted);
    conversionRegistry.add(wrapper);
    return wrapper;
  }

  function createConvertedBadge(match, { adjacent }) {
    const converted = document.createElement("span");
    converted.className = "ccp-badge";
    converted.textContent = `≈ ${convertAmount(match.amount, match.currency)}`;
    converted.title = conversionTitle(match.currency);
    applyConvertedAppearance(converted, { adjacent });
    return converted;
  }

  function applyConvertedAppearance(converted, { adjacent }) {
    const appearance = CurrencySettings.normalizeAppearance(settings);
    const shape = appearance.convertedShape;

    converted.dataset.ccpShape = shape;
    for (const [property, value] of Object.entries({
      display: "inline-block",
      color: appearance.convertedTextColor,
      "background-color": appearance.convertedBackgroundColor,
      "border-radius": CurrencySettings.SHAPE_RADII[shape],
      "font-weight": "700",
      "margin-inline-start": adjacent ? "0.28em" : "0",
      padding: "0.08em 0.34em",
      "white-space": "nowrap"
    })) {
      converted.style.setProperty(property, value, "important");
    }
  }

  function updateConvertedPresentation(wrapper, nextSettings) {
    const appended = wrapper.dataset.ccpAppended === "true";
    const displayMode = nextSettings.displayMode === "replace" ? "replace" : "beside";
    if (!appended) {
      wrapper.dataset.displayMode = displayMode;
      wrapper.querySelector(".ccp-original")?.style.setProperty(
        "display",
        displayMode === "replace" ? "none" : "inline",
        "important"
      );
    }
    const converted = wrapper.querySelector(".ccp-badge");
    if (converted) applyConvertedAppearance(converted, {
      adjacent: appended || displayMode !== "replace"
    });
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
    if (!document.body || typeof MutationObserver === "undefined") return;
    if (conversionScheduler.start(document.body)) observedUrl = window.location.href;
  }

  function handleObservedMutations(_mutations, scheduler) {
    if (!settings?.enabled) return;
    if (window.location.href !== observedUrl) {
      observedUrl = window.location.href;
      CurrencyDetector.resetPageCurrencyDetection();
      scheduler.queue(document.body);
    }
  }

  async function convertMutationRoots(roots) {
    if (!roots.length || !settings?.enabled) return;
    await runSiteConversion({ clearExisting: false, observe: true, roots }).catch(() => {});
  }

  function isOwnedElement(element) {
    return Boolean(element.matches?.(`${OWNED_SELECTOR}, ${UI_SELECTOR}`) ||
      element.closest?.(`${OWNED_SELECTOR}, ${UI_SELECTOR}`));
  }

  function stopWatching() {
    conversionScheduler.stop();
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
    conversionRegistry.restoreAll();
  }

  function clearConversions() {
    cancelPendingConversion();
    stopWatching();
    removeConversionsOnly();
  }

  function cancelPendingConversion() {
    conversionGeneration += 1;
    conversionScheduler.clearPending();
    if (queuedConversion) {
      const result = cancelledConversionResult();
      for (const waiter of queuedConversion.waiters) waiter.resolve(result);
      queuedConversion = null;
    }
  }

  function hasConversions() {
    return conversionRegistry.hasAny();
  }

  global.CurrencyPageConverter = Object.freeze({
    configure,
    updatePresentation,
    runSiteConversion,
    convertSelectionText,
    clearConversions,
    cancelPendingConversion,
    hasConversions,
    detectPagePrices,
    prefetchRates,
    describeRate,
    startDiscovering,
    stopDiscovering,
    startWatching,
    stopWatching
  });
})(globalThis);
