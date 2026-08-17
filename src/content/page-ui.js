(function initializePageUi(global) {
  let settings = null;
  let pageConvertPrompt = null;
  let pageConvertButton = null;
  let pageConvertMessage = null;
  let pageConvertRate = null;
  let pagePromptAction = "convert";
  let pagePromptPreviousFocus = null;
  let selectionPopup = null;
  let pendingSelectionText = "";
  let pendingSelectionSourceCurrency = "";
  let selectionPreviousFocus = null;
  let selectionWasKeyboardTriggered = false;
  let selectionDismissTimer = null;
  let runConversion = null;
  let clearConversion = null;
  let convertSelection = null;
  let listenersInstalled = false;
  let toastNode = null;
  let toastPreviousFocus = null;
  let toastTimer = null;

  function configure(options) {
    settings = options.settings;
    runConversion = options.runConversion;
    clearConversion = options.clearConversion;
    convertSelection = options.convertSelection;
  }

  function installSelectionListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    document.addEventListener("mouseup", handleTextSelection);
    document.addEventListener("keyup", handleKeyboardSelection);
    document.addEventListener("mousedown", handleOutsideSelectionPopup);
    window.addEventListener("scroll", () => removeSelectionPopup({ restoreFocus: false }), true);
  }

  function showPageConvertPrompt() {
    if (pageConvertPrompt && !pageConvertPrompt.isConnected) {
      pageConvertPrompt = null;
      pageConvertButton = null;
      pageConvertMessage = null;
      pageConvertRate = null;
      pagePromptPreviousFocus = null;
    }
    if (pageConvertPrompt || !settings?.enabled || !document.body || window.top !== window) return;
    pagePromptPreviousFocus = getActiveElementForRestore();
    pagePromptAction = "convert";
    pageConvertPrompt = document.createElement("aside");
    pageConvertPrompt.className = "ccp-page-prompt";
    pageConvertPrompt.setAttribute("aria-labelledby", "ccp-page-prompt-title");
    pageConvertPrompt.setAttribute(
      "aria-describedby",
      "ccp-page-prompt-message ccp-page-prompt-rate"
    );

    const header = document.createElement("div");
    header.className = "ccp-page-prompt-header";
    const title = document.createElement("strong");
    title.id = "ccp-page-prompt-title";
    title.className = "ccp-page-prompt-title";
    title.textContent = "Currency Converter Pro";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ccp-page-prompt-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss currency converter");
    close.addEventListener("click", () => removePageConvertPrompt());
    header.append(title, close);

    pageConvertMessage = document.createElement("span");
    pageConvertMessage.id = "ccp-page-prompt-message";
    pageConvertMessage.className = "ccp-page-prompt-message";
    pageConvertMessage.setAttribute("role", "status");
    pageConvertMessage.setAttribute("aria-live", "polite");
    pageConvertMessage.setAttribute("aria-atomic", "true");
    pageConvertMessage.textContent = `Convert visible prices on this page to ${settings.toCurrency}.`;

    // Shown once the rate is known, so the offer states what you would get
    // before you accept it. Not a live region: the message beside it already is.
    pageConvertRate = document.createElement("span");
    pageConvertRate.id = "ccp-page-prompt-rate";
    pageConvertRate.className = "ccp-page-prompt-rate";
    pageConvertRate.hidden = true;

    pageConvertButton = document.createElement("button");
    pageConvertButton.type = "button";
    pageConvertButton.className = "ccp-page-prompt-action";
    pageConvertButton.textContent = "Convert prices";
    pageConvertButton.addEventListener("click", handlePagePromptAction);

    pageConvertPrompt.append(header, pageConvertMessage, pageConvertRate, pageConvertButton);
    pageConvertPrompt.addEventListener("keydown", handlePagePromptKeydown);
    document.body.appendChild(pageConvertPrompt);
  }

  function setPageConvertPromptRate(descriptor) {
    if (!pageConvertRate) return;
    if (!descriptor || !Number.isFinite(descriptor.rate)) {
      pageConvertRate.textContent = "";
      pageConvertRate.hidden = true;
      return;
    }
    // Deliberately terse: this card is 268px wide and a full freshness phrase
    // wraps to a second line. The popup and toast carry the detail.
    const freshness = descriptor.stale ? "cached" : descriptor.date || "";
    pageConvertRate.textContent = `1 ${descriptor.base} = ${
      formatPromptRate(descriptor.rate)
    } ${descriptor.quote}${freshness ? ` · ${freshness}` : ""}`;
    pageConvertRate.title = descriptor.stale && descriptor.cacheAgeLabel
      ? `Cached rate, ${descriptor.cacheAgeLabel}`
      : "";
    pageConvertRate.hidden = false;
  }

  function formatPromptRate(rate) {
    if (rate >= 1000) return rate.toFixed(1);
    if (rate >= 0.001) return rate.toFixed(4);
    return rate.toPrecision(3);
  }

  async function handlePagePromptAction() {
    if (!pageConvertPrompt || !pageConvertButton || !pageConvertMessage) return;
    const prompt = pageConvertPrompt;
    if (pagePromptAction === "undo") {
      pageConvertButton.disabled = true;
      pageConvertButton.textContent = "Restoring…";
      pageConvertMessage.textContent = "Restoring original prices…";
      let result;
      try {
        result = await clearConversion?.();
      } catch (error) {
        if (pageConvertPrompt !== prompt || !pageConvertButton || !pageConvertMessage) return;
        pageConvertButton.disabled = false;
        pageConvertButton.textContent = "Try undo again";
        pageConvertMessage.textContent = formatActionFailure(
          error,
          "Original prices could not be restored"
        );
        pageConvertPrompt.dataset.state = "error";
        return;
      }
      if (pageConvertPrompt !== prompt || !pageConvertButton || !pageConvertMessage) return;
      pageConvertButton.disabled = false;
      if (result?.ok === false) {
        pageConvertButton.textContent = "Try undo again";
        pageConvertMessage.textContent = result.error || "Original prices could not be restored.";
        pageConvertPrompt.dataset.state = "error";
        return;
      }
      pagePromptAction = "convert";
      pageConvertButton.textContent = "Convert again";
      pageConvertMessage.textContent = "Original prices restored.";
      delete pageConvertPrompt.dataset.state;
      return;
    }

    pageConvertButton.disabled = true;
    pageConvertButton.textContent = "Converting…";
    pageConvertMessage.textContent = "Scanning visible prices…";
    delete pageConvertPrompt.dataset.state;
    let result;
    try {
      result = await runConversion();
    } catch (error) {
      if (pageConvertPrompt !== prompt || !pageConvertButton || !pageConvertMessage) return;
      pagePromptAction = "convert";
      pageConvertButton.disabled = false;
      pageConvertButton.textContent = "Try again";
      pageConvertMessage.textContent = formatActionFailure(
        error,
        "Prices could not be converted"
      );
      pageConvertPrompt.dataset.state = "error";
      return;
    }
    if (pageConvertPrompt !== prompt) return;

    if (result?.ok) {
      const source = result.detectedCurrency || result.detectedCurrencies || "the detected currency";
      pagePromptAction = "undo";
      pageConvertButton.disabled = false;
      pageConvertButton.textContent = "Undo";
      pageConvertMessage.textContent = `Converted ${result.count} price${
        result.count === 1 ? "" : "s"
      } from ${source} to ${settings.toCurrency}.`;
      pageConvertPrompt.dataset.state = "success";
    } else {
      pagePromptAction = "convert";
      pageConvertButton.disabled = false;
      pageConvertButton.textContent = "Try again";
      pageConvertMessage.textContent = result?.detectionConfidence === "low"
        ? "We could not detect the source currency. Choose one in the extension, then try again."
        : result?.error || "Prices could not be converted on this page. Try again.";
      pageConvertPrompt.dataset.state = "error";
    }
  }

  function handlePagePromptKeydown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    removePageConvertPrompt();
  }

  function removePageConvertPrompt({ restoreFocus = true } = {}) {
    const shouldRestoreFocus = Boolean(
      restoreFocus && pageConvertPrompt?.contains(document.activeElement)
    );
    pageConvertPrompt?.remove();
    pageConvertPrompt = null;
    pageConvertButton = null;
    pageConvertMessage = null;
    pageConvertRate = null;
    pagePromptAction = "convert";
    if (shouldRestoreFocus) restoreFocusTo(pagePromptPreviousFocus);
    pagePromptPreviousFocus = null;
  }

  function handleTextSelection(event) {
    if (!selectionPopup?.contains(event.target)) {
      window.setTimeout(() => showSelectionPopup({ focus: false }), 0);
    }
  }

  function handleKeyboardSelection(event) {
    if (event.key !== "Shift") return;
    window.setTimeout(() => showSelectionPopup({ focus: true }), 0);
  }

  function showSelectionPopup({ focus = false } = {}) {
    const previousFocus = selectionPreviousFocus;
    const activeBeforeRefresh = getActiveElementForRestore();
    const popupHadFocus = Boolean(selectionPopup?.contains(document.activeElement));
    removeSelectionPopup({ restoreFocus: false, preservePreviousFocus: focus });
    if (!settings?.enabled) {
      if (focus && popupHadFocus) restoreFocusTo(previousFocus);
      selectionPreviousFocus = null;
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (focus && popupHadFocus) restoreFocusTo(previousFocus);
      selectionPreviousFocus = null;
      return;
    }
    const selectedText = selection.toString().trim();
    const match = CurrencyDetector.findMatchesForContext(
      selectedText,
      selection.anchorNode?.parentElement,
      settings,
      { selection: true }
    )[0];
    if (!match) {
      if (focus && popupHadFocus) restoreFocusTo(previousFocus);
      selectionPreviousFocus = null;
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      if (focus && popupHadFocus) restoreFocusTo(previousFocus);
      selectionPreviousFocus = null;
      return;
    }
    pendingSelectionText = selectedText;
    pendingSelectionSourceCurrency = match.currency;
    selectionWasKeyboardTriggered = focus;
    selectionPreviousFocus = focus
      ? previousFocus || (popupHadFocus ? null : activeBeforeRefresh)
      : null;
    selectionPopup = document.createElement("button");
    selectionPopup.type = "button";
    selectionPopup.className = "ccp-selection-popup";
    selectionPopup.setAttribute("aria-live", "polite");
    selectionPopup.setAttribute("aria-atomic", "true");
    updateSelectionPopup(
      "Convert selection",
      `Convert selected ${match.currency} price to ${settings.toCurrency}`
    );
    selectionPopup.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    selectionPopup.addEventListener("click", handleConvertSelectionClick);
    selectionPopup.addEventListener("keydown", handleSelectionPopupKeydown);
    document.body.appendChild(selectionPopup);

    const popupRect = selectionPopup.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - popupRect.width / 2),
      window.innerWidth - popupRect.width - 8
    );
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + popupRect.height <= window.innerHeight
      ? preferredTop
      : Math.max(8, rect.top - popupRect.height - 8);
    selectionPopup.style.left = `${left}px`;
    selectionPopup.style.top = `${top}px`;
    if (focus) selectionPopup.focus({ preventScroll: true });
  }

  async function handleConvertSelectionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectionPopup || !pendingSelectionText) return;
    const popup = selectionPopup;
    popup.disabled = true;
    updateSelectionPopup(
      "Converting…",
      `Converting selected ${pendingSelectionSourceCurrency || "currency"} price to ${settings.toCurrency}`,
      { busy: true }
    );
    const selection = window.getSelection();
    let result;
    try {
      result = await convertSelection(
        pendingSelectionText,
        selection?.anchorNode?.parentElement
      );
    } catch (error) {
      result = {
        ok: false,
        error: formatActionFailure(error, "Selection could not be converted")
      };
    }
    if (selectionPopup !== popup) return;

    popup.disabled = false;
    if (result?.ok) {
      const source = result.sourceCurrency || pendingSelectionSourceCurrency || "currency";
      const converted = result.converted || settings.toCurrency;
      updateSelectionPopup(
        `${source} → ${converted}`,
        `Converted selected ${source} price to ${converted}`,
        { state: "success" }
      );
    } else {
      const errorMessage = result?.error || "Selection could not be converted. Try again.";
      updateSelectionPopup(
        errorMessage,
        `Selection conversion failed: ${errorMessage}`,
        { state: "error" }
      );
    }
    if (selectionWasKeyboardTriggered) popup.focus({ preventScroll: true });
    if (!selectionWasKeyboardTriggered) {
      selectionDismissTimer = window.setTimeout(
        () => removeSelectionPopup({ restoreFocus: false }),
        3500
      );
    }
  }

  function updateSelectionPopup(text, accessibleName, { state = "", busy = false } = {}) {
    if (!selectionPopup) return;
    selectionPopup.textContent = text;
    selectionPopup.title = accessibleName;
    selectionPopup.setAttribute("aria-label", accessibleName);
    if (busy) selectionPopup.setAttribute("aria-busy", "true");
    else selectionPopup.removeAttribute("aria-busy");
    if (state) selectionPopup.dataset.state = state;
    else delete selectionPopup.dataset.state;
  }

  function handleSelectionPopupKeydown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    removeSelectionPopup();
  }

  function handleOutsideSelectionPopup(event) {
    if (selectionPopup && !selectionPopup.contains(event.target)) {
      removeSelectionPopup({ restoreFocus: false });
    }
  }

  function removeSelectionPopup({ restoreFocus = true, preservePreviousFocus = false } = {}) {
    const shouldRestoreFocus = Boolean(
      restoreFocus && selectionPopup?.contains(document.activeElement)
    );
    if (selectionDismissTimer) window.clearTimeout(selectionDismissTimer);
    selectionDismissTimer = null;
    selectionPopup?.remove();
    selectionPopup = null;
    pendingSelectionText = "";
    pendingSelectionSourceCurrency = "";
    selectionWasKeyboardTriggered = false;
    if (shouldRestoreFocus) restoreFocusTo(selectionPreviousFocus);
    if (!preservePreviousFocus) selectionPreviousFocus = null;
  }

  function showToast(message, options = {}) {
    removeToast({ restoreFocus: false });
    toastPreviousFocus = getActiveElementForRestore();
    const toast = document.createElement("div");
    toast.className = "ccp-toast";
    const text = document.createElement("span");
    text.className = "ccp-toast-message";
    text.setAttribute("role", "status");
    text.setAttribute("aria-live", "polite");
    text.setAttribute("aria-atomic", "true");
    toast.appendChild(text);

    if (options.actionLabel && typeof options.onAction === "function") {
      toast.setAttribute("role", "group");
      toast.setAttribute("aria-label", "Currency conversion result");
      const action = document.createElement("button");
      action.type = "button";
      action.className = "ccp-toast-action";
      action.textContent = options.actionLabel;
      action.addEventListener("click", async () => {
        action.disabled = true;
        action.setAttribute("aria-busy", "true");
        try {
          const result = await options.onAction();
          if (result?.ok === false) {
            throw new Error(result.error || `${options.actionLabel} could not be completed.`);
          }
          if (toastNode === toast) removeToast();
        } catch (error) {
          if (toastNode !== toast || !toast.isConnected) return;
          action.disabled = false;
          action.removeAttribute("aria-busy");
          toast.dataset.state = "error";
          text.textContent = formatActionFailure(error, `${options.actionLabel} failed`);
        }
      });
      toast.appendChild(action);

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "ccp-toast-dismiss";
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", "Dismiss conversion result");
      dismiss.addEventListener("click", () => removeToast());
      toast.appendChild(dismiss);
    }

    document.body.appendChild(toast);
    toastNode = toast;
    window.requestAnimationFrame(() => {
      if (toastNode === toast && toast.isConnected) text.textContent = message;
    });
    if (!options.actionLabel) {
      toastTimer = window.setTimeout(() => removeToast({ restoreFocus: false }), options.duration || 6000);
    }
  }

  function removeToast({ restoreFocus = true } = {}) {
    const shouldRestoreFocus = Boolean(
      restoreFocus && toastNode?.contains(document.activeElement)
    );
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = null;
    toastNode?.remove();
    toastNode = null;
    if (shouldRestoreFocus) restoreFocusTo(toastPreviousFocus);
    toastPreviousFocus = null;
  }

  function clearTransientUi() {
    removeSelectionPopup();
    removeToast();
  }

  function getActiveElementForRestore() {
    const active = document.activeElement;
    return active && active !== document.body && typeof active.focus === "function"
      ? active
      : null;
  }

  function restoreFocusTo(element) {
    if (!element?.isConnected || typeof element.focus !== "function") return;
    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }
  }

  function formatActionFailure(error, summary) {
    const detail = typeof error?.message === "string" ? error.message.trim() : "";
    return detail ? `${summary}. ${detail}` : `${summary}. Try again.`;
  }

  global.CurrencyPageUi = Object.freeze({
    configure,
    installSelectionListeners,
    showPageConvertPrompt,
    setPageConvertPromptRate,
    removePageConvertPrompt,
    showToast,
    clearTransientUi
  });
})(globalThis);
