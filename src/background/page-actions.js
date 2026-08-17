(function initializePageActions(global) {
  function createPageActions({ api, messages }) {
    const declaration = api.runtime.getManifest().content_scripts?.find((script) =>
      script.matches?.includes("http://*/*") && script.matches?.includes("https://*/*")
    );
    const injectedScriptFiles = (declaration?.js || []).map((file) => `/${file}`);
    const injectedStyleFiles = (declaration?.css || []).map((file) => `/${file}`);

    async function initializeContextMenu() {
      await api.contextMenus.removeAll();
      api.contextMenus.create({
        id: "convert-selection",
        title: "Convert selected currency",
        contexts: ["selection"]
      });
    }

    async function handleContextMenuClick(info, tab) {
      if (info.menuItemId !== "convert-selection" || !isSupportedTab(tab)) return;
      try {
        await ensureContentScripts(tab.id);
        await api.tabs.sendMessage(tab.id, { type: messages.CONVERT_SELECTION });
      } catch (error) {
        console.info(
          "Currency Converter Pro could not access this page. Reload the page and try again.",
          error
        );
      }
    }

    async function handleCommand(command) {
      if (command !== "convert-page") return;
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!isSupportedTab(tab)) return;
      try {
        await ensureContentScripts(tab.id);
        await api.tabs.sendMessage(tab.id, { type: messages.RUN_SITE_CONVERSION });
      } catch (error) {
        console.info("Could not run the keyboard conversion command.", error);
      }
    }

    async function setBadge(tabId, count) {
      if (!tabId) return { ok: false };
      const text = Number.isInteger(count) && count > 0 ? String(Math.min(count, 999)) : "";
      await api.action.setBadgeBackgroundColor({ tabId, color: "#047857" });
      await api.action.setBadgeText({ tabId, text });
      return { ok: true };
    }

    function isSupportedTab(tab) {
      return Boolean(tab?.id && tab.url && /^(https?|file):\/\//.test(tab.url));
    }

    async function ensureContentScripts(tabId) {
      try {
        await api.tabs.sendMessage(tabId, { type: messages.CONTENT_READY });
        return;
      } catch (_error) {
        await api.scripting.insertCSS({
          target: { tabId },
          files: injectedStyleFiles
        });
        await api.scripting.executeScript({
          target: { tabId },
          files: injectedScriptFiles
        });
      }
    }

    return Object.freeze({
      ensureContentScripts,
      handleCommand,
      handleContextMenuClick,
      initializeContextMenu,
      isSupportedTab,
      setBadge
    });
  }

  const service = createPageActions({
    api: global.ExtensionAPI,
    messages: global.CurrencyMessages
  });
  global.CurrencyPageActions = Object.freeze({ ...service, create: createPageActions });
})(globalThis);
