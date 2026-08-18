# 💱 Currency Converter Pro

Currency Converter Pro is a Chrome and Firefox extension that converts prices on shopping pages into a currency you understand.

Detection, conversion, and rendering all happen inside your browser. The only thing that ever leaves it is an ISO currency code such as `USD` or `EUR` — never page content, prices, or the sites you visit.

**Current version:** 2.0.0 · **Platforms:** Chrome and Firefox Manifest V3 · **Firefox:** 140+ · Android 142+ · **License:** MIT

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/currency-converter-pro/mocmiipnkiobjgjkfehpcmlapgjaepfk) [![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/currencyconverterpro/) [![Chrome build](https://img.shields.io/badge/Chrome-Build-4285F4?logo=googlechrome&logoColor=white)](release/2.0.0/currency-converter-pro-2.0.0-chrome.zip) [![Firefox build](https://img.shields.io/badge/Firefox-Build-FF7139?logo=firefoxbrowser&logoColor=white)](release/2.0.0/currency-converter-pro-2.0.0-firefox.zip)

**[View the complete changelog →](CHANGELOG.md)**

[Screenshots](#-screenshots) · [Features](#features) · [Install](#installation) · [Use](#-how-to-use-it) · [How it works](#️-how-it-works) · [Detection](#-currency-detection-confidence) · [Privacy](#-privacy-and-permissions) · [Limitations](#️-limitations) · [Build](#️-building-a-release) · [Development](#-development)

## 📸 Screenshots

### The popup

| Live rate and conversion | Dark mode | Page options |
| --- | --- | --- |
| ![Currency Converter Pro popup showing a live USD to EUR rate, a currency pair selector, and a quick amount converter](screenshots/v2-popup-light.png) | ![The same popup rendered in dark mode](screenshots/v2-popup-dark.png) | ![The popup with Page options expanded, showing the converter toggle, price display mode, and converted-price appearance controls](screenshots/v2-popup-options.png) |

### On the page

Prices are detected locally as a page opens. The prompt appears only once a supported price is found, and it states the rate before you accept.

| Conversion offered | Whole page converted |
| --- | --- |
| ![A shopping page with a prompt offering to convert visible prices to EUR, showing the current rate](screenshots/v2-inpage-prompt.png) | ![The same shopping page with every price showing its euro equivalent beside the original, and a toast offering undo](screenshots/v2-inpage.png) |

Or select a single price to convert just that one:

| Select any price | Converted in place |
| --- | --- |
| ![A single highlighted price with a Convert selection button beside it](screenshots/v2-inpage-selection.png) | ![The same selection showing the converted euro amount](screenshots/v2-inpage-selection-done.png) |

## Features

- Search currencies by name or ISO code, with conservative **AUTO** detection when the source currency is unknown.
- Convert a complete shopping page, one highlighted price, or an amount typed into the popup.
- Handle prices added later by dynamic and single-page websites.
- Show converted prices beside the originals or replace them, with exact undo support.
- Customize converted-price text, background, and corner shape with a live before-and-after preview and contrast guidance.
- Keep the popup focused on the current site, currency pair, and one adaptive page-conversion action, with less-used controls in closed disclosures.
- Scan ordinary webpages locally as they open and show the on-page conversion prompt only after a supported price is found.
- Remember a manual source currency or `AUTO` mode for websites that should convert automatically.
- Use recent cached rates immediately while refreshing them in the background.

## Installation

- **Store installation:** Install Currency Converter Pro from the [Chrome Web Store](https://chromewebstore.google.com/detail/currency-converter-pro/mocmiipnkiobjgjkfehpcmlapgjaepfk) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/currencyconverterpro/).
- **Manual installation:** Download the latest [Chrome build](release/2.0.0/currency-converter-pro-2.0.0-chrome.zip) or [Firefox build](release/2.0.0/currency-converter-pro-2.0.0-firefox.zip), extract it, and load it through the browser's extension-development page. The Firefox build requires Mozilla signing for permanent installation.

## 🧭 How to use it

### Convert an entire page

1. Open an ordinary HTTP or HTTPS webpage. Currency Converter Pro scans locally for supported prices.
2. When a supported price is found, select **Convert prices** in the on-page prompt.
3. Use the toolbar popup to keep **AUTO** selected or choose a source currency manually, and select the target currency.
4. The popup action can also run conversion directly as **Turn on and convert page** or **Convert page prices**.
5. **Restore original prices** appears only after the page contains conversions.

The global **Enable converter** switch is under **Page options**. Turning it off stops local price scanning, prompts, and automatic conversion until the user enables it again.

### Customize converted prices

Open **Page options** and use **Converted price appearance** to choose text and background colors plus a square, rounded, or pill shape. The **Before** sample keeps the original converter style while **After** updates as you edit. The contrast message reports whether the selected colors meet WCAG AA for normal text, and **Reset appearance** restores the accessible green default.

### Convert a custom amount

Open the closed **Convert custom amount** disclosure and enter a value. The popup calculates the result without inspecting the current webpage. If the source is still `AUTO` and no page conversion has identified it, select an explicit source currency first.

### Convert one highlighted price

Highlight a supported price and use the **Convert selected currency** right-click action. The on-page conversion prompt appears automatically when local detection finds a supported price and the prompt option is enabled.

### Remember a website

Open **Page options** and enable **Convert this site automatically**. The selected manual source or `AUTO` mode is remembered for that origin, and supported prices are converted when the site is visited. Turning this option off deletes the saved origin and source mode; ordinary local price detection and the conversion prompt remain available.

## ⚙️ How it works

1. **Always-on local detection:** a lightweight content script runs on ordinary HTTP and HTTPS pages, scans locally for supported prices, and shows the conversion prompt only after a match is found.
2. **Local detection:** the extension checks visible price text, structured product metadata, currency codes, symbols, and page context inside the browser.
3. **Conservative matching:** ambiguous symbols such as `$`, `¥`, and `kr` are converted only when the page provides enough currency context.
4. **Rate lookup:** only ISO currency codes are sent to the public [Frankfurter API](https://frankfurter.dev/). Detection starts the relevant lookup in the background, and recent cached rates can be used immediately while they refresh.
5. **Local rendering:** converted values are inserted beside the original prices or replace them according to the selected display mode.
6. **Dynamic updates:** bounded background scans handle prices that appear after the initial page load without continuously rescanning the entire document.

## 🎯 Currency detection confidence

AUTO detection gives every supported currency a weighted score based on evidence found on the page:

$$
S(c)=100M+100J+75E+\min(30,10V)+20D+40K+15L
$$

| Signal | Meaning | Weight |
| --- | --- | ---: |
| $M$ | Matching structured price metadata | 100 per match |
| $J$ | Matching JSON-LD `priceCurrency` | 100 per match |
| $E$ | Matching currency in embedded shop data | 75 per match |
| $V$ | Visible ISO currency-code occurrences | 10 each, up to 30 |
| $D$ | Matching country-code domain | 20 |
| $K$ | Matching canonical country-code domain | 40 |
| $L$ | Matching page language or region | 15 |

The currency with the highest score becomes the AUTO candidate. The runner-up score is also considered so that two competing currencies do not produce a misleadingly confident result.

- **High confidence:** the winning score is at least 70 and at least 20 points above second place.
- **Medium confidence:** the winning score is at least 30 and at least 10 points above second place.
- **Low confidence:** the evidence does not meet either threshold, so page conversion asks for a manually selected source currency.

These are heuristic confidence scores, not calibrated probabilities.

**Worked example.** JSON-LD identifies EUR, the domain is `.de`, and the page language is `de-DE`: EUR scores $100+20+15=135$. USD appears twice as visible text: 20 points. EUR clears both the 70-point floor and the 20-point gap, so detection reports **high confidence**.

## 🔐 Privacy and permissions

All webpage scanning, price detection, conversion, and rendering happen locally inside the browser. The extension never transmits page contents, highlighted text, price values, visited URLs, or browsing history.

The only external requests retrieve the currency catalog and reference rates from Frankfurter using ISO currency codes. No webpage text, prices, URLs, analytics, tracking identifiers, or advertising data is included. As with any HTTPS request, the service may receive ordinary network metadata such as an IP address. Preferences, recent currency choices, cached rates, and origins selected for automatic conversion remain in browser storage.

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves settings, recent currencies, automatic-conversion origins, their source modes, and cached rates. |
| `contextMenus` | Adds the right-click command for a highlighted price. |
| HTTP and HTTPS webpage access | Loads the local detector as pages open so it can find supported prices and offer conversion without a toolbar click. Page contents and URLs are not transmitted. |
| `activeTab` and `scripting` | Provides a user-triggered fallback on supported pages where the normal detector was not loaded, including manually allowed local files. |
| `api.frankfurter.dev` | Retrieves reference exchange rates using ISO currency codes. |
| Firefox `websiteContent` data declaration | Discloses that a source ISO currency code detected from the page can be transmitted to the rate provider; raw page text, prices, and URLs are not transmitted. |

Read the complete [privacy policy](privacy-policy.md) for retention, deletion, and provider details.

## 🌍 Currency behavior

- Manual selection uses the exchange-rate provider's current active currency catalog.
- AUTO detection uses a curated set of currencies to reduce false positives.
- Structured product data and explicit ISO currency codes receive the strongest detection priority.
- Stock counts, dates, ratings, product model numbers, hidden content, and editable fields are excluded.
- Recently used currencies are shown first.
- Currency-native precision is respected, including zero-decimal JPY and three-decimal KWD.

## ⚠️ Limitations

- Prices inside images, closed shadow roots, and inaccessible cross-origin frames cannot be converted.
- Some unusual or heavily scripted price layouts may need a manually selected source currency.
- Cached rates warn after 48 hours and are never used after seven days.
- Rates are intended for convenient price comparison and may differ from bank or card-provider rates.

## 🛠️ Building a release

Prerequisites:

- Git
- Node.js 22 LTS (Node.js 20 or newer is supported)
- npm, included with Node.js

From a fresh clone:

```bash
git clone https://github.com/somewordshere/CurrencyConversionAddon.git
cd CurrencyConversionAddon
npm ci
npm run verify
npm run build
```

`npm ci` installs the exact development dependencies recorded in
`package-lock.json`. `npm run build` creates both browser packages. The
upload-ready ZIP files are written to `release/<version>/`, while unpacked
development builds are written to `dist/chrome/` and `dist/firefox/`.

Or build only one browser target:

```bash
npm run build:chrome
npm run build:firefox
```

The build composes `manifests/base.json` with the selected browser override and copies only `src/` runtime assets into each package. Tests, reports, documentation, source manifests, and development files are excluded from the release archives.

## 🧪 Development

```bash
npm ci                        # exact pinned dev dependencies
npm run verify                # project checks plus the unit suite
npm test                      # unit tests only
npm run test:browser          # Chrome extension tests, via Playwright
npm run test:browser:firefox  # real Firefox runtime test, via geckodriver
npm run lint:firefox          # web-ext validation of the Firefox package
```

CI runs every one of these on each push. `npm run build:icons` and `npm run build:store-assets` regenerate the extension icons and store imagery.

## 📦 Recent releases

| Version | Highlights | Download |
| --- | --- | --- |
| 2.0.0 | Popup rebuilt around the live rate with a seven-day sparkline and freshness indicator, shared palette across every surface, and a new icon | [Chrome](release/2.0.0/currency-converter-pro-2.0.0-chrome.zip) · [Firefox](release/2.0.0/currency-converter-pro-2.0.0-firefox.zip) |
| 1.9.2 | Behavior-preserving runtime refactor with more reliable SPA mutation scheduling, queued conversions, and in-place appearance updates | [Chrome](release/1.9.2/currency-converter-pro-1.9.2-chrome.zip) · [Firefox](release/1.9.2/currency-converter-pro-1.9.2-firefox.zip) |
| 1.9.1 | Fixed Chrome and Firefox toolbar popup sizing, scrolling, and browser-native control rendering | [Chrome](release/1.9.1/currency-converter-pro-1.9.1-chrome.zip) · [Firefox](release/1.9.1/currency-converter-pro-1.9.1-firefox.zip) |
| 1.9.0 | Custom converted-price colors and shapes, live before-and-after preview, WCAG contrast guidance, and one-click reset | [Chrome](release/1.9.0/currency-converter-pro-1.9.0-chrome.zip) · [Firefox](release/1.9.0/currency-converter-pro-1.9.0-firefox.zip) |
| 1.8.0 | Always-on local price detection, price-gated on-page prompts, background rate prefetching, and instant stale-cache use while rates refresh | [Chrome](release/1.8.0/currency-converter-pro-1.8.0-chrome.zip) · [Firefox](release/1.8.0/currency-converter-pro-1.8.0-firefox.zip) |

See [CHANGELOG.md](CHANGELOG.md) for the complete release history.

## 🗂️ Project structure

```text
src/          Shared extension runtime used by both browsers
  background/ Listener/router entry plus settings, site-preference, page-action, catalog, and rate services, over shared HTTP and catalog-snapshot helpers
  content/    Detection and conversion runtime, conversion registry, bounded mutation scheduler, and page UI
  icons/      Extension icons
  popup/      Popup UI and settings reconciliation controller
  shared/     Browser adapter, currency catalog, canonical settings schema, messages, page-access rules, and manifest-derived content-script injection
manifests/    Common manifest plus Chrome and Firefox overrides
dist/         Generated unpacked browser builds (not committed)
release/      Versioned Chrome and Firefox release archives
screenshots/  Images used by this README
scripts/      Manifest composition, validation, icon, screenshot, and release utilities
tests/        Unit, integration, fixture, Chrome Playwright, and Firefox runtime tests
```

## 📄 License

Currency Converter Pro is released under the [MIT License](LICENSE).
