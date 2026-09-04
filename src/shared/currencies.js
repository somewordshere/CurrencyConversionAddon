(function initializeCurrencyCatalog(global) {
  const CURRENCY_META = {
    AED: { symbols: ["د.إ", "DH"], locale: "ar-AE" },
    AMD: { symbols: ["֏"], locale: "hy-AM" },
    AUD: { symbols: ["AU$", "A$"], locale: "en-AU" },
    AZN: { symbols: ["₼"], locale: "az-AZ" },
    BDT: { symbols: ["৳"], locale: "bn-BD" },
    BHD: { symbols: ["د.ب", "BD"], locale: "ar-BH" },
    BRL: { symbols: ["R$"], locale: "pt-BR" },
    CAD: { symbols: ["CA$", "C$"], locale: "en-CA" },
    CHF: { symbols: ["CHF", "SFr.", "SFr", "Fr.", "Fr"], locale: "de-CH" },
    CNY: { symbols: ["CN¥", "¥", "￥"], locale: "zh-CN" },
    CZK: { symbols: ["Kč"], locale: "cs-CZ" },
    DKK: { symbols: ["kr"], locale: "da-DK" },
    EGP: { symbols: ["E£", "ج.م"], locale: "ar-EG" },
    EUR: { symbols: ["€"], locale: "de-DE" },
    GBP: { symbols: ["£"], locale: "en-GB" },
    GEL: { symbols: ["₾"], locale: "ka-GE" },
    HKD: { symbols: ["HK$"], locale: "zh-HK" },
    HUF: { symbols: ["Ft"], locale: "hu-HU" },
    IDR: { symbols: ["Rp"], locale: "id-ID" },
    ILS: { symbols: ["₪"], locale: "he-IL" },
    INR: { symbols: ["₹"], locale: "en-IN" },
    JOD: { symbols: ["د.ا", "JD"], locale: "ar-JO" },
    JPY: { symbols: ["JP¥", "¥", "￥", "円"], locale: "ja-JP" },
    KES: { symbols: ["KSh"], locale: "en-KE" },
    KRW: { symbols: ["₩"], locale: "ko-KR" },
    KWD: { symbols: ["د.ك", "KD"], locale: "ar-KW" },
    KZT: { symbols: ["₸"], locale: "kk-KZ" },
    LKR: { symbols: ["LKR", "රු", "Rs"], locale: "si-LK" },
    MAD: { symbols: ["د.م.", "DH"], locale: "ar-MA" },
    MXN: { symbols: ["MX$", "$"], locale: "es-MX" },
    MYR: { symbols: ["RM"], locale: "ms-MY" },
    NGN: { symbols: ["₦"], locale: "en-NG" },
    NOK: { symbols: ["kr"], locale: "nb-NO" },
    NZD: { symbols: ["NZ$"], locale: "en-NZ" },
    OMR: { symbols: ["ر.ع.", "RO"], locale: "ar-OM" },
    PHP: { symbols: ["₱"], locale: "en-PH" },
    PKR: { symbols: ["PKR", "Rs"], locale: "en-PK" },
    PLN: { symbols: ["zł"], locale: "pl-PL" },
    QAR: { symbols: ["ر.ق", "QR"], locale: "ar-QA" },
    RON: { symbols: ["lei"], locale: "ro-RO" },
    SAR: { symbols: ["ر.س", "SR"], locale: "ar-SA" },
    SEK: { symbols: ["kr"], locale: "sv-SE" },
    SGD: { symbols: ["S$"], locale: "en-SG" },
    THB: { symbols: ["฿"], locale: "th-TH" },
    TRY: { symbols: ["₺", "TL"], locale: "tr-TR" },
    TWD: { symbols: ["NT$"], locale: "zh-TW" },
    UAH: { symbols: ["₴", "грн"], locale: "uk-UA" },
    USD: { symbols: ["US$", "$"], locale: "en-US" },
    VND: { symbols: ["₫"], locale: "vi-VN" },
    ZAR: { symbols: ["R"], locale: "en-ZA" }
  };

  const CURRENCY_CODES = Object.keys(CURRENCY_META).sort();
  // Markers that read as ordinary words elsewhere: "TL" is a German teaspoon in
  // recipes, "kr" is three Nordic currencies, "R" is a letter. They only count
  // once the page itself has been identified as using that currency.
  const CONTEXT_REQUIRED_SYMBOLS = new Set([
    "r", "fr", "fr.", "kr", "dh", "sr", "lei", "ft", "rp", "rm", "rs",
    "ksh", "qr", "kd", "bd", "ro", "jd", "tl"
  ]);
  // Regions that use the euro but are not the locale recorded against EUR above.
  const EURO_REGIONS = [
    "AD", "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE",
    "IT", "LT", "LU", "LV", "MC", "ME", "MT", "NL", "PT", "SI", "SK", "SM", "VA", "XK"
  ];

  // "Which currency does someone in this region think in?" Built from the locale
  // already recorded against each currency, so the two cannot drift apart.
  const REGION_CURRENCY = new Map();
  for (const [code, meta] of Object.entries(CURRENCY_META)) {
    const region = regionOf(meta.locale);
    if (region && !REGION_CURRENCY.has(region)) REGION_CURRENCY.set(region, code);
  }
  for (const region of EURO_REGIONS) REGION_CURRENCY.set(region, "EUR");

  function regionOf(locale) {
    if (typeof locale !== "string") return null;
    const match = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale.trim());
    return match ? match[1].toUpperCase() : null;
  }

  // Best guess at a new user's home currency, so a fresh install does not
  // silently convert every price into a currency they do not think in.
  // Returns null when the locale says nothing useful; the caller keeps its default.
  function currencyForLocale(locale) {
    return REGION_CURRENCY.get(regionOf(locale)) || null;
  }

  const currencyFormatters = new Map();

  function formatCurrencyAmount(amount, currency) {
    const meta = CURRENCY_META[currency];
    const locale = meta?.locale || "en-US";
    const key = `${locale}:${currency}`;
    let formatter = currencyFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency
      });
      currencyFormatters.set(key, formatter);
    }
    return formatter.format(amount);
  }

  global.CurrencyCatalog = Object.freeze({
    CURRENCY_META,
    CURRENCY_CODES,
    CONTEXT_REQUIRED_SYMBOLS,
    currencyForLocale,
    formatCurrencyAmount
  });
})(globalThis);
