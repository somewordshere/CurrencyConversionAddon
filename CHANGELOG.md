# Changelog

All notable changes to Currency Converter Pro are documented here. Dates reflect the release preparation date for each version.

## 1.7.2 - 2026-07-24

### Added

- Added a fade-and-settle entrance for the webpage conversion suggestion.
- Added a brief success pulse to the webpage control and a fade-in animation for newly converted values.
- Added Chromium coverage for the top-right position, entrance animation, success animation, and reduced-motion behavior.

### Changed

- Moved the webpage conversion suggestion from the bottom-right to the top-right corner.
- Moved transient conversion toasts to the bottom-right so they do not overlap the webpage suggestion.
- Kept all new motion disabled when the operating system requests reduced motion.

### Packaging

- Prepared separate 1.7.2 Chrome and Firefox builds containing runtime files only.

## 1.7.1 - 2026-07-24

### Added

- Added per-website source-currency preferences for ordinary HTTP and HTTPS websites.
- Added regression coverage proving that a saved source is restored on the same website while a new website starts in `AUTO`.

### Changed

- Made the one-click conversion suggestion available on every ordinary website whenever page conversion is enabled.
- Removed the prompt-disable option from Page options so an older saved preference cannot silently suppress the webpage suggestion.
- Reset the legacy global source-currency value to `AUTO`; explicit source choices are now stored only for their website origin.

### Packaging

- Prepared separate 1.7.1 Chrome and Firefox builds containing runtime files only.

## 1.7.0 - 2026-07-23

### Added

- Added a compact, dismissible one-click conversion control directly to ordinary HTTP and HTTPS webpages.
- Added clear in-page progress, success, error, keyboard-focus, and reduced-motion states.
- Added Chromium browser coverage proving that the page control appears and converts prices without opening the toolbar popup first.
- Added an opt-in, resumable Chrome compatibility sweep for 100 shopping websites across 20 currencies.

### Changed

- Enabled page conversion by default for new installations while preserving the saved choice of existing users.
- Changed remembered websites from permission grants into automatic-conversion preferences.
- Declared website access at installation so the in-page control can be available before the toolbar popup is opened.
- Updated privacy and permission documentation to explain the broader website access and local-only page processing.

### Fixed

- Restored the one-click page control automatically when a dynamic storefront replaces the document body after extension injection.
- Shortened the manifest description to comply with the 132-character browser-store limit.

### Packaging

- Prepared separate 1.7.0 Chrome and Firefox builds containing runtime files only.

## 1.6.2 - 2026-07-21

### Added

- Added Chromium regression coverage for Allegro-style prices that split the whole amount and fractional digits across nested elements.
- Added detector coverage for incomplete decimal fragments and ambiguous currency-marker text near a valid price.

### Changed

- Kept locally saved website captures out of source control while retaining small purpose-built regression fixtures.
- Made linked product titles conservative during full-page conversion while preserving explicit selection conversion.

### Fixed

- Fixed Allegro prices such as `PLN 79.` plus a separate `00` node so the complete `PLN 79.00` price is converted as one value.
- Prevented model names such as `R134` from causing a second converted amount to be appended to an entire product row.
- Prevented currency values contained in linked product titles from being mistaken for sale prices.

### Packaging

- Built separate 1.6.2 Chrome and Firefox upload archives containing runtime files only.

## 1.6.1 - 2026-07-21

### Added

- Added a real Firefox browser test that installs the generated add-on, grants temporary page access from the toolbar, converts a live fixture page, and verifies exact undo behavior.
- Added regression coverage for Swiss prices whose currency label and amount are split across neutral, obfuscated elements.

### Changed

- Improved page-access diagnostics so protected Mozilla pages, browser-internal pages, PDF viewers, and genuine injection failures receive distinct explanations.
- Disabled remembered-site controls where Firefox cannot register the required origin pattern, while preserving one-click manual conversion.
- Added Firefox runtime coverage to the continuous-integration verification workflow.

### Fixed

- Fixed Chrome conversion on Digitec and similarly structured shops by recognizing marked prices even when the website splits `CHF` and the numeric amount into separate text nodes without semantic price attributes.
- Fixed one-off Firefox content-script injection by using extension-root paths while retaining relative paths for persistent content-script registration.
- Prevented a failed stylesheet injection from being hidden by the later script-injection attempt.

