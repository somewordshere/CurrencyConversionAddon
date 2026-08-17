(function initializeCurrencySettings(global) {
  const DEFAULTS = Object.freeze({
    enabled: true,
    fromCurrency: "AUTO",
    toCurrency: "EUR",
    displayMode: "beside",
    convertedTextColor: "#166534",
    convertedBackgroundColor: "#dcfce7",
    convertedShape: "rounded",
    showPagePrompt: true
  });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const DISPLAY_MODES = Object.freeze(["beside", "replace"]);
  const CONVERTED_SHAPES = Object.freeze(["square", "rounded", "pill"]);
  const SHAPE_RADII = Object.freeze({
    square: "0",
    rounded: "0.35em",
    pill: "999px"
  });
  const RATE_AFFECTING_KEYS = Object.freeze(["enabled", "fromCurrency", "toCurrency"]);
  const PRESENTATION_KEYS = Object.freeze([
    "displayMode",
    "convertedTextColor",
    "convertedBackgroundColor",
    "convertedShape"
  ]);
  const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  function sanitize(value, supportedCodes = []) {
    const codes = normalizedCodes(supportedCodes);
    const fromOptions = new Set(["AUTO", ...codes]);
    return {
      enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
      fromCurrency: fromOptions.has(value?.fromCurrency)
        ? value.fromCurrency
        : DEFAULTS.fromCurrency,
      toCurrency: codes.includes(value?.toCurrency)
        ? value.toCurrency
        : DEFAULTS.toCurrency,
      displayMode: DISPLAY_MODES.includes(value?.displayMode)
        ? value.displayMode
        : DEFAULTS.displayMode,
      convertedTextColor: normalizeHexColor(value?.convertedTextColor) ||
        DEFAULTS.convertedTextColor,
      convertedBackgroundColor: normalizeHexColor(value?.convertedBackgroundColor) ||
        DEFAULTS.convertedBackgroundColor,
      convertedShape: CONVERTED_SHAPES.includes(value?.convertedShape)
        ? value.convertedShape
        : DEFAULTS.convertedShape,
      showPagePrompt: typeof value?.showPagePrompt === "boolean"
        ? value.showPagePrompt
        : DEFAULTS.showPagePrompt
    };
  }

  function normalizeSnapshot(value, supportedCodes = null) {
    if (!value || typeof value !== "object" ||
        typeof value.enabled !== "boolean" ||
        typeof value.fromCurrency !== "string" ||
        typeof value.toCurrency !== "string" ||
        !DISPLAY_MODES.includes(value.displayMode) ||
        !normalizeHexColor(value.convertedTextColor) ||
        !normalizeHexColor(value.convertedBackgroundColor) ||
        !CONVERTED_SHAPES.includes(value.convertedShape) ||
        typeof value.showPagePrompt !== "boolean") {
      return null;
    }

    if (supportedCodes !== null) {
      const codes = normalizedCodes(supportedCodes);
      if ((value.fromCurrency !== "AUTO" && !codes.includes(value.fromCurrency)) ||
          !codes.includes(value.toCurrency)) {
        return null;
      }
    }

    return {
      enabled: value.enabled,
      fromCurrency: value.fromCurrency,
      toCurrency: value.toCurrency,
      displayMode: value.displayMode,
      convertedTextColor: normalizeHexColor(value.convertedTextColor),
      convertedBackgroundColor: normalizeHexColor(value.convertedBackgroundColor),
      convertedShape: value.convertedShape,
      showPagePrompt: value.showPagePrompt
    };
  }

  function snapshotEquals(left, right) {
    return Boolean(left && right) && KEYS.every((key) => left[key] === right[key]);
  }

  function normalizeAppearance(value) {
    return {
      convertedTextColor: normalizeHexColor(value?.convertedTextColor) ||
        DEFAULTS.convertedTextColor,
      convertedBackgroundColor: normalizeHexColor(value?.convertedBackgroundColor) ||
        DEFAULTS.convertedBackgroundColor,
      convertedShape: CONVERTED_SHAPES.includes(value?.convertedShape)
        ? value.convertedShape
        : DEFAULTS.convertedShape
    };
  }

  function normalizeHexColor(value) {
    return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
      ? value.toLowerCase()
      : null;
  }

  function changesInclude(changes, keys) {
    return Boolean(changes) && keys.some((key) => Object.hasOwn(changes, key));
  }

  function normalizedCodes(supportedCodes) {
    return Array.isArray(supportedCodes)
      ? [...new Set(supportedCodes.filter((code) => typeof code === "string"))]
      : [];
  }

  global.CurrencySettings = Object.freeze({
    DEFAULTS,
    KEYS,
    DISPLAY_MODES,
    CONVERTED_SHAPES,
    SHAPE_RADII,
    RATE_AFFECTING_KEYS,
    PRESENTATION_KEYS,
    sanitize,
    normalizeSnapshot,
    snapshotEquals,
    normalizeAppearance,
    normalizeHexColor,
    changesInclude
  });
})(globalThis);
