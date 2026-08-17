(function initializeBackground(global) {
  const api = global.ExtensionAPI;
  const messages = global.CurrencyMessages;
  const settings = global.CurrencySettingsService;
  const sites = global.CurrencySitePreferences;
  const pageActions = global.CurrencyPageActions;

  api.runtime.onInstalled.addListener(async () => {
    try {
      const supportedCodes = await settings.initializeDefaults();
      await pageActions.initializeContextMenu();
      await sites.reconcile(supportedCodes);
    } catch (error) {
      console.error("Currency Converter Pro initialization failed.", error);
    }
  });

  api.runtime.onStartup.addListener(() => {
    sites.reconcile().catch((error) => {
      console.error("Could not restore remembered-site preferences.", error);
    });
  });

  api.contextMenus.onClicked.addListener((info, tab) => {
    return pageActions.handleContextMenuClick(info, tab);
  });

  api.commands.onCommand.addListener((command) => {
    return pageActions.handleCommand(command);
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The request could not be completed."
      }));
    return true;
  });

  async function handleMessage(message, sender) {
    switch (message?.type) {
      case messages.GET_SETTINGS:
        return settings.getSettings(message.origin || sender?.url);
      case messages.UPDATE_SETTINGS:
        return settings.updateSettings(message.payload, message.origin || sender?.url);
      case messages.GET_RATES:
        return global.CurrencyRateService.getRates(message.baseCurrency);
      case messages.GET_RATE_HISTORY:
        return global.CurrencyRateHistoryService.getHistory(
          message.baseCurrency,
          message.quoteCurrency
        );
      case messages.GET_CURRENCIES:
        return settings.getAvailableCurrencies();
      case messages.GET_SITE_STATUS:
        return sites.getStatus(message.origin || sender?.url);
      case messages.REMEMBER_SITE:
        return settings.rememberSite(message.origin || sender?.url);
      case messages.FORGET_SITE:
        return sites.forget(message.origin || sender?.url);
      case messages.SET_BADGE:
        return pageActions.setBadge(sender?.tab?.id, message.count);
      default:
        return { ok: false, error: "Unknown extension request." };
    }
  }

  global.CurrencyBackground = Object.freeze({ handleMessage });
})(globalThis);
