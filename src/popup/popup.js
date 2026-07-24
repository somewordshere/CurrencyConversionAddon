const enabledInput = document.getElementById("enabled");
const fromCurrencySelect = document.getElementById("fromCurrency");
const toCurrencySelect = document.getElementById("toCurrency");
const fromCurrencySearch = document.getElementById("fromCurrencySearch");
const toCurrencySearch = document.getElementById("toCurrencySearch");
const fromCurrencyList = document.getElementById("fromCurrencyList");
const toCurrencyList = document.getElementById("toCurrencyList");
const swapButton = document.getElementById("swapCurrencies");
const displayModeSelect = document.getElementById("displayMode");
const rememberSiteInput = document.getElementById("rememberSite");
const rememberSiteHelpNode = document.getElementById("rememberSiteHelp");
const convertSiteButton = document.getElementById("convertSite");
const clearPageButton = document.getElementById("clearPage");
const clearSiteButton = document.getElementById("clearSite");
const secondaryActionsNode = document.getElementById("secondaryActions");
const statusContainerNode = document.getElementById("statusContainer");
const statusNode = document.getElementById("status");
const rateInfoNode = document.getElementById("rateInfo");
const siteStateNode = document.getElementById("siteState");
const quickAmountInput = document.getElementById("quickAmount");
const quickResultNode = document.getElementById("quickResult");
const quickRateInfoNode = document.getElementById("quickRateInfo");
const currencyNames = new Intl.DisplayNames([navigator.language || "en"], { type: "currency" });
const M = CurrencyMessages;
const CONTENT_SCRIPT_FILES = [
  "/shared/browser-api.js", "/shared/currencies.js", "/shared/messages.js", "/content/number-parser.js",
  "/content/detector.js", "/content/converter.js", "/content/page-ui.js", "/content/content.js"
];
const CONTENT_STYLE_FILES = ["/content/styles.css"];
let activeTab = null;
let siteStatus = null;
let lastDetectedCurrency = null;
let currencies = [];
let recentCurrencies = [];
let currencyDetails = new Map();
let availableQuoteCurrencies = null;
let availableRatesSource = null;
let catalogWarning = null;
let quickConversionTimer = null;
let quickConversionRequestId = 0;
const defaultRememberSiteHelp = rememberSiteHelpNode.textContent;
const currencyComboboxes = [
  createCurrencyCombobox(fromCurrencySelect, fromCurrencySearch, fromCurrencyList),
  createCurrencyCombobox(toCurrencySelect, toCurrencySearch, toCurrencyList)
];

initialize().catch((error) => setStatus(error.message || "Could not initialize the extension.", "error"));

