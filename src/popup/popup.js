const enabledInput = document.getElementById("enabled");
const popupAppNode = document.getElementById("popupApp");
const fromCurrencySelect = document.getElementById("fromCurrency");
const toCurrencySelect = document.getElementById("toCurrency");
const fromCurrencySearch = document.getElementById("fromCurrencySearch");
const toCurrencySearch = document.getElementById("toCurrencySearch");
const fromCurrencyList = document.getElementById("fromCurrencyList");
const toCurrencyList = document.getElementById("toCurrencyList");
const swapButton = document.getElementById("swapCurrencies");
const displayModeSelect = document.getElementById("displayMode");
const convertedTextColorInput = document.getElementById("convertedTextColor");
const convertedTextColorHexInput = document.getElementById("convertedTextColorHex");
const convertedBackgroundColorInput = document.getElementById("convertedBackgroundColor");
const convertedBackgroundColorHexInput = document.getElementById("convertedBackgroundColorHex");
const convertedShapeInputs = [...document.querySelectorAll("input[name='convertedShape']")];
const appearancePreviewNode = document.getElementById("appearancePreview");
const appearanceContrastNode = document.getElementById("appearanceContrast");
const appearanceAnnouncementNode = document.getElementById("appearanceAnnouncement");
const resetAppearanceButton = document.getElementById("resetAppearance");
const showPagePromptInput = document.getElementById("showPagePrompt");
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
const quickConverterNode = document.getElementById("quickConverter");
const pageOptionsNode = document.getElementById("pageOptions");
const quickConverterFieldsNode = document.getElementById("quickConverterFields");
const quickSourceRequiredNode = document.getElementById("quickSourceRequired");
const chooseQuickSourceButton = document.getElementById("chooseQuickSource");
const currencyNames = new Intl.DisplayNames([navigator.language || "en"], { type: "currency" });
const M = CurrencyMessages;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_APPEARANCE = Object.freeze({
  convertedTextColor: "#166534",
  convertedBackgroundColor: "#dcfce7",
  convertedShape: "rounded"
});
const SHAPE_RADII = Object.freeze({
  square: "0",
  rounded: "0.35em",
  pill: "999px"
});
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
let appearanceAnnouncementTimer = null;
let quickConversionRequestId = 0;
let pageConversionError = null;
let primaryActionBusy = false;
let popupReady = false;
let popupLocked = false;
let confirmedSettings = null;
let settingsWriteRevision = 0;
let settingsDraftRevision = 0;
let latestSettingsWrite = Promise.resolve(true);
let latestDispatchedSettingsWrite = Promise.resolve(null);
const defaultRememberSiteHelp = rememberSiteHelpNode.textContent;
const currencyComboboxes = [
  createCurrencyCombobox(fromCurrencySelect, fromCurrencySearch, fromCurrencyList),
  createCurrencyCombobox(toCurrencySelect, toCurrencySearch, toCurrencyList)
];

initialize().then(() => {
  popupReady = true;
  setPopupInteractivity(true);
}).catch(handleInitializationFailure);

