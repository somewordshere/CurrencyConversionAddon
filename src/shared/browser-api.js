(function exposeExtensionAPI(global) {
  global.ExtensionAPI = global.browser ?? global.chrome;

  if (!global.ExtensionAPI) {
    throw new Error("A WebExtensions API implementation is required.");
  }
})(globalThis);
