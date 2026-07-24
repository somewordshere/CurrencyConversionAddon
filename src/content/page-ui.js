(function initializePageUi(global) {
  let settings = null;
  let pageConvertPrompt = null;
  let pageConvertButton = null;
  let pageConvertMessage = null;
  let selectionPopup = null;
  let pendingSelectionText = "";
  let runConversion = null;
  let convertSelection = null;
  let listenersInstalled = false;
  let promptPresenceObserver = null;
  let toastTimer = null;

  function configure(options) {
    settings = options.settings;
    runConversion = options.runConversion;
    convertSelection = options.convertSelection;
  }

  function installSelectionListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    document.addEventListener("mouseup", handleTextSelection);
    document.addEventListener("keyup", handleKeyboardSelection);
    document.addEventListener("mousedown", handleOutsideSelectionPopup);
    window.addEventListener("scroll", removeSelectionPopup, true);
    promptPresenceObserver = new MutationObserver(restoreRemovedPagePrompt);
    promptPresenceObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function restoreRemovedPagePrompt() {
    if (!pageConvertPrompt || pageConvertPrompt.isConnected) return;
    pageConvertPrompt = null;
    pageConvertButton = null;
    pageConvertMessage = null;
    if (settings?.enabled) showPageConvertPrompt();
  }

  function showPageConvertPrompt() {
    if (pageConvertPrompt && !pageConvertPrompt.isConnected) {
      pageConvertPrompt = null;
      pageConvertButton = null;
      pageConvertMessage = null;
    }
    if (pageConvertPrompt || !settings?.enabled || !document.body || window.top !== window) return;
    pageConvertPrompt = document.createElement("aside");
    pageConvertPrompt.className = "ccp-page-prompt";
    pageConvertPrompt.setAttribute("aria-label", "Currency Converter Pro page control");

    const header = document.createElement("div");
    header.className = "ccp-page-prompt-header";
    const title = document.createElement("strong");
    title.className = "ccp-page-prompt-title";
    title.textContent = "Currency Converter Pro";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ccp-page-prompt-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss currency conversion control");
    close.addEventListener("click", removePageConvertPrompt);
    header.append(title, close);

    pageConvertMessage = document.createElement("span");
    pageConvertMessage.className = "ccp-page-prompt-message";
    pageConvertMessage.textContent = `Convert prices on this page to ${settings.toCurrency}.`;

    pageConvertButton = document.createElement("button");
    pageConvertButton.type = "button";
    pageConvertButton.className = "ccp-page-prompt-action";
    pageConvertButton.textContent = "Convert page";
    pageConvertButton.addEventListener("click", handleConvertAllClick);

    pageConvertPrompt.append(header, pageConvertMessage, pageConvertButton);
    document.body.appendChild(pageConvertPrompt);
  }

  async function handleConvertAllClick() {
    if (!pageConvertPrompt || !pageConvertButton) return;
    pageConvertButton.disabled = true;
    pageConvertButton.textContent = "Converting…";
    pageConvertMessage.textContent = "Scanning visible prices on this page.";
    delete pageConvertPrompt.dataset.state;
    const result = await runConversion();
    if (!pageConvertPrompt) return;

    if (result?.ok) {
      const detected = result.detectedCurrency ? ` from ${result.detectedCurrency}` : "";
      pageConvertButton.textContent = `Converted ${result.count} price${result.count === 1 ? "" : "s"}`;
      pageConvertMessage.textContent = `Prices${detected} are now shown in ${settings.toCurrency}.`;
      pageConvertPrompt.dataset.state = "success";
      window.setTimeout(removePageConvertPrompt, 4000);
    } else {
      pageConvertButton.disabled = false;
      pageConvertButton.textContent = "Try again";
      pageConvertMessage.textContent = result?.error || "Currency could not be detected confidently.";
      pageConvertPrompt.dataset.state = "error";
    }
  }

  function removePageConvertPrompt() {
    pageConvertPrompt?.remove();
    pageConvertPrompt = null;
    pageConvertButton = null;
    pageConvertMessage = null;
  }

  function handleTextSelection(event) {
    if (!selectionPopup?.contains(event.target)) window.setTimeout(showSelectionPopup, 0);
  }

  function handleKeyboardSelection(event) {
    if (event.key === "Shift" || event.shiftKey) window.setTimeout(showSelectionPopup, 0);
  }

  function showSelectionPopup() {
    removeSelectionPopup();
    if (!settings?.enabled) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    const match = CurrencyDetector.findMatchesForContext(
      selectedText,
      selection.anchorNode?.parentElement,
      settings,
      { selection: true }
    )[0];
    if (!match) return;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    pendingSelectionText = selectedText;
    selectionPopup = document.createElement("button");
    selectionPopup.type = "button";
    selectionPopup.className = "ccp-selection-popup";
    selectionPopup.textContent = "CCP · Convert";
    selectionPopup.title = `Convert ${match.currency} to ${settings.toCurrency}`;
    selectionPopup.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    selectionPopup.addEventListener("click", handleConvertSelectionClick);
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
  }

  async function handleConvertSelectionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectionPopup || !pendingSelectionText) return;
    selectionPopup.disabled = true;
    selectionPopup.textContent = "CCP · Converting…";
    const selection = window.getSelection();
    const result = await convertSelection(
      pendingSelectionText,
      selection?.anchorNode?.parentElement
    );
    if (!selectionPopup) return;

    selectionPopup.disabled = false;
    selectionPopup.textContent = result?.ok
      ? `CCP · ${result.sourceCurrency} → ${result.converted}`
      : `CCP · ${result?.error || "Could not convert"}`;
    selectionPopup.dataset.state = result?.ok ? "success" : "error";
    window.setTimeout(removeSelectionPopup, 3500);
  }

  function handleOutsideSelectionPopup(event) {
    if (selectionPopup && !selectionPopup.contains(event.target)) removeSelectionPopup();
  }

  function removeSelectionPopup() {
    selectionPopup?.remove();
    selectionPopup = null;
    pendingSelectionText = "";
  }

  function showToast(message, options = {}) {
    document.querySelector(".ccp-toast")?.remove();
    if (toastTimer) window.clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "ccp-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    const text = document.createElement("span");
    text.textContent = `CCP · ${message}`;
    toast.appendChild(text);

    if (options.actionLabel && typeof options.onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "ccp-toast-action";
      action.textContent = options.actionLabel;
      action.addEventListener("click", () => {
        options.onAction();
        toast.remove();
      });
      toast.appendChild(action);
    }

    document.body.appendChild(toast);
    toastTimer = window.setTimeout(() => toast.remove(), options.duration || 6000);
  }

  function clearTransientUi() {
    removeSelectionPopup();
    document.querySelectorAll(".ccp-toast").forEach((node) => node.remove());
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = null;
  }

  global.CurrencyPageUi = Object.freeze({
    configure,
    installSelectionListeners,
    showPageConvertPrompt,
    removePageConvertPrompt,
    showToast,
    clearTransientUi
  });
})(globalThis);