async function initialize() {
  [activeTab] = await ExtensionAPI.tabs.query({ active: true, currentWindow: true });
  const origin = getActiveOrigin();
  const activePageUrl = activeTab?.url || origin;
  const [currenciesResult, settingsResult, statusResult, localPreferences] = await Promise.all([
    ExtensionAPI.runtime.sendMessage({ type: M.GET_CURRENCIES }),
    ExtensionAPI.runtime.sendMessage({ type: M.GET_SETTINGS, origin: activePageUrl }),
    activePageUrl
      ? ExtensionAPI.runtime.sendMessage({ type: M.GET_SITE_STATUS, origin: activePageUrl })
      : Promise.resolve({ ok: false, remembered: false }),
    ExtensionAPI.storage.local.get("recentCurrencies")
  ]);

  if (!currenciesResult?.ok || !settingsResult?.ok) throw new Error("Could not load extension settings.");
  currencies = currenciesResult.currencies;
  currencyDetails = new Map((currenciesResult.details || []).map((currency) => [currency.code, currency]));
  catalogWarning = currenciesResult.warning || null;
  recentCurrencies = localPreferences.recentCurrencies || [];
  populateCurrencyLists();
  const settings = settingsResult.settings;
  enabledInput.checked = settings.enabled;
  fromCurrencySelect.value = settings.fromCurrency;
  toCurrencySelect.value = settings.toCurrency;
  syncCurrencyComboboxes();
  displayModeSelect.value = settings.displayMode;
  siteStatus = statusResult;
  rememberSiteInput.checked = Boolean(statusResult?.remembered);
  rememberSiteInput.disabled = !statusResult?.ok;
  rememberSiteInput.title = statusResult?.ok
    ? ""
    : statusResult?.error || "This page cannot be remembered.";
  rememberSiteHelpNode.textContent = statusResult?.ok
    ? defaultRememberSiteHelp
    : statusResult?.error || "This page cannot be remembered.";
  clearSiteButton.hidden = !statusResult?.remembered;
  let badgeText = "";
  if (activeTab?.id) {
    try {
      badgeText = await ExtensionAPI.action.getBadgeText({ tabId: activeTab.id });
    } catch (_error) {
      // Restricted pages may not expose tab-scoped action state.
    }
  }
  clearPageButton.disabled = !badgeText;
  updateSecondaryActions();
  updateSiteState();
  siteStateNode.title = `${currencies.length} provider currencies available${
    currenciesResult.stale ? " from cached catalog" : ""
  }${catalogWarning ? `. ${catalogWarning}` : ""}`;
  updateSwapState();

  enabledInput.addEventListener("change", saveSettings);
  fromCurrencySelect.addEventListener("change", saveSettings);
  toCurrencySelect.addEventListener("change", saveSettings);
  displayModeSelect.addEventListener("change", saveSettings);
  swapButton.addEventListener("click", swapCurrencies);
  rememberSiteInput.addEventListener("change", handleRememberSiteChange);
  convertSiteButton.addEventListener("click", convertWholeSite);
  clearPageButton.addEventListener("click", clearCurrentPage);
  clearSiteButton.addEventListener("click", clearWholeSite);
  quickAmountInput.addEventListener("input", scheduleQuickConversion);
  await calculateQuickConversion();

  const shortcutKeyNode = document.getElementById("shortcutKey");
  if (shortcutKeyNode && navigator.userAgent.includes("Mac")) {
    shortcutKeyNode.textContent = "⌘ Cmd";
  }
}

function populateCurrencyLists() {
  const selectedSource = fromCurrencySelect.value;
  const selectedTarget = toCurrencySelect.value;
  const prioritized = [...new Set([...recentCurrencies, ...currencies])]
    .filter((currency) => currencies.includes(currency));
  populateCurrencyList(fromCurrencySelect, ["AUTO", ...prioritized]);
  const availableTargets = availableQuoteCurrencies
    ? prioritized.filter((currency) => availableQuoteCurrencies.has(currency))
    : prioritized;
  populateCurrencyList(toCurrencySelect, availableTargets);
  if ([...fromCurrencySelect.options].some((option) => option.value === selectedSource)) {
    fromCurrencySelect.value = selectedSource;
  }
  if ([...toCurrencySelect.options].some((option) => option.value === selectedTarget)) {
    toCurrencySelect.value = selectedTarget;
  }
  syncCurrencyComboboxes();
}

function populateCurrencyList(list, options) {
  list.innerHTML = "";
  for (const currency of options) {
    const option = document.createElement("option");
    option.value = currency;
    option.textContent = currency === "AUTO"
      ? "AUTO"
      : `${currency} — ${getCurrencyName(currency)}`;
    list.appendChild(option);
  }
}

function getCurrencyName(currency) {
  if (currencyDetails.get(currency)?.name) return currencyDetails.get(currency).name;
  try {
    return currencyNames.of(currency) || currency;
  } catch (_error) {
    return currency;
  }
}

function createCurrencyCombobox(select, input, listbox) {
  const state = { select, input, listbox, matches: [], activeIndex: -1 };

  input.addEventListener("focus", () => {
    input.select();
    openCurrencyCombobox(state, "");
  });
  input.addEventListener("click", () => {
    if (input.getAttribute("aria-expanded") !== "true") openCurrencyCombobox(state, "");
  });
  input.addEventListener("input", () => openCurrencyCombobox(state, input.value));
  input.addEventListener("keydown", (event) => handleCurrencyComboboxKeydown(event, state));
  input.addEventListener("blur", () => window.setTimeout(() => closeCurrencyCombobox(state, true), 100));
  listbox.addEventListener("mousedown", (event) => event.preventDefault());
  listbox.addEventListener("click", (event) => {
    const option = event.target.closest("[role='option']");
    if (option) chooseCurrency(state, option.dataset.value);
  });
  return state;
}

