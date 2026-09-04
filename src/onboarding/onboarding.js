(function initializeOnboardingPage(global) {
  const api = global.ExtensionAPI;
  const messages = global.CurrencyMessages;

  const currencySelect = document.getElementById("homeCurrency");
  const currencyNote = document.getElementById("currencyNote");
  const activateButton = document.getElementById("activateTabs");
  const tabsNote = document.getElementById("tabsNote");
  const finishButton = document.getElementById("finish");
  const doneNote = document.getElementById("doneNote");

  let currencyNames = null;
  try {
    currencyNames = new Intl.DisplayNames([navigator.language || "en"], { type: "currency" });
  } catch (_error) {
    // A browser without currency display names still gets plain ISO codes.
  }

  start();

  async function start() {
    activateButton.addEventListener("click", activateOpenTabs);
    finishButton.addEventListener("click", finish);
    currencySelect.addEventListener("change", saveHomeCurrency);
    await loadCurrencies();
  }

  async function loadCurrencies() {
    const [catalog, settings] = await Promise.all([
      send({ type: messages.GET_CURRENCIES }),
      send({ type: messages.GET_SETTINGS })
    ]);

    if (!catalog?.ok || !Array.isArray(catalog.currencies) || !catalog.currencies.length) {
      setNote(currencyNote, catalog?.error || "The currency list could not be loaded.", "error");
      return;
    }

    const selected = settings?.settings?.toCurrency;
    currencySelect.replaceChildren(...catalog.currencies.map((code) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = describe(code);
      option.selected = code === selected;
      return option;
    }));
    currencySelect.disabled = false;

    // initializeDefaults() already guessed from the browser's region. Saying so
    // turns a silent default into a decision the user can confirm or correct.
    setNote(
      currencyNote,
      selected
        ? `Set to ${describe(selected)}, guessed from your browser region. Change it if that is wrong.`
        : "Choose the currency you want prices converted into."
    );
  }

  async function saveHomeCurrency() {
    const toCurrency = currencySelect.value;
    currencySelect.disabled = true;
    const result = await send({ type: messages.UPDATE_SETTINGS, payload: { toCurrency } });
    currencySelect.disabled = false;

    if (!result?.ok) {
      setNote(currencyNote, result?.error || "That currency could not be saved.", "error");
      if (result?.settings?.toCurrency) currencySelect.value = result.settings.toCurrency;
      return;
    }
    setNote(currencyNote, `Prices will be converted into ${describe(toCurrency)}.`, "ok");
  }

  async function activateOpenTabs() {
    activateButton.disabled = true;
    setNote(tabsNote, "Switching on your open tabs…");
    const result = await send({ type: messages.ACTIVATE_OPEN_TABS });

    if (!result?.ok) {
      activateButton.disabled = false;
      setNote(tabsNote, result?.error || "Those tabs could not be switched on. Reloading them works too.", "error");
      return;
    }
    setNote(tabsNote, summarizeActivation(result), "ok");
  }

  function summarizeActivation({ activated = 0, skipped = 0 }) {
    if (!activated && !skipped) return "No other tabs were open, so there was nothing to do.";
    if (!activated) return "No open tab could be switched on. Browser and extension pages are always skipped.";
    const tabs = activated === 1 ? "1 tab is" : `${activated} tabs are`;
    return skipped
      ? `${tabs} now watched for prices. ${skipped} was skipped, which browser pages always are.`
      : `${tabs} now watched for prices.`;
  }

  async function finish() {
    try {
      const tab = await api.tabs.getCurrent();
      if (tab?.id) {
        await api.tabs.remove(tab.id);
        return;
      }
    } catch (_error) {
      // Closing our own tab is a convenience, never a requirement.
    }
    setNote(doneNote, "You are set. Close this tab and open a shop.", "ok");
  }

  function describe(code) {
    const name = currencyNames?.of?.(code);
    return name && name !== code ? `${code} — ${name}` : code;
  }

  function setNote(element, text, state) {
    element.textContent = text;
    if (state) element.dataset.state = state;
    else delete element.dataset.state;
  }

  async function send(message) {
    try {
      return await api.runtime.sendMessage(message);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
})(globalThis);
