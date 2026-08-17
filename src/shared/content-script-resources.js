(function exposeContentScriptResources(root) {
  "use strict";

  function fromManifest(manifest) {
    const definitions = Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : [];
    const definition = definitions.find((script) =>
      script?.matches?.includes("http://*/*") && script.matches.includes("https://*/*")
    );
    return Object.freeze({
      js: normalizePaths(definition?.js),
      css: normalizePaths(definition?.css)
    });
  }

  function normalizePaths(values) {
    if (!Array.isArray(values)) return Object.freeze([]);
    const normalized = values
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().replaceAll("\\", "/"))
      .filter(Boolean)
      .map((value) => value.replace(/^\.\//, "").replace(/^\/+/, ""))
      .filter(Boolean)
      .map((value) => `/${value}`);
    return Object.freeze([...new Set(normalized)]);
  }

  // One implementation of "make sure the converter is running in this tab",
  // shared by the popup and the background page actions. Both previously kept
  // their own copy and only the popup's reported which step failed.
  function createInjector({ api, messages }) {
    const resources = fromManifest(api.runtime.getManifest());

    return async function ensureContentScripts(tabId) {
      try {
        await api.tabs.sendMessage(tabId, { type: messages.CONTENT_READY });
        return;
      } catch (_error) {
        // The converter is not loaded in this document yet.
      }

      if (resources.css.length) {
        try {
          await api.scripting.insertCSS({ target: { tabId }, files: resources.css });
        } catch (error) {
          throw new Error(`The page styles could not be loaded: ${errorMessage(error)}`);
        }
      }

      try {
        if (!resources.js.length) {
          throw new Error("The extension manifest does not define page converter scripts.");
        }
        await api.scripting.executeScript({ target: { tabId }, files: resources.js });
      } catch (error) {
        throw new Error(`The page converter could not be loaded: ${errorMessage(error)}`);
      }
    };
  }

  function errorMessage(error) {
    return error instanceof Error && error.message
      ? error.message
      : String(error || "Unknown browser error");
  }

  root.CurrencyContentScriptResources = Object.freeze({ fromManifest, createInjector });
})(globalThis);