async function initialize() {
  [activeTab] = await ExtensionAPI.tabs.query({ active: true, currentWindow: true });
  const origin = getActiveOrigin();
  const activePageUrl = activeTab?.url || origin;
  pageConversionError = activeTab?.id
    ? CurrencyPageAccess.unsupportedPageMessage(activePageUrl)
    : "No active webpage is available.";
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
  confirmedSettings = normalizeSettingsSnapshot(settingsResult.settings);
  if (!confirmedSettings) throw new Error("The extension returned invalid settings.");
  latestDispatchedSettingsWrite = Promise.resolve({ ok: true, settings: confirmedSettings });
  const settings = confirmedSettings;
  enabledInput.checked = settings.enabled;
  fromCurrencySelect.value = settings.fromCurrency;
  toCurrencySelect.value = settings.toCurrency;
  syncCurrencyComboboxes();
  displayModeSelect.value = settings.displayMode;
  applyAppearanceSettings(settings, { announce: false });
  showPagePromptInput.checked = settings.showPagePrompt;
  siteStatus = statusResult;
  rememberSiteInput.checked = Boolean(statusResult?.remembered);
  rememberSiteInput.disabled = true;
  rememberSiteInput.title = statusResult?.ok
    ? ""
    : statusResult?.error || "This page cannot be remembered.";
  const activeHostname = safeUrl(activePageUrl)?.hostname;
  rememberSiteHelpNode.textContent = statusResult?.ok
    ? activeHostname
      ? statusResult.requiresPermission === false
        ? `Converts prices automatically on ${activeHostname}. Price scanning stays on this device.`
        : `Allows automatic conversion on ${activeHostname}. Your browser will ask once; page contents stay on this device, and you can remove access here.`
      : defaultRememberSiteHelp
    : statusResult?.error || "This page cannot be remembered.";
  clearSiteButton.hidden = !statusResult?.cleanupRequired;
  let badgeText = "";
  if (activeTab?.id) {
    try {
      badgeText = await ExtensionAPI.action.getBadgeText({ tabId: activeTab.id });
    } catch (_error) {
      // Restricted pages may not expose tab-scoped action state.
    }
  }
  clearPageButton.hidden = !badgeText;
  clearPageButton.disabled = true;
  updateSecondaryActions();
  updateSiteState();
  siteStateNode.title = `${currencies.length} provider currencies available${
    currenciesResult.stale ? " from cached catalog" : ""
  }${catalogWarning ? `. ${catalogWarning}` : ""}`;
  updateSwapState();
  updatePrimaryActionLabel();
  if (pageConversionError) {
    setStatus(`${pageConversionError} You can still convert a custom amount.`, "warning");
  }

  enabledInput.addEventListener("change", () => {
    updatePrimaryActionLabel();
    saveSettings();
  });
  fromCurrencySelect.addEventListener("change", () => saveSettings());
  toCurrencySelect.addEventListener("change", () => saveSettings());
  displayModeSelect.addEventListener("change", () => saveSettings());
  bindAppearanceControls();
  showPagePromptInput.addEventListener("change", () => saveSettings());
  swapButton.addEventListener("click", swapCurrencies);
  rememberSiteInput.addEventListener("change", handleRememberSiteChange);
  convertSiteButton.addEventListener("click", convertWholeSite);
  clearPageButton.addEventListener("click", clearCurrentPage);
  clearSiteButton.addEventListener("click", clearWholeSite);
  quickAmountInput.addEventListener("input", scheduleQuickConversion);
  chooseQuickSourceButton.addEventListener("click", () => fromCurrencySearch.focus());
  quickConverterNode.addEventListener("toggle", () => {
    if (quickConverterNode.open) scheduleQuickConversion({ immediate: true });
  });
  if (quickConverterNode.open) await calculateQuickConversion();

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

function bindAppearanceControls() {
  bindColorControl(convertedTextColorInput, convertedTextColorHexInput);
  bindColorControl(convertedBackgroundColorInput, convertedBackgroundColorHexInput);
  for (const input of convertedShapeInputs) {
    input.addEventListener("change", () => {
      updateAppearancePreview();
      saveSettings();
    });
  }
  resetAppearanceButton.addEventListener("click", () => {
    applyAppearanceSettings(DEFAULT_APPEARANCE);
    saveSettings();
  });
}

function bindColorControl(colorInput, hexInput) {
  colorInput.addEventListener("input", () => {
    markSettingsDraft();
    hexInput.value = colorInput.value.toUpperCase();
    clearHexColorError(hexInput);
    updateAppearancePreview();
  });
  colorInput.addEventListener("change", () => saveSettings());
  hexInput.addEventListener("input", () => {
    markSettingsDraft();
    const color = normalizeHexColor(hexInput.value);
    if (!color) {
      hexInput.setAttribute("aria-invalid", "true");
      return;
    }
    clearHexColorError(hexInput);
    colorInput.value = color;
    updateAppearancePreview();
  });
  hexInput.addEventListener("change", () => {
    const color = normalizeHexColor(hexInput.value);
    if (!color) {
      hexInput.setAttribute("aria-invalid", "true");
      hexInput.setCustomValidity("Enter a six-digit hex color, for example #166534.");
      setStatus("Use a six-digit hex color such as #166534.", "error");
      return;
    }
    clearHexColorError(hexInput);
    colorInput.value = color;
    hexInput.value = color.toUpperCase();
    updateAppearancePreview();
    saveSettings();
  });
}

function clearHexColorError(input) {
  input.removeAttribute("aria-invalid");
  input.setCustomValidity("");
}

function markSettingsDraft() {
  settingsDraftRevision += 1;
}

function normalizeHexColor(value) {
  const candidate = String(value || "").trim();
  return HEX_COLOR_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

function selectedConvertedShape() {
  return convertedShapeInputs.find((input) => input.checked)?.value ||
    DEFAULT_APPEARANCE.convertedShape;
}

function applyAppearanceSettings(settings, { announce = true } = {}) {
  const textColor = normalizeHexColor(settings?.convertedTextColor) ||
    DEFAULT_APPEARANCE.convertedTextColor;
  const backgroundColor = normalizeHexColor(settings?.convertedBackgroundColor) ||
    DEFAULT_APPEARANCE.convertedBackgroundColor;
  const shape = Object.hasOwn(SHAPE_RADII, settings?.convertedShape)
    ? settings.convertedShape
    : DEFAULT_APPEARANCE.convertedShape;

  convertedTextColorInput.value = textColor;
  convertedTextColorHexInput.value = textColor.toUpperCase();
  convertedBackgroundColorInput.value = backgroundColor;
  convertedBackgroundColorHexInput.value = backgroundColor.toUpperCase();
  clearHexColorError(convertedTextColorHexInput);
  clearHexColorError(convertedBackgroundColorHexInput);
  for (const input of convertedShapeInputs) input.checked = input.value === shape;
  updateAppearancePreview({ announce });
}

function updateAppearancePreview({ announce = true } = {}) {
  const textColor = normalizeHexColor(convertedTextColorInput.value) ||
    DEFAULT_APPEARANCE.convertedTextColor;
  const backgroundColor = normalizeHexColor(convertedBackgroundColorInput.value) ||
    DEFAULT_APPEARANCE.convertedBackgroundColor;
  const shape = selectedConvertedShape();
  const radius = SHAPE_RADII[shape] || SHAPE_RADII.rounded;

  appearancePreviewNode.style.color = textColor;
  appearancePreviewNode.style.backgroundColor = backgroundColor;
  appearancePreviewNode.style.borderRadius = radius;
  appearancePreviewNode.setAttribute(
    "aria-label",
    `After preview: approximately 90 euros, with ${textColor.toUpperCase()} text on a ${backgroundColor.toUpperCase()} background and ${shape} corners.`
  );

  const contrast = colorContrastRatio(textColor, backgroundColor);
  const result = describeContrast(contrast);
  appearanceContrastNode.dataset.kind = result.kind;
  appearanceContrastNode.textContent = result.text;
  updateAppearanceResetState();
  if (announce) {
    scheduleAppearanceAnnouncement(
      `Preview updated to ${shape} corners with ${textColor.toUpperCase()} text and ${backgroundColor.toUpperCase()} background. ${result.text}`
    );
  }
}

function describeContrast(contrast) {
  const ratio = contrast.toFixed(2);
  if (contrast >= 7) {
    return { kind: "pass", text: `Contrast ${ratio}:1 — passes WCAG AAA for normal text.` };
  }
  if (contrast >= 4.5) {
    return { kind: "pass", text: `Contrast ${ratio}:1 — passes WCAG AA for normal text.` };
  }
  if (contrast >= 3) {
    return {
      kind: "warning",
      text: `Contrast ${ratio}:1 — too low for normal text; aim for at least 4.5:1.`
    };
  }
  return {
    kind: "fail",
    text: `Contrast ${ratio}:1 — fails WCAG AA; choose colors with more separation.`
  };
}

function colorContrastRatio(first, second) {
  const firstLuminance = colorLuminance(first);
  const secondLuminance = colorLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorLuminance(color) {
  const channels = color.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function scheduleAppearanceAnnouncement(message) {
  window.clearTimeout(appearanceAnnouncementTimer);
  appearanceAnnouncementTimer = window.setTimeout(() => {
    appearanceAnnouncementNode.textContent = message;
  }, 300);
}

function updateAppearanceResetState() {
  resetAppearanceButton.disabled = !popupReady || popupLocked;
}

function saveSettings({ syncPage = true } = {}) {
  const revision = ++settingsWriteRevision;
  const draftRevision = settingsDraftRevision;
  const payload = readSettingsFromControls();
  const validationError = validateSettingsPayload(payload);
  let outcomePromise;
  if (validationError) {
    outcomePromise = reconcileLocalValidationFailure(validationError);
  } else {
    outcomePromise = persistSettingsPayload(payload);
    latestDispatchedSettingsWrite = outcomePromise;
  }
  const completion = outcomePromise.then((outcome) => {
    if (revision !== settingsWriteRevision || draftRevision !== settingsDraftRevision) {
      return Boolean(outcome?.ok);
    }
    return settleSettingsOutcome(outcome, payload, { revision, syncPage });
  }).catch((error) => {
    if (revision === settingsWriteRevision && draftRevision === settingsDraftRevision) {
      lockPopupInteractions(
        `Settings could not be saved or reloaded. ${errorMessage(error)} Close and reopen the popup to try again.`
      );
    }
    return false;
  });
  const waitForLatest = completion.then((saved) => {
    if (revision === settingsWriteRevision) return saved;
    return latestSettingsWrite;
  });
  latestSettingsWrite = waitForLatest;
  return waitForLatest;
}

async function reconcileLocalValidationFailure(validationError) {
  const pendingWrite = latestDispatchedSettingsWrite;
  let priorOutcome = null;
  try {
    priorOutcome = await pendingWrite;
  } catch (_error) {
    // Reload below if an unexpected write failure escaped normal reconciliation.
  }
  const priorSettings = normalizeSettingsSnapshot(priorOutcome?.settings);
  const actualSettings = priorSettings || await fetchActualSettings();
  if (!actualSettings && priorOutcome?.fatal) {
    return {
      ok: false,
      fatal: true,
      error: `${validationError} ${priorOutcome.error || "Current settings could not be reloaded."}`
    };
  }
  return {
    ok: false,
    settings: actualSettings || confirmedSettings,
    error: validationError
  };
}

function handleInitializationFailure(error) {
  popupLocked = true;
  siteStateNode.textContent = "Popup unavailable";
  setPopupInteractivity(false);
  setStatus(
    `Currency Converter Pro could not start. ${errorMessage(error)} Close and reopen the popup to try again.`,
    "error"
  );
}

function lockPopupInteractions(message) {
  popupLocked = true;
  setPopupInteractivity(false);
  setStatus(message, "error");
}

function setPopupInteractivity(enabled) {
  const interactive = Boolean(enabled && popupReady && !popupLocked);
  popupAppNode.setAttribute("aria-busy", String(!popupReady && !popupLocked));
  quickConverterNode.inert = !interactive;
  pageOptionsNode.inert = !interactive;

  for (const control of [
    fromCurrencySelect,
    toCurrencySelect,
    fromCurrencySearch,
    toCurrencySearch,
    swapButton,
    displayModeSelect,
    convertedTextColorInput,
    convertedTextColorHexInput,
    convertedBackgroundColorInput,
    convertedBackgroundColorHexInput,
    ...convertedShapeInputs,
    resetAppearanceButton,
    showPagePromptInput,
    enabledInput,
    quickAmountInput,
    chooseQuickSourceButton
  ]) {
    control.disabled = !interactive;
  }

  rememberSiteInput.disabled = !interactive || !siteStatus?.ok;
  if (!interactive) {
    clearPageButton.disabled = true;
    clearSiteButton.disabled = true;
  }
  updateSecondaryActions();
  updatePrimaryActionLabel();
  updateAppearanceResetState();
}

function readSettingsFromControls() {
  return {
    enabled: enabledInput.checked,
    fromCurrency: fromCurrencySelect.value,
    toCurrency: toCurrencySelect.value,
    displayMode: displayModeSelect.value,
    convertedTextColor: convertedTextColorInput.value,
    convertedBackgroundColor: convertedBackgroundColorInput.value,
    convertedShape: selectedConvertedShape(),
    showPagePrompt: showPagePromptInput.checked
  };
}

function validateSettingsPayload(payload) {
  if (!["AUTO", ...currencies].includes(payload.fromCurrency) ||
      !currencies.includes(payload.toCurrency)) {
    return "Choose a currency from the suggestion list.";
  }
  if (payload.fromCurrency === payload.toCurrency) return "Choose two different currencies.";
  if (!normalizeHexColor(payload.convertedTextColor) ||
      !normalizeHexColor(payload.convertedBackgroundColor)) {
    return "Use six-digit hex colors such as #166534.";
  }
  if (!Object.hasOwn(SHAPE_RADII, payload.convertedShape)) {
    return "Choose a supported converted-price shape.";
  }
  return null;
}

async function persistSettingsPayload(payload) {
  let result;
  try {
    result = await ExtensionAPI.runtime.sendMessage({
      type: M.UPDATE_SETTINGS,
      origin: activeTab?.url,
      payload
    });
  } catch (error) {
    console.error("Currency Converter Pro could not confirm the settings update.", error);
    return reconcileSettingsAfterAmbiguousFailure(payload);
  }

  const returnedSettings = normalizeSettingsSnapshot(result?.settings);
  if (result?.ok === true && returnedSettings) {
    return { ok: true, settings: returnedSettings };
  }
  if (result?.ok === false && returnedSettings) {
    return {
      ok: false,
      settings: returnedSettings,
      error: result.error || "Could not save settings."
    };
  }
  return reconcileSettingsAfterAmbiguousFailure(payload, result?.error);
}

async function reconcileSettingsAfterAmbiguousFailure(payload, reportedError) {
  const actualSettings = await fetchActualSettings();
  if (!actualSettings) {
    return {
      ok: false,
      fatal: true,
      error: "The settings update could not be confirmed, and the current settings could not be reloaded. Close and reopen the popup to try again."
    };
  }
  if (settingsSnapshotsMatch(actualSettings, payload)) {
    return { ok: true, settings: actualSettings, reconciled: true };
  }
  return {
    ok: false,
    settings: actualSettings,
    error: reportedError
      ? `${reportedError} The popup reloaded the current settings.`
      : "The settings update could not be confirmed. The popup reloaded the current settings."
  };
}

async function fetchActualSettings() {
  try {
    const result = await ExtensionAPI.runtime.sendMessage({
      type: M.GET_SETTINGS,
      origin: activeTab?.url
    });
    return result?.ok ? normalizeSettingsSnapshot(result.settings) : null;
  } catch (error) {
    console.error("Currency Converter Pro could not reload the current settings.", error);
    return null;
  }
}

async function settleSettingsOutcome(outcome, payload, { revision, syncPage }) {
  if (!outcome.ok) {
    if (outcome.settings) {
      confirmedSettings = normalizeSettingsSnapshot(outcome.settings);
      applySettingsToControls(confirmedSettings);
    }
    if (outcome.fatal) lockPopupInteractions(outcome.error);
    else setStatus(outcome.error || "Could not save settings.", "error");
    return false;
  }

  confirmedSettings = normalizeSettingsSnapshot(outcome.settings) || payload;
  applySettingsToControls(confirmedSettings);
  try {
    await storeRecentCurrencies(confirmedSettings);
  } catch (_error) {
    // Recent currencies are a convenience and do not affect whether the settings were saved.
  }
  if (revision !== settingsWriteRevision) return true;

  scheduleQuickConversion({ immediate: true });
  setStatus(
    confirmedSettings.enabled
      ? "Webpage conversion is ready."
      : siteStatus?.remembered
        ? "Converter is off. Automatic conversion is paused; the site choice remains."
        : "Converter is off.",
    "success"
  );
  if (syncPage) {
    const pageResult = await sendToActivePage(
      confirmedSettings.enabled ? M.SHOW_CONVERT_PROMPT : M.CLEAR_SITE_CONVERSION,
      confirmedSettings.enabled ? {} : { suppressPrompt: true }
    );
    if (revision !== settingsWriteRevision) return true;
    if (!pageResult?.ok) setStatus(pageResult?.error || "This page cannot be accessed.", "error");
    else if (!confirmedSettings.enabled) {
      clearPageButton.disabled = true;
      clearPageButton.hidden = true;
      updateSecondaryActions();
    }
  }
  updateSiteState();
  return true;
}

function normalizeSettingsSnapshot(settings) {
  if (!settings || typeof settings !== "object" ||
      typeof settings.enabled !== "boolean" ||
      typeof settings.fromCurrency !== "string" ||
      typeof settings.toCurrency !== "string" ||
      typeof settings.displayMode !== "string" ||
      !normalizeHexColor(settings.convertedTextColor) ||
      !normalizeHexColor(settings.convertedBackgroundColor) ||
      !Object.hasOwn(SHAPE_RADII, settings.convertedShape) ||
      typeof settings.showPagePrompt !== "boolean") {
    return null;
  }
  return {
    enabled: settings.enabled,
    fromCurrency: settings.fromCurrency,
    toCurrency: settings.toCurrency,
    displayMode: settings.displayMode,
    convertedTextColor: normalizeHexColor(settings.convertedTextColor),
    convertedBackgroundColor: normalizeHexColor(settings.convertedBackgroundColor),
    convertedShape: settings.convertedShape,
    showPagePrompt: settings.showPagePrompt
  };
}

function settingsSnapshotsMatch(left, right) {
  return Boolean(left && right) &&
    left.enabled === right.enabled &&
    left.fromCurrency === right.fromCurrency &&
    left.toCurrency === right.toCurrency &&
    left.displayMode === right.displayMode &&
    left.convertedTextColor === right.convertedTextColor &&
    left.convertedBackgroundColor === right.convertedBackgroundColor &&
    left.convertedShape === right.convertedShape &&
    left.showPagePrompt === right.showPagePrompt;
}

function applySettingsToControls(settings) {
  if (!settings) return;
  enabledInput.checked = settings.enabled;
  fromCurrencySelect.value = settings.fromCurrency;
  toCurrencySelect.value = settings.toCurrency;
  displayModeSelect.value = settings.displayMode;
  applyAppearanceSettings(settings, { announce: false });
  showPagePromptInput.checked = settings.showPagePrompt;
  syncCurrencyComboboxes();
  updatePrimaryActionLabel();
  updateSwapState();
  updateSiteState();
  scheduleQuickConversion({ immediate: true });
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
  if (!origin || !siteStatus?.pattern) {
    rememberSiteInput.checked = false;
    setStatus("This page cannot be remembered.", "error");
    return;
  }

  rememberSiteInput.disabled = true;
  let newlyGrantedPattern = null;
  let setupFailureState = null;
  try {
    if (rememberSiteInput.checked) {
      if (siteStatus.requiresPermission !== false) {
        const granted = await ExtensionAPI.permissions.request({ origins: [siteStatus.pattern] });
        if (!granted) {
          rememberSiteInput.checked = false;
          setStatus("Access was not granted. Automatic conversion is still off.", "error");
          return;
        }
        newlyGrantedPattern = siteStatus.pattern;
      }
      const result = await ExtensionAPI.runtime.sendMessage({ type: M.REMEMBER_SITE, origin });
      if (!result?.ok) {
        setupFailureState = result;
        siteStatus.remembered = Boolean(result?.remembered);
        siteStatus.hasPermission = result?.permissionRemaining === true;
        siteStatus.revocablePermission = result?.permissionRemaining === true;
        throw new Error(result?.error || "Could not remember this site.");
      }
      newlyGrantedPattern = null;
      siteStatus.remembered = true;
      siteStatus.hasPermission = true;
      siteStatus.revocablePermission = siteStatus.requiresPermission !== false;
      clearSiteButton.hidden = true;
      updateSecondaryActions();
      setStatus(`Automatic conversion is on for ${safeUrl(origin)?.hostname || "this site"}.`, "success");
    } else {
      const pageClearResult = await sendToActivePage(M.CLEAR_SITE_CONVERSION, {
        forgetSite: false,
        suppressPrompt: true
      });
      const result = await ExtensionAPI.runtime.sendMessage({ type: M.FORGET_SITE, origin });
      if (!result?.ok) {
        siteStatus.remembered = Boolean(result?.remembered);
        siteStatus.hasPermission = result?.permissionRemaining === true;
        clearSiteButton.hidden = false;
        throw new Error(result?.error || "Could not disable automatic conversion for this site.");
      }
      siteStatus.remembered = false;
      siteStatus.hasPermission = siteStatus.requiresPermission === false;
      siteStatus.revocablePermission = false;
      clearSiteButton.hidden = true;
      if (pageClearResult?.ok) {
        clearPageButton.disabled = true;
        clearPageButton.hidden = true;
      }
      updateSecondaryActions();
      setStatus(
        pageClearResult?.ok
          ? siteStatus.requiresPermission === false
            ? `Automatic conversion is off for ${safeUrl(origin)?.hostname || "this site"}. Price detection remains available.`
            : `Automatic conversion is off and access to ${safeUrl(origin)?.hostname || "this site"} was removed.`
          : siteStatus.requiresPermission === false
            ? "Automatic conversion is off. Reload this page if an existing conversion remains visible."
            : "Site access was removed. Reload this page if an existing conversion remains visible.",
        pageClearResult?.ok ? "success" : "warning"
      );
    }
  } catch (error) {
    if (newlyGrantedPattern) {
      try {
        await ExtensionAPI.permissions.remove({ origins: [newlyGrantedPattern] });
      } catch (_cleanupError) {
        // The background also attempts rollback; the visible error still tells the user setup failed.
      }
      try {
        const refreshed = await ExtensionAPI.runtime.sendMessage({
          type: M.GET_SITE_STATUS,
          origin
        });
        if (refreshed?.ok) siteStatus = refreshed;
      } catch (_refreshError) {
        // Keep the conservative failure state returned by the background.
      }
    }
    clearSiteButton.hidden = !(
      siteStatus?.revocablePermission ||
      setupFailureState?.registrationRemaining ||
      setupFailureState?.dataRemaining
    );
    rememberSiteInput.checked = Boolean(siteStatus?.remembered);
    setStatus(error.message, "error");
  } finally {
    rememberSiteInput.disabled = !popupReady || popupLocked || !siteStatus?.ok;
    updateSiteState();
    updateSecondaryActions();
  }
}

async function convertWholeSite() {
  if (pageConversionError) {
    setStatus(`${pageConversionError} You can still convert a custom amount.`, "warning");
    return;
  }
  const turningOn = !enabledInput.checked;
  if (turningOn) {
    enabledInput.checked = true;
    setBusy(true, { turningOn: true });
    const saved = await saveSettings({ syncPage: false });
    if (!saved) {
      setBusy(false);
      updateSiteState();
      return;
    }
  } else {
    setBusy(true);
  }
  setStatus("Scanning prices…");
  const result = await sendToActivePage(M.RUN_SITE_CONVERSION);
  setBusy(false);
  if (result?.cancelled) {
    clearPageButton.hidden = true;
    updateSecondaryActions();
    setStatus(
      enabledInput.checked
        ? "Conversion cancelled."
        : siteStatus?.remembered
          ? "Converter is off. Automatic conversion is paused; the site choice remains."
          : "Converter is off.",
      enabledInput.checked ? "warning" : "success"
    );
    return;
  }
  if (!result?.ok && !Number.isFinite(result?.count)) {
    setStatus(
      turningOn
        ? `The converter is on, but this page could not be converted. ${
          result?.error || "Try again."
        }`
        : result?.error || "Could not convert this page.",
      "error"
    );
    return;
  }
  lastDetectedCurrency = result.detectedCurrency || null;
  updateSwapState();
  scheduleQuickConversion({ immediate: true });
  const hasConversions = result.count > 0;
  clearPageButton.disabled = !hasConversions;
  clearPageButton.hidden = !hasConversions;
  updateSecondaryActions();
  setStatus(
    hasConversions
      ? `Converted ${result.count} price${result.count === 1 ? "" : "s"}.${
        result.scanLimited ? " Large-page scan limit reached." : ""
      }`
      : `No supported prices found on this page.${result?.error ? ` ${result.error}` : ""}`,
    hasConversions ? "success" : "warning"
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
    siteStatus.remembered = Boolean(result?.remembered);
    siteStatus.hasPermission = result?.permissionRemaining === true;
    siteStatus.revocablePermission = result?.permissionRemaining === true;
    rememberSiteInput.checked = Boolean(result?.remembered);
    clearSiteButton.hidden = false;
    updateSecondaryActions();
    updateSiteState();
    setStatus(result?.error || "Could not clear this page.", "error");
    return;
  }
  siteStatus.remembered = false;
  siteStatus.hasPermission = false;
  rememberSiteInput.checked = false;
  moveFocusBeforeHiding(clearSiteButton);
  clearSiteButton.hidden = true;
  updateSecondaryActions();
  updateSiteState();
  setStatus("Original prices restored and the automatic-site setting was cleared.", "success");
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
    moveFocusBeforeHiding(clearPageButton);
    clearPageButton.disabled = true;
    clearPageButton.hidden = true;
    updateSecondaryActions();
  }
}

function setBusy(busy, { turningOn = false } = {}) {
  primaryActionBusy = busy;
  convertSiteButton.disabled = busy || Boolean(pageConversionError);
  if (busy) {
    convertSiteButton.textContent = turningOn
      ? "Turning on and converting…"
      : "Converting page…";
  } else {
    updatePrimaryActionLabel();
  }
}

function updatePrimaryActionLabel() {
  if (primaryActionBusy) return;
  if (!popupReady || popupLocked) {
    convertSiteButton.disabled = true;
    return;
  }
  if (pageConversionError) {
    convertSiteButton.disabled = true;
    convertSiteButton.textContent = "Page conversion unavailable";
    return;
  }
  convertSiteButton.disabled = false;
  convertSiteButton.textContent = enabledInput.checked
    ? "Convert page prices"
    : "Turn on and convert page";
}

function updateSecondaryActions() {
  const interactive = popupReady && !popupLocked;
  clearPageButton.disabled = !interactive || clearPageButton.hidden;
  clearSiteButton.disabled = !interactive || clearSiteButton.hidden;
  secondaryActionsNode.hidden = clearPageButton.hidden && clearSiteButton.hidden;
}

function moveFocusBeforeHiding(node, wasFocused = node?.contains(document.activeElement)) {
  if (!wasFocused) return;
  const candidates = [
    convertSiteButton,
    fromCurrencySearch,
    quickConverterNode.querySelector("summary"),
    pageOptionsNode.querySelector("summary")
  ];
  const target = candidates.find((candidate) =>
    candidate &&
    !candidate.disabled &&
    !candidate.hidden &&
    !candidate.closest("[hidden]") &&
    !candidate.closest("[inert]")
  );
  target?.focus();
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
  statusContainerNode.dataset.visible = message ? "true" : "false";
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
  if (!quickConverterNode.open) return;
  const sourceCurrency = fromCurrencySelect.value === "AUTO"
    ? lastDetectedCurrency
    : fromCurrencySelect.value;
  const targetCurrency = toCurrencySelect.value;
  const amountText = quickAmountInput.value.trim();

  if (!sourceCurrency) {
    availableQuoteCurrencies = null;
    availableRatesSource = null;
    populateCurrencyLists();
    quickSourceRequiredNode.hidden = false;
    quickConverterFieldsNode.hidden = true;
    setQuickConversionState("Choose source", "Select a source currency above.", "empty");
    return;
  }
  quickSourceRequiredNode.hidden = true;
  quickConverterFieldsNode.hidden = false;
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
    ? `${hostname || "Current site"} · automatic conversion ${
      enabledInput.checked ? "on" : "paused"
    }`
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
