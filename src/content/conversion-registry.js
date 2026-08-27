(function initializeConversionRegistry(global) {
  function create({
    restoreWrapper = restoreConvertedWrapper,
    updateWrapperPresentation = () => {}
  } = {}) {
    const wrappers = new Set();

    function add(wrapper) {
      if (wrapper) wrappers.add(wrapper);
      return wrapper;
    }

    function prune() {
      let hasConnectedWrapper = false;
      for (const wrapper of [...wrappers]) {
        if (wrapper?.isConnected) hasConnectedWrapper = true;
        else wrappers.delete(wrapper);
      }
      return hasConnectedWrapper;
    }

    function hasAny() {
      return prune();
    }

    function restoreAll() {
      for (const wrapper of [...wrappers]) {
        wrappers.delete(wrapper);
        if (wrapper?.isConnected) restoreWrapper(wrapper);
      }
    }

    function updatePresentation(settings) {
      for (const wrapper of [...wrappers]) {
        if (!wrapper?.isConnected) {
          wrappers.delete(wrapper);
          continue;
        }
        updateWrapperPresentation(wrapper, settings);
      }
    }

    function size() {
      prune();
      return wrappers.size;
    }

    return Object.freeze({
      add,
      prune,
      hasAny,
      restoreAll,
      updatePresentation,
      size
    });
  }

  function restoreConvertedWrapper(wrapper) {
    if (wrapper.dataset?.ccpAppended === "true") {
      // "Converted only" parks the site's own price nodes inside the badge; they
      // have to go back where they came from before the badge disappears.
      const captured = wrapper.querySelector?.(":scope > .ccp-original");
      if (captured) wrapper.before(...captured.childNodes);
      wrapper.remove();
      return;
    }
    const originalText = wrapper.querySelector?.(".ccp-original")?.textContent || "";
    const ownerDocument = wrapper.ownerDocument || global.document;
    wrapper.replaceWith(ownerDocument.createTextNode(originalText));
  }

  global.CurrencyConversionRegistry = Object.freeze({ create });
})(globalThis);
