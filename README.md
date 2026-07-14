# 💱 Currency Converter Pro

Currency Converter Pro is a privacy-focused Chrome extension that converts prices on shopping pages into a currency you understand.

**Current version:** 1.5.1 · **Platform:** Chrome Manifest V3 · **License:** MIT

[🛍️ Chrome Web Store](https://chromewebstore.google.com/detail/currency-converter-pro/mocmiipnkiobjgjkfehpcmlapgjaepfk) · [📦 Download the latest build](release/currency-converter-1.5.1-chrome-store.zip) · [🔒 Privacy policy](privacy-policy.md) · [📝 Changelog](CHANGELOG.md)

## 📸 Screenshots

| Current popup and page conversion | Converted price on a shopping page |
| --- | --- |
| ![Currency Converter Pro popup converting Amazon prices](screenshots/current-popup.png) | ![A shopping page with prices converted by Currency Converter Pro](screenshots/page-conversion.png) |

## ✨ What the extension can do

- 🔎 Search source and target currencies by code or name
- 🧭 Detect a page's currency automatically with conservative **AUTO** detection
- 🛒 Convert recognized prices across the current shopping page
- 🖱️ Convert one highlighted price without changing the rest of the page
- 🧮 Convert a typed amount directly inside the popup
- ⚡ Follow prices added later by dynamic and single-page websites
- 👀 Show the original and converted prices together, or show only the conversion
- 📌 Remember only websites you explicitly approve for automatic conversion
- ⌨️ Convert the active page with `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS)
- 📴 Use clearly labeled cached rates temporarily when the live provider is unavailable
- 🛡️ Work without advertisements, analytics, or remotely hosted code

## 🚀 Installation

### Install from the Chrome Web Store

Open the [Currency Converter Pro listing](https://chromewebstore.google.com/detail/currency-converter-pro/mocmiipnkiobjgjkfehpcmlapgjaepfk) and select **Add to Chrome**.

### Load a release manually

1. Download the [latest Chrome Store ZIP](release/currency-converter-1.5.1-chrome-store.zip).
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted folder containing `manifest.json`.

## 🧭 How to use it

### Convert an entire page

1. Open the extension from the Chrome toolbar.
2. Turn on **Page conversion**.
3. Keep **AUTO** selected, or search for a source currency manually.
4. Search for and select the currency you want to see.
5. Select **Convert page prices**.
6. Use **Undo conversion** to restore the original page.

### Convert a custom amount

Enter a value under **Convert custom amount**. The popup calculates the result without needing to inspect the current webpage.

### Convert one highlighted price

Highlight a supported price on the page and use the small conversion prompt or the **Convert selected currency** right-click action.

### Remember a website

Open **Page options** and enable **Always convert this website**. Chrome grants access only to that website. Use **Forget site** to revoke the permission later.

## ⚙️ How it works

1. **Local detection:** the extension checks visible price text, structured product metadata, currency codes, symbols, and page context inside the browser.
2. **Conservative matching:** ambiguous symbols such as `$`, `¥`, and `kr` are converted only when the page provides enough currency context.
3. **Rate lookup:** only ISO currency codes are sent to the public [Frankfurter API](https://frankfurter.dev/) to request reference exchange rates.
4. **Local rendering:** converted values are inserted beside the original prices or replace them according to the selected display mode.
5. **Dynamic updates:** bounded background scans handle prices that appear after the initial page load without continuously rescanning the entire document.

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

These values are heuristic confidence scores, not statistically calibrated probabilities. A probability-like estimate can be produced with an unknown-currency baseline:

$$
P(c)=\frac{e^{S(c)/T}}{e^{U/T}+\sum_k e^{S(k)/T}}
$$

Suggested starting parameters are $T=20$, which controls how strongly score differences affect the result, and $U=30$, which represents **currency unknown**. The output should be described as a **detection confidence estimate** until it has been calibrated against a large labeled collection of real webpages.

For example, if JSON-LD identifies EUR, the page uses a `.de` domain, and its language is `de-DE`, EUR receives $100+20+15=135$ points. If USD appears only twice as visible text, USD receives 20 points. With the suggested parameters, the resulting EUR confidence estimate is approximately 99%.

## 🔐 Privacy and permissions

Page contents, highlighted text, price values, visited URLs, and browsing history are not sent to the developer or the exchange-rate provider. The extension stores preferences, recent currency choices, cached rates, and only the website origins you deliberately approve.

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves settings, recent currencies, approved website origins, and cached rates. |
| `contextMenus` | Adds the right-click command for a highlighted price. |
| `activeTab` and `scripting` | Temporarily reads and updates the current page after a user action. |
| Optional website access | Enables automatic conversion only on websites the user explicitly remembers. |
| `api.frankfurter.dev` | Retrieves reference exchange rates using ISO currency codes. |

Read the complete [privacy policy](privacy-policy.md) for retention, deletion, and provider details.

## 🌍 Currency behavior

- Manual selection uses the exchange-rate provider's current active currency catalog.
- AUTO detection uses a curated set of currencies to reduce false positives.
- Structured product data and explicit ISO currency codes receive the strongest detection priority.
- Stock counts, dates, ratings, product model numbers, hidden content, and editable fields are excluded.
- Recently used currencies are shown first.
- Currency-native precision is respected, including zero-decimal JPY and three-decimal KWD.

## ⚠️ Limitations

- Chrome internal pages such as `chrome://extensions` cannot be modified.
- Prices inside images, closed shadow roots, and inaccessible cross-origin frames cannot be converted.
- Some unusual or heavily scripted price layouts may need a manually selected source currency.
- Cached rates warn after 48 hours and are never used after seven days.
- Rates are intended for convenient price comparison and may differ from bank or card-provider rates.

## 🧪 Testing

The project requires Node.js 20 or newer.

```bash
npm ci
npm run verify
```

`npm run verify` checks the Manifest V3 configuration, validates release files, performs JavaScript syntax checks, and runs the unit and regression test suite for parsing, detection, formatting, settings, permissions, catalogs, caching, timeouts, and service-worker behavior.

To run the real extension in Chromium:

```bash
npx playwright install chromium
npm run test:browser
```

The Playwright suite loads the unpacked extension and verifies popup initialization, production script injection, settings persistence, dynamic-price conversion, cached-rate metadata, and exact undo behavior.

## 🛠️ Building a release

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

macOS or Linux:

```bash
sh ./scripts/build-release.sh
```

The build scripts read the version from `manifest.json` and create runtime-only ZIP archives in `release/`. Tests, reports, documentation, and development files are excluded from the extension package.

## 📦 Recent releases

| Version | Highlights | Download |
| --- | --- | --- |
| 1.5.1 | Searchable currency selectors, refined dropdown styling, accessible animations, and a stable Page options reveal | [ZIP](release/currency-converter-1.5.1-chrome-store.zip) |
| 1.5.0 | Quick amount converter, remembered websites, dynamic-page support, display modes, provider catalog, and resilient rate caching | [ZIP](release/currency-converter-1.5.0-chrome-store.zip) |
| 1.4.2 | Clean Store package with regression verification | [ZIP](release/currency-converter-1.4.2-chrome-store.zip) |
| 1.4.1 | Reduced default website access with `activeTab`, `scripting`, and user-triggered injection | [ZIP](release/currency-converter-1.4.1-chrome-store.zip) |
| 1.4.0 | Improved detector accuracy, split-price handling, regression tests, and Store icons | [ZIP](release/currency-converter-1.4.0-chrome-store.zip) |

See [CHANGELOG.md](CHANGELOG.md) for the complete release history.

## 🗂️ Project structure

```text
background/   Settings, permissions, currency catalog, and rate services
content/      Detection, parsing, conversion, dynamic scanning, and page UI
icons/        Chrome extension icons
popup/        Popup interface and searchable currency controls
release/      Verified Chrome Web Store ZIP archives
screenshots/  Images used by this README
scripts/      Validation, icon, and release-building utilities
shared/       Shared currencies and message names
store/        Chrome Web Store listing and privacy-field documentation
tests/        Unit, regression, fixture, service-worker, and Playwright tests
```

## 📄 License

Currency Converter Pro is released under the [MIT License](LICENSE).