function openCurrencyCombobox(state, query = "") {
  for (const combobox of currencyComboboxes) {
    if (combobox !== state) closeCurrencyCombobox(combobox, true);
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  state.matches = [...state.select.options].filter((option) =>
    !normalizedQuery || option.textContent.toLocaleLowerCase().includes(normalizedQuery)
  );
  state.activeIndex = Math.max(0, state.matches.findIndex((option) => option.value === state.select.value));
  renderCurrencyOptions(state);
  state.listbox.hidden = false;
  state.input.setAttribute("aria-expanded", "true");
}

function renderCurrencyOptions(state) {
  state.listbox.replaceChildren();
  if (!state.matches.length) {
    const empty = document.createElement("span");
    empty.className = "currency-list-empty";
    empty.textContent = "No currencies found";
    state.listbox.appendChild(empty);
    state.input.removeAttribute("aria-activedescendant");
    return;
  }

  state.matches.forEach((sourceOption, index) => {
    const option = document.createElement("span");
    option.id = `${state.listbox.id}-option-${sourceOption.value}`;
    option.className = "currency-list-option";
    option.setAttribute("role", "option");
    option.dataset.value = sourceOption.value;
    option.setAttribute("aria-selected", String(sourceOption.value === state.select.value));
    if (index === state.activeIndex) option.dataset.active = "true";

    const code = document.createElement("strong");
    code.textContent = sourceOption.value;
    option.appendChild(code);
    const name = document.createElement("span");
    name.textContent = sourceOption.value === "AUTO"
      ? "Detect automatically"
      : getCurrencyName(sourceOption.value);
    option.appendChild(name);
    state.listbox.appendChild(option);
  });
  updateActiveCurrencyOption(state);
}

function handleCurrencyComboboxKeydown(event, state) {
  if (event.key === "Escape") {
    closeCurrencyCombobox(state, true);
    state.input.select();
    return;
  }
  if (event.key === "Tab") {
    closeCurrencyCombobox(state, true);
    return;
  }
  if (event.key === "Enter") {
    if (state.input.getAttribute("aria-expanded") === "true" && state.matches[state.activeIndex]) {
      event.preventDefault();
      chooseCurrency(state, state.matches[state.activeIndex].value);
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  if (state.input.getAttribute("aria-expanded") !== "true") openCurrencyCombobox(state, "");
  const direction = event.key === "ArrowDown" ? 1 : -1;
  state.activeIndex = Math.min(state.matches.length - 1, Math.max(0, state.activeIndex + direction));
  updateActiveCurrencyOption(state);
}

function updateActiveCurrencyOption(state) {
  const options = [...state.listbox.querySelectorAll("[role='option']")];
  options.forEach((option, index) => {
    if (index === state.activeIndex) option.dataset.active = "true";
    else delete option.dataset.active;
  });
  const active = options[state.activeIndex];
  if (active) {
    state.input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  } else {
    state.input.removeAttribute("aria-activedescendant");
  }
}

function chooseCurrency(state, value) {
  state.select.value = value;
  syncCurrencyCombobox(state);
  closeCurrencyCombobox(state, false);
  state.input.focus();
  state.input.select();
  state.select.dispatchEvent(new Event("change", { bubbles: true }));
}

function closeCurrencyCombobox(state, restoreLabel) {
  state.listbox.hidden = true;
  state.input.setAttribute("aria-expanded", "false");
  state.input.removeAttribute("aria-activedescendant");
  if (restoreLabel) syncCurrencyCombobox(state);
}

function syncCurrencyCombobox(state) {
  const selected = state.select.selectedOptions[0];
  state.input.value = selected?.textContent || state.select.value;
}

function syncCurrencyComboboxes() {
  currencyComboboxes.forEach(syncCurrencyCombobox);
}

async function saveSettings() {
  if (!["AUTO", ...currencies].includes(fromCurrencySelect.value) ||
      !currencies.includes(toCurrencySelect.value)) {
    setStatus("Choose a currency from the suggestion list.", "error");
    return;
  }
  if (fromCurrencySelect.value === toCurrencySelect.value) {
    setStatus("Choose two different currencies.", "error");
    return;
  }
  const payload = {
    enabled: enabledInput.checked,
    fromCurrency: fromCurrencySelect.value,
    toCurrency: toCurrencySelect.value,
    displayMode: displayModeSelect.value
  };
  const result = await ExtensionAPI.runtime.sendMessage({
    type: M.UPDATE_SETTINGS,
    origin: activeTab?.url,
    payload
  });
  if (!result?.ok) {
    if (result?.settings) {
      fromCurrencySelect.value = result.settings.fromCurrency;
      toCurrencySelect.value = result.settings.toCurrency;
      displayModeSelect.value = result.settings.displayMode;
      enabledInput.checked = result.settings.enabled;
      syncCurrencyComboboxes();
      scheduleQuickConversion({ immediate: true });
    }
    setStatus(result?.error || "Could not save settings.", "error");
    return;
  }
  updateSwapState();
  await storeRecentCurrencies(payload);
  scheduleQuickConversion({ immediate: true });
  setStatus(payload.enabled ? "Webpage conversion is ready." : "Webpage conversion is off.", "success");
  const pageResult = await sendToActivePage(
    payload.enabled ? M.SHOW_CONVERT_PROMPT : M.CLEAR_SITE_CONVERSION,
    payload.enabled ? {} : { suppressPrompt: true }
  );
  if (!pageResult?.ok) setStatus(pageResult?.error || "This page cannot be accessed.", "error");
  else if (!payload.enabled) {
    clearPageButton.disabled = true;
    updateSecondaryActions();
  }
}

function swapCurrencies() {
  const source = fromCurrencySelect.value === "AUTO" ? lastDetectedCurrency : fromCurrencySelect.value;
  if (!source) {
    setStatus("Convert once so AUTO can identify the source currency.", "error");
    return;
  }
  const target = toCurrencySelect.value;
  replayAnimation(swapButton, "is-swapping");
  fromCurrencySelect.value = target;
  toCurrencySelect.value = source;
  syncCurrencyComboboxes();
  saveSettings();
}

function updateSwapState() {
  swapButton.title = fromCurrencySelect.value === "AUTO" && !lastDetectedCurrency
    ? "Convert once before swapping an automatically detected source"
    : "Swap currencies";
}

async function handleRememberSiteChange() {
  const origin = getActiveOrigin();
  if (!origin || !siteStatus?.ok) {
    rememberSiteInput.checked = false;
    setStatus("This page cannot be remembered.", "error");
    return;
  }

  rememberSiteInput.disabled = true;
  try {
    if (rememberSiteInput.checked) {
      const result = await ExtensionAPI.runtime.sendMessage({ type: M.REMEMBER_SITE, origin });
      if (!result?.ok) throw new Error(result?.error || "Could not remember this site.");
      siteStatus.remembered = true;
      clearSiteButton.hidden = false;
      updateSecondaryActions();
      setStatus("This website will convert automatically.", "success");
    } else {
      const result = await ExtensionAPI.runtime.sendMessage({ type: M.FORGET_SITE, origin });
      if (!result?.ok) throw new Error(result?.error || "Could not forget this site.");
      siteStatus.remembered = false;
      clearSiteButton.hidden = true;
      updateSecondaryActions();
      setStatus("Automatic conversion disabled for this website.", "success");
    }
  } catch (error) {
    rememberSiteInput.checked = Boolean(siteStatus?.remembered);
    setStatus(error.message, "error");
  } finally {
    rememberSiteInput.disabled = !siteStatus?.ok;
    updateSiteState();
  }
}

async function convertWholeSite() {
  if (!enabledInput.checked) {
    setStatus("Turn the extension on first.", "error");
    return;
  }
  setBusy(true);
  setStatus("Scanning prices…");
  const result = await sendToActivePage(M.RUN_SITE_CONVERSION);
  setBusy(false);
  if (!result?.ok) {
    setStatus(result?.error || "Could not convert this page.", "error");
    return;
  }
  lastDetectedCurrency = result.detectedCurrency || null;
  updateSwapState();
  scheduleQuickConversion({ immediate: true });
  clearPageButton.disabled = false;
  updateSecondaryActions();
  setStatus(
    `Converted ${result.count} price${result.count === 1 ? "" : "s"}.${
      result.scanLimited ? " Large-page scan limit reached." : ""
    }`,
    "success"
  );
  const fullRateInfo = result.rateDate
    ? `Rate date: ${result.rateDate}${result.rateProvider ? ` · ${result.rateProvider}` : ""}${
      result.staleRates ? ` · cached${result.cacheAgeLabel ? `, ${result.cacheAgeLabel}` : ""}` : ""
    }${result.rateWarning ? ` · Warning: ${result.rateWarning}` : ""}`
    : "";
  rateInfoNode.textContent = result.rateDate
    ? `Rate ${result.rateDate}${result.staleRates ? ` · Cached${result.cacheAgeLabel ? `, ${result.cacheAgeLabel}` : ""}` : ""}`
    : "";
  rateInfoNode.title = fullRateInfo;
  if (result.rateWarning) rateInfoNode.dataset.kind = "warning";
  else delete rateInfoNode.dataset.kind;
}

async function clearWholeSite() {
  const result = await sendToActivePage(M.CLEAR_SITE_CONVERSION, { forgetSite: true });
  if (!result?.ok) {
    setStatus(result?.error || "Could not clear this page.", "error");
    return;
  }
  siteStatus.remembered = false;
  rememberSiteInput.checked = false;
  clearSiteButton.hidden = true;
  updateSecondaryActions();
  updateSiteState();
  setStatus("Conversion cleared and automatic conversion disabled.", "success");
}

async function clearCurrentPage() {
  const result = await sendToActivePage(M.CLEAR_SITE_CONVERSION, {
    forgetSite: false,
    suppressPrompt: true
  });
  setStatus(
    result?.ok ? "Conversion undone on this page." : result?.error || "Could not undo conversion.",
    result?.ok ? "success" : "error"
  );
  if (result?.ok) {
    clearPageButton.disabled = true;
    updateSecondaryActions();
  }
}

function setBusy(busy) {
  convertSiteButton.disabled = busy;
  convertSiteButton.textContent = busy ? "Converting…" : "Convert page prices";
}

function updateSecondaryActions() {
  secondaryActionsNode.hidden = false;
}

function setStatus(message, kind = "") {
  statusNode.textContent = message;
  if (kind) {
    statusNode.dataset.kind = kind;
    statusContainerNode.dataset.kind = kind;
  } else {
    delete statusNode.dataset.kind;
    delete statusContainerNode.dataset.kind;
  }
  statusContainerNode.style.display = message ? "block" : "none";
  if (message && kind === "success") replayAnimation(statusContainerNode, "is-success-pulse");
}

function replayAnimation(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  node.addEventListener("animationend", () => node.classList.remove(className), { once: true });
}

function scheduleQuickConversion({ immediate = false } = {}) {
  if (quickConversionTimer) window.clearTimeout(quickConversionTimer);
  quickConversionTimer = window.setTimeout(calculateQuickConversion, immediate ? 0 : 250);
}

async function calculateQuickConversion() {
  quickConversionTimer = null;
  const requestId = ++quickConversionRequestId;
  const sourceCurrency = fromCurrencySelect.value === "AUTO"
    ? lastDetectedCurrency
    : fromCurrencySelect.value;
  const targetCurrency = toCurrencySelect.value;
  const amountText = quickAmountInput.value.trim();

  if (!sourceCurrency) {
    availableQuoteCurrencies = null;
    availableRatesSource = null;
    populateCurrencyLists();
    setQuickConversionState("—", "Select a source currency to calculate.", "empty");
    return;
  }
  if (!currencies.includes(sourceCurrency) || !currencies.includes(targetCurrency)) {
    setQuickConversionState("Choose currencies", "Select supported source and target currencies.", "error");
    return;
  }
  if (sourceCurrency === targetCurrency) {
    setQuickConversionState("Choose different currencies", "Source and target must differ.", "error");
    return;
  }
  if (!amountText) {
    setQuickConversionState("Enter an amount", "", "error");
    return;
  }

  const amount = CurrencyNumberParser.parseLocaleNumber(amountText);
  if (!Number.isFinite(amount)) {
    setQuickConversionState("Invalid amount", "Use a number such as 100 or 1,234.56.", "error");
    return;
  }

  setQuickConversionState("Converting…", "", "loading");
  if (availableRatesSource !== sourceCurrency) {
    availableQuoteCurrencies = null;
    availableRatesSource = sourceCurrency;
  }
  const result = await ExtensionAPI.runtime.sendMessage({ type: M.GET_RATES, baseCurrency: sourceCurrency });
  if (requestId !== quickConversionRequestId) return;
  if (result?.ok) {
    availableQuoteCurrencies = new Set(Object.keys(result.rates || {}));
    availableQuoteCurrencies.add(sourceCurrency);
    populateCurrencyLists();
  }
  const rate = result?.rates?.[targetCurrency];
  if (!result?.ok || !Number.isFinite(rate)) {
    setQuickConversionState(
      "Rate unavailable",
      result?.error || `No ${sourceCurrency} to ${targetCurrency} rate is available.`,
      "error"
    );
    return;
  }

  const converted = CurrencyCatalog.formatCurrencyAmount(amount * rate, targetCurrency);
  const details = [
    `1 ${sourceCurrency} = ${rate} ${targetCurrency}`,
    result.date ? `Rate date: ${result.date}` : null,
    result.provider || null,
    result.stale ? `Cached${result.cacheAgeLabel ? `, ${result.cacheAgeLabel}` : ""}` : null,
    result.warning || null,
    catalogWarning ? `Currency catalog: ${catalogWarning}` : null
  ].filter(Boolean).join(" · ");
  const summary = [
    `1 ${sourceCurrency} = ${rate} ${targetCurrency}`,
    result.date || null,
    result.stale ? `Cached${result.cacheAgeLabel ? `, ${result.cacheAgeLabel}` : ""}` : null
  ].filter(Boolean).join(" · ");
  setQuickConversionState(converted, summary, result.warning ? "warning" : "success", details);
}

function setQuickConversionState(result, details, kind, fullDetails = details) {
  quickResultNode.textContent = result;
  quickResultNode.dataset.kind = kind;
  quickRateInfoNode.textContent = details;
  quickRateInfoNode.title = fullDetails;
  if (kind === "warning") quickRateInfoNode.dataset.kind = "warning";
  else delete quickRateInfoNode.dataset.kind;
  if (kind !== "loading") replayAnimation(quickResultNode, "is-updated");
}

function updateSiteState() {
  const hostname = activeTab?.url ? safeUrl(activeTab.url)?.hostname : "";
  siteStateNode.textContent = siteStatus?.remembered
    ? `${hostname || "Current site"} · automatic conversion on`
    : hostname || "Current page";
}

function getActiveOrigin() {
  const url = safeUrl(activeTab?.url);
  return url && /^https?:$/.test(url.protocol) ? url.origin : null;
}

function safeUrl(value) {
  try { return new URL(value); } catch (_error) { return null; }
}

async function storeRecentCurrencies(settings) {
  const candidates = [settings.fromCurrency, settings.toCurrency, ...recentCurrencies]
    .filter((currency) => currency !== "AUTO");
  recentCurrencies = [...new Set(candidates)].slice(0, 6);
  await ExtensionAPI.storage.local.set({ recentCurrencies });
  populateCurrencyLists();
}

async function sendToActivePage(type, payload = {}) {
  if (!activeTab?.id) return { ok: false, error: "No active tab found." };
  const unsupportedPage = CurrencyPageAccess.unsupportedPageMessage(activeTab.url);
  if (unsupportedPage) return { ok: false, error: unsupportedPage };
  try {
    await ensureContentScripts(activeTab.id);
    return await ExtensionAPI.tabs.sendMessage(activeTab.id, { type, ...payload }) || {
      ok: false,
      error: "The page did not respond. Reload it once and try again."
    };
  } catch (error) {
    console.error("Currency Converter Pro could not reach the active page.", error);
    return { ok: false, error: CurrencyPageAccess.describeFailure(activeTab, error) };
  }
}

async function ensureContentScripts(tabId) {
  try {
    await ExtensionAPI.tabs.sendMessage(tabId, { type: M.CONTENT_READY });
    return;
  } catch (_error) {
    // The converter is not loaded in this document yet.
  }

  try {
    await ExtensionAPI.scripting.insertCSS({ target: { tabId }, files: CONTENT_STYLE_FILES });
  } catch (error) {
    throw new Error(`The page styles could not be loaded: ${errorMessage(error)}`);
  }

  try {
    await ExtensionAPI.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  } catch (error) {
    throw new Error(`The page converter could not be loaded: ${errorMessage(error)}`);
  }
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error || "Unknown browser error");
}
