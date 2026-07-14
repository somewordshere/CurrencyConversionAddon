(function initializeNumberParser(global) {
  const digit = "[0-9０-９]";
  const thousandsSeparator = "[.,，．'’\\s\\u00a0\\u202f]";
  const decimalSeparator = "[.,，．]";
  const dash = "[\\-–—−]";
  const integer = `(?:${digit}{1,3}(?:${thousandsSeparator}${digit}{3})+|${digit}+)`;
  const capture = `(${integer}(?:${decimalSeparator}${digit}{1,3}|${decimalSeparator}${dash})?)`;

  function parseLocaleNumber(value, { allowThreeDecimals = false } = {}) {
    const compact = normalizeDigits(value)
      .replace(/[’']/g, "")
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(/[，]/g, ",")
      .replace(/[．]/g, ".")
      .replace(/[.,][\-–—−]$/, "");
    const lastDot = compact.lastIndexOf(".");
    const lastComma = compact.lastIndexOf(",");
    let normalized = compact;

    if (lastDot > -1 && lastComma > -1) {
      normalized = lastDot > lastComma
        ? compact.replace(/,/g, "")
        : compact.replace(/\./g, "").replace(",", ".");
    } else if (lastComma > -1) {
      const decimals = compact.length - lastComma - 1;
      normalized = decimals <= 2
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
    } else {
      const decimals = compact.length - lastDot - 1;
      normalized = lastDot > -1 && decimals > 2 && !allowThreeDecimals
        ? compact.replace(/\./g, "")
        : compact;
    }

    return Number.parseFloat(normalized);
  }

  function normalizeDigits(value) {
    return value.replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    );
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildMarkerPattern(marker) {
    const escaped = escapeRegex(marker);
    const latinStart = /^[A-Za-z]/.test(marker) ? "(?<![A-Za-z])" : "";
    const latinEnd = /[A-Za-z.]$/.test(marker) ? "(?![A-Za-z])" : "";
    return `${latinStart}${escaped}${latinEnd}`;
  }

  global.CurrencyNumberParser = Object.freeze({
    NUMBER_CAPTURE: capture,
    parseLocaleNumber,
    normalizeDigits,
    escapeRegex,
    buildMarkerPattern
  });
})(globalThis);