### Packaging

- Built separate 1.6.1 Chrome and Firefox upload archives containing runtime files only.

## 1.6.0 - 2026-07-14

### Added

- Added a Firefox Manifest V3 build generated from the same runtime source as Chrome.
- Added a shared browser API adapter so promise-based extension calls work consistently in Chrome and Firefox.
- Added separate Chrome and Firefox manifest overrides, including Mozilla Add-ons identity, minimum-version, and data-collection declarations.
- Added `build:chrome`, `build:firefox`, `lint:firefox`, and `run:firefox` development commands.

### Changed

- Moved shared runtime code into `src/` and now generate browser-specific unpacked builds in `dist/`.
- Split the background implementation into shared logic, a Chrome service-worker entry point, and a Firefox background-script declaration.
- Changed the Playwright suite to test the generated Chrome artifact instead of the repository root.
- Organized Store documentation by browser and historical archives by release version.
- Updated the privacy policy and permission documentation for both browsers, including Firefox's minimal website-content transmission declaration for detected ISO currency codes.

### Testing

- Added project checks for both manifest variants and enforced the shared extension API boundary.
- Validated the Firefox build with Mozilla `web-ext` with zero errors, warnings, or notices.
- Re-ran all unit, regression, and Chromium extension tests against the cross-browser source and generated package.

### Packaging

- Built separate 1.6.0 Chrome and Firefox upload archives containing runtime files only.

## 1.5.1 - 2026-07-14

### Added

- Replaced the long source and target currency dropdowns with searchable, keyboard-accessible currency comboboxes.

### Changed

- Refined popup dropdowns with custom chevrons, improved spacing, subtle depth, and clearer hover and focus feedback in both light and dark themes.
- Added restrained interaction animations for currency swapping, quick-conversion result updates, successful actions, and the **Page options** reveal.
- Added `prefers-reduced-motion` support so users who request reduced motion receive effectively instant transitions.
- Updated the Chrome Web Store summary and full description to match the current searchable selectors, quick converter, per-site permissions, cached-rate behavior, and privacy disclosures.

### Fixed

- Prevented the **Page options** animation from shaking or changing the popup width by avoiding frame-by-frame extension-window resizing.

### Packaging

- Built clean 1.5.1 Chrome Web Store archives from runtime files only and verified the Store ZIP manifest, root layout, and file list.

## 1.5.0 - 2026-07-10

### Added

- Added genuine remembered-site conversion using explicit, revocable per-origin permissions.
- Added persistent content-script registration for approved websites while retaining temporary `activeTab` access elsewhere.
- Added automatic handling for dynamic pages, same-tab navigation, lazy-loaded prices, and accessible open shadow roots.
- Added a standalone live amount converter to the popup with debounced input, international number parsing, currency-native precision, and detailed rate information.
- Added a Frankfurter currency catalog service that refreshes every 24 hours and remains available from cache when offline.
- Expanded manual conversion to the provider's active catalog while keeping automatic detection on a curated 50-currency set.
- Added recent-currency ordering, currency swapping, display modes, prompt preferences, keyboard shortcut support, toolbar conversion counts, and accessible status messaging.
- Added cached-rate provider metadata, cache age, stale-rate warnings after 48 hours, and a hard seven-day cache limit.
- Added timeouts and retry handling for exchange-rate requests.
- Added scan budgets, idle-time rescanning, and batched DOM processing for large or frequently changing pages.
- Added exact restoration of original page content when conversions are undone.
- Added Playwright coverage for the real unpacked extension, including popup initialization, settings persistence, production script injection, dynamic conversion, rate metadata, and exact undo.
- Added tests for currency formatting, the provider catalog, rate caching and timeouts, service-worker behavior, large-page scanning, and additional detector cases.
- Added CI browser testing, failure traces, reproducible package scripts, project verification, `.gitignore`, and an MIT license.

### Changed

