(function exposePopupContentScriptResources(root) {
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

  root.CurrencyPopupContentScriptResources = Object.freeze({ fromManifest });
})(globalThis);
