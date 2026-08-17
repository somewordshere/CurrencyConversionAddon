(function initializeMutationRootScheduler(global) {
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  const DOCUMENT_FRAGMENT_NODE = 11;

  function create({
    windowRef = global.window || global,
    MutationObserverCtor = global.MutationObserver,
    rootProvider = () => global.document?.body || null,
    onFlush,
    onBeforeMutations = null,
    onError = () => {},
    shouldIgnore = () => false,
    maxPendingRoots = 100,
    maxShadowHosts = 10000,
    idleTimeout = 750,
    fallbackDelay = 150
  } = {}) {
    const pendingRoots = new Set();
    let observer = null;
    let observedRoots = new WeakSet();
    let scheduledHandle = null;
    let scheduledWithIdleCallback = false;
    let active = false;
    let flushing = false;
    let lifecycle = 0;

    function start(root = rootProvider()) {
      if (active || !root || typeof MutationObserverCtor !== "function") return false;
      active = true;
      lifecycle += 1;
      flushing = false;
      observedRoots = new WeakSet();
      observer = new MutationObserverCtor(handleMutations);
      observeMutationRoot(root);
      observeOpenShadowRoots(root);
      return true;
    }

    function stop() {
      active = false;
      lifecycle += 1;
      flushing = false;
      observer?.disconnect();
      observer = null;
      cancelScheduledFlush();
      pendingRoots.clear();
      observedRoots = new WeakSet();
    }

    function handleMutations(mutations) {
      if (!active) return;
      onBeforeMutations?.(mutations, controller);
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          queue(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes || []) {
          observeOpenShadowRoots(node);
          queue(node);
        }
      }
    }

    function queue(node) {
      if (!active) return;
      const root = normalizePendingRoot(node);
      if (!root || shouldIgnore(root)) return;
      const fallbackRoot = rootProvider();
      if (fallbackRoot && pendingRoots.has(fallbackRoot)) return;

      for (const existing of [...pendingRoots]) {
        if (existing === root || contains(existing, root)) return;
        if (contains(root, existing)) pendingRoots.delete(existing);
      }

      if (pendingRoots.size >= maxPendingRoots) {
        pendingRoots.clear();
        if (fallbackRoot && !shouldIgnore(fallbackRoot)) pendingRoots.add(fallbackRoot);
      } else {
        pendingRoots.add(root);
      }
      if (pendingRoots.size) scheduleFlush();
    }

    function scheduleFlush() {
      if (!active || flushing || scheduledHandle !== null || !pendingRoots.size) return;
      const scheduledLifecycle = lifecycle;
      const run = () => {
        scheduledHandle = null;
        if (!active || scheduledLifecycle !== lifecycle) return;
        flushNow().catch(onError);
      };
      if (typeof windowRef.requestIdleCallback === "function") {
        scheduledWithIdleCallback = true;
        scheduledHandle = windowRef.requestIdleCallback(run, { timeout: idleTimeout });
      } else {
        scheduledWithIdleCallback = false;
        scheduledHandle = windowRef.setTimeout(run, fallbackDelay);
      }
    }

    async function flushNow() {
      cancelScheduledFlush();
      if (!active || flushing || !pendingRoots.size) return;
      const flushLifecycle = lifecycle;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      flushing = true;
      try {
        await onFlush?.(roots);
      } finally {
        if (flushLifecycle !== lifecycle) return;
        flushing = false;
        if (active && pendingRoots.size) scheduleFlush();
      }
    }

    function cancelScheduledFlush() {
      if (scheduledHandle === null) return;
      if (scheduledWithIdleCallback && typeof windowRef.cancelIdleCallback === "function") {
        windowRef.cancelIdleCallback(scheduledHandle);
      } else {
        windowRef.clearTimeout(scheduledHandle);
      }
      scheduledHandle = null;
    }

    function observeMutationRoot(root) {
      if (!observer || !root || observedRoots.has(root)) return;
      observedRoots.add(root);
      observer.observe(root, { childList: true, characterData: true, subtree: true });
    }

    function observeOpenShadowRoots(root) {
      if (!observer || !root) return;
      const stack = [];
      if (root.nodeType === ELEMENT_NODE) stack.push(root);
      else pushChildren(root, stack);
      let inspected = 0;

      while (stack.length && inspected < maxShadowHosts) {
        const element = stack.pop();
        inspected += 1;
        if (element.shadowRoot) {
          observeMutationRoot(element.shadowRoot);
          pushChildren(element.shadowRoot, stack);
        }
        pushChildren(element, stack);
      }
    }

    function pendingCount() {
      return pendingRoots.size;
    }

    function clearPending() {
      cancelScheduledFlush();
      pendingRoots.clear();
    }

    function discardRecords() {
      observer?.takeRecords?.();
    }

    const controller = Object.freeze({
      start,
      stop,
      queue,
      flushNow,
      pendingCount,
      clearPending,
      discardRecords
    });
    return controller;
  }

  function normalizePendingRoot(node) {
    if (!node) return null;
    if (node.nodeType === TEXT_NODE) return node.parentElement;
    return node.nodeType === ELEMENT_NODE || node.nodeType === DOCUMENT_FRAGMENT_NODE
      ? node
      : null;
  }

  function contains(container, candidate) {
    return Boolean(container?.contains?.(candidate));
  }

  function pushChildren(root, stack) {
    const children = root?.children;
    if (!children) return;
    for (let index = 0; index < children.length; index += 1) stack.push(children[index]);
  }

  global.CurrencyMutationRootScheduler = Object.freeze({ create });
})(globalThis);