- Centralized currency formatting and now use ISO 4217 precision, including zero-decimal JPY and three-decimal KWD.
- Prioritized visible price-like elements instead of broadly scanning every `span`, `strong`, and `b` element.
- Limited scans to bounded numbers of inspected nodes, candidate nodes, and split-price candidates to reduce page stalls.
- Filtered hidden, inert, editable, and extension-owned content from conversion.
- Added validation so unavailable manual currency pairs are rejected before settings are saved.
- Filtered target currencies to rates actually returned for the selected source.
- Replaced the source-currency datalist with a native selector so `AUTO` can reliably be changed and the selection survives list refreshes.
- Shortened `AUTO - Detect automatically` to `AUTO`.
- Increased the popup width from 380 px to 420 px and tightened spacing to avoid scrolling at a 600 px popup height.
- Streamlined the popup around the primary workflows:
  - Added a visible **Page conversion** toggle label.
  - Renamed the main action to **Convert page prices**.
  - Moved advanced settings into a collapsed **Page options** section.
  - Showed **Undo conversion** only when conversions exist.
  - Showed **Forget site** only for remembered websites.
  - Shortened visible rate metadata while retaining full details in tooltips.
  - Added distinct amber styling for stale-rate warnings.
- Refined the quick-conversion section to look less templated:
  - Removed the blue gradient card.
  - Replaced the bright result treatment with a neutral surface.
  - Renamed **Quick conversion** to **Convert an amount**.
  - Renamed **Converted amount** to **Result**.
  - Replaced the AUTO error state with a quiet dash and helper text.
  - Reduced radii, weight, and visual emphasis and made the swap control more neutral.
- Removed the favorite-currency feature and star button, expanded the target selector, and cleaned up previously stored favorites.
- Updated the README, project structure reference, store listing, privacy policy, and Chrome Web Store privacy disclosures to match current behavior.

### Fixed

- Fixed timing-related browser-test flakiness.
- Prevented stale asynchronous scans from modifying text that changed before conversion completed.
- Improved large-page behavior by collapsing excessive mutation roots into a bounded page scan and warning when the scan limit is reached.
- Preserved selected currencies during rate and catalog refreshes.

### Removed

- Removed the obsolete Edge/CDP preview harness after real-extension Playwright coverage replaced it.
- Removed development-only clutter from the workspace: `node_modules`, downloaded website captures, generated Playwright reports, `.DS_Store`, and unused icon concepts and variants.
- Kept source code, tests, documentation, store screenshots, runtime icons, historical release ZIPs, and the current unpacked release.
- Reduced the working project size from approximately 52.6 MB to 6.6 MB. The packaged extension remained approximately 43 KB compressed and 115 KB unpacked at the time of measurement.

### Packaging

- Rebuilt the Chrome Web Store archive with runtime files only and excluded tests and development artifacts.

## 1.4.2 - 2026-06-22

### Changed

- Increased the extension version from 1.4.1 to 1.4.2.

### Packaging

- Rebuilt a clean Chrome Web Store ZIP containing runtime files only.
- Confirmed validation and regression tests passed.

## 1.4.1 - 2026-06-22

### Security

- Removed broad access to all HTTP and HTTPS websites.
- Added `activeTab` and `scripting` so normal page access begins only after an explicit toolbar, context-menu, or keyboard action.
- Kept permanent host access only for the Frankfurter exchange-rate API.

### Changed

- Updated popup, content-script, service-worker, and message flow to inject page-conversion code only when required.
- Documented Chrome Web Store justifications for `activeTab`, `scripting`, and the extension's single purpose.

### Packaging

- Rebuilt the Chrome Web Store package without tests or development files.

## 1.4.0 - 2026-06-22

### Fixed

- Prevented `AMD` in product names from being interpreted as a currency.
- Excluded stock quantities, delivery dates, ratings, and availability counts from price conversion.
- Fixed split prices such as `3 999 UAH` so the converted value appears after the complete original amount.
- Added number boundaries to avoid interpreting product model numbers as prices.

### Added

- Added detector regression tests for the false-positive and split-price cases.
- Added a Material-inspired dollar/euro exchange icon with required 16, 32, 48, and 128 px runtime sizes.
- Added icon-processing and release-packaging scripts.

### Packaging

- Created the first runtime-only Chrome Web Store ZIP for version 1.4.0.
- Excluded tests and unnecessary development files from the upload archive.
