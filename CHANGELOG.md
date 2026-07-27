# Changelog

All notable changes to Currency Converter Pro are documented here. Dates reflect the release preparation date for each version.

## 1.8.0 - 2026-07-27

### Added

- Added always-on local price detection for ordinary HTTP and HTTPS webpages.
- Added price-gated on-page prompts that appear only after a supported price is found.
- Added lightweight dynamic-page discovery so a prompt appears when a shopping page inserts a price later.
- Added background rate prefetching as soon as a source currency is detected.

### Changed

- Enabled the converter by default for new installations while preserving an existing user's explicit on/off setting.
- Returned to declarative webpage loading because automatic detection on every ordinary website is a core product requirement.
- Changed remembered websites from permission grants into automatic-conversion preferences; page detection remains available on other websites.
- Removed the obsolete 1.7.3 site-access reset notice and its popup UI.
- Made settings and popup startup use the cached or built-in currency catalog immediately while the provider catalog refreshes in the background.
- Made recent cached rates available immediately while fresh rates load in the background, retaining the seven-day hard limit.

### Privacy and permissions

- Disclosed required ordinary HTTP and HTTPS webpage access for the always-on local detector.
- Kept webpage contents, price values, URLs, and browsing history on the user's device; only ISO currency codes are sent for rate lookup.
- Updated the privacy policy, permission justifications, Store listing, and Limited Use statement for the always-on model.

### Testing

- Added browser coverage for automatic prompting on initially rendered and dynamically inserted prices.
- Retained conversion, undo, race-condition, accessibility, bounded-scan, and cross-browser regression coverage.

## 1.7.3 - 2026-07-27

### Added

- Added per-site source-currency retention for websites explicitly approved for automatic conversion.
- Added regression coverage for approved-site source retention, complete site-access removal, and the 1.7.2 broad-access migration.
- Added a one-time **Site access reset for privacy** notice for upgrades from versions 1.7.0 through 1.7.2, backed by transient boolean pending and notice flags that contain no website details.

### Changed

- Restored one-time page conversion through `activeTab` and `scripting`, with no required access to ordinary websites and no declarative all-sites content script.
- Changed automatic conversion to request optional access only for the exact website origin selected in **Page options**.
- Simplified the popup around the current site, currency pair, and one primary page-conversion action, and moved the global **Enable converter** switch into **Page options**.
- Made **Turn on and convert page** enable the converter and convert the current page in one action before reverting to **Convert page prices** for later runs.
- Changed **Convert custom amount** into a closed disclosure and now require an explicit source selection when `AUTO` has not identified a page currency.
- Made **Restore original prices** appear only when conversions exist and limited **Remove site access** to recovery from an unmatched permission or incomplete cleanup state.
- Clarified remembered websites as **automatic conversion paused** when the global converter is off without revoking their saved exact-origin access.
- Limited the on-page conversion prompt to pages where the user has already invoked or approved the extension.
- Preserved active conversions when prompt-only settings change and deliberately reconvert them when the currency pair or display mode changes.
- Made the page prompt, selection control, and conversion result keyboard-dismissible with focus restoration, persistent Undo, and reliable live-status announcements.
- Serialized popup setting saves and per-origin site-state mutations so concurrent actions cannot overwrite newer settings or strand another site's registration.
- Invalidated in-flight conversion work when settings change, the converter is disabled, or original prices are restored.

### Privacy

- Upgrades from versions 1.7.0 through 1.7.2 remove the legacy broad HTTP and HTTPS website grant before remembered-site registrations are reconciled.
- Those upgrades explicitly clear legacy automatic-site choices and their saved source currencies, then show the one-time reset notice; dismissing it deletes `siteAccessResetNotice` without storing website details.
- A transient `siteAccessResetPending` boolean retries an interrupted legacy cleanup at browser startup and is removed before the verified-reset notice is shown.
- Removing site access now unregisters automatic conversion, revokes the exact-origin permission, and deletes the remembered origin and its source-currency override.
- Returning an approved site to `AUTO` now persists automatic detection for that site instead of falling back to an unrelated global manual source.

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
