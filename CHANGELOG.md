# Changelog

All notable changes to Twinprice are documented here. Dates reflect the release preparation date for each version.

Twenty-two versions have shipped. Every one has a signed-off archive under
`release/<version>/` and a `v<version>` tag, but the tags do not all mean the
same thing, because the source history does not cover every release:

- **1.4.0, 1.4.1, 1.4.2 and 1.5.0 predate the source.** The repository's first
  two commits contain only `README.md` and `privacy-policy.md`; the first commit
  carrying any code is already 1.5.1. These four shipped before the extension was
  under version control, and their archives were added afterwards.
- **1.7.0, 1.7.1, 1.7.3 and 1.9.0 were built from working trees that never
  landed.** No commit in this repository declares any of those versions, and
  their archives arrived attached to a later release commit.

For those eight, `v<version>` marks the commit that carries the archive, not a
commit whose source is that version — each tag's own message says so. Checking
one out gives you a neighbouring version's source; the archive under
`release/<version>/` is the authoritative record of what actually shipped.

The remaining fourteen tags each point at a commit whose `package.json` declares
exactly that version.

## 2.1.3 - 2026-09-10

- Moved the public website, popup link, welcome-page help, and extension homepage to https://twinprice.com/.
- Changed the popup heading and title to twinprice.com.
- Published the website on its custom domain and disabled the previous workers.dev address.

## 2.1.2 - 2026-09-10

- Added the Twinprice website to the toolbar popup and extension homepage metadata.
- Routed onboarding help through the website instead of linking directly to GitHub.
- Kept the website link beside the current-page label so the default popup fits without an extra scrollbar.
- The website remains a private preview requiring sign-in.

## 2.1.1 - 2026-09-05

Everything here is a promise the project was making and not keeping.

### Fixed

- The privacy policy told users to reach the developer "using the support contact shown on the store listing", and no such contact existed anywhere: a search for an email address across every tracked file returned nothing. It now points at the repository's issue tracker, which is open and answers, and warns that issues are public.
- The policy was still stamped version 1.9.2, five releases behind. `check-project.js` now asserts it records the shipping version, because it was the one versioned document nothing validated and it had silently drifted.
- The Firefox manifest declared `Twinprice - Currency Converter` while the live AMO listing reads `Twinprice - Currency Converter for Every Page`. The manifest now matches what users actually see, at exactly the 45 characters AMO allows.

### Added

- A support link on the onboarding page. The extension previously contained no outbound link of any kind, so a user who hit a mispriced page had nowhere to report it and the author had no signal that anything was wrong.
- A CI status badge in the README. Every push runs the unit suite, a Chromium Playwright suite, a real Firefox runtime test and `web-ext lint`, and none of that was visible to anyone reading the repository.

## 2.1.0 - 2026-09-04

Renamed from Currency Converter Pro to Twinprice. No runtime behaviour changed.

### Changed

- The extension is now called Twinprice. The old name was shared with two other Chrome Web Store listings, one of them an established extension with roughly 40,000 users and a 4.7-star rating, so searching the store for the exact name returned that listing first and this one second. The store title carries the descriptive tail `Currency Converter for Every Price on a Page` so the listing still matches what shoppers search for, while `short_name` keeps the browser's own extension list reading simply `Twinprice`.
- Release archives are now named `twinprice-<version>-<browser>.zip`. Archives published before this release keep the names they shipped under.
- The Firefox add-on ID is deliberately unchanged. It is the identity Mozilla keys the listing on, so changing it would orphan the existing add-on rather than rename it. The Chrome item ID is fixed by the store and is likewise unaffected, so installed copies update to the new name in place.

## 2.0.3 - 2026-08-28

Two detection fixes, both found by writing the regression tests that 2.0.2
should have shipped with.

### Fixed

- Turkish product pages could not resolve a price written as `TL`. A page scores 15 for naming its language and, in 2.0.2, 10 for a visible price marker — 25, just under the 30 needed for medium confidence. Only a listing grid with several prices cleared the bar, so a product page showing one price fell back to "select the source currency manually". What makes an ambiguous marker safe is the corroboration gate, which already requires an independent signal to have named the currency, not the halved weight that was applied on top of it. A corroborated marker now scores per occurrence like an unambiguous one, and a single price resolves.
- A price whose symbol sits one level deeper than its amount was converted twice, rendering as `$99.00 ≈ 89,10 € ≈ 89,10 €`. Markup such as `<p class="price"><span><b>$</b>99.00</span></p>` was planned once as the paragraph a price selector matched and once as the span a split text node nominated. The guard against overlapping plans skipped an element that wrapped an already-planned one but never an element wrapped by one; it is now symmetric, so a nested chain yields a single badge.

### Testing

- The four faults reported on 2026-08-27 are pinned against the markup of the sites that exposed them, with AZN and TRY seeded so the tests convert real manat and lira rather than a dollar stand-in.
- Replaced three one-off tests with matrices, because every one of those faults sat in a cell no test visited: a price-shape corpus holding one row per way a storefront has been seen to draw a price, plus noise that must stay untouched; a display-mode test asserting both modes against both rendering paths; and a page-detection table asserting the currency and confidence floor a page context must produce, with negative rows for a German recipe's teaspoons and an English "TL;DR". The corpus found the double conversion above on its first run.
- Undo is now held to restoring the page's markup byte for byte in both display modes, which matters more since "converted only" began moving the site's own nodes to hide them.
- Added tap.az, Turbo.az, Trendyol, Hepsiburada, and n11 to the live-site matrix, which covered twenty large Western and Asian markets and no market that writes prices with a word-like marker.

## 2.0.2 - 2026-08-28

A bug-fix release for three faults reported together: the on-page offer went
silent on single-page shops, two whole markets were undetectable, and the
"converted only" display option did nothing on a large class of sites.

### Fixed

- The on-page offer never returned after an in-page navigation. `applySitePreference` ran once, at `document_idle`, and nothing watched for routing afterwards unless the page had already been converted. On a single-page shop the first offer was therefore the only one a visitor ever got: dismiss it, or arrive through a client-side route change, and the extension stayed silent for the life of the tab. A route watcher now re-offers on `popstate`, `hashchange`, the Navigation API, and a one-second poll that backstops `history.pushState`, which fires no event of its own. A bare `#section` anchor is deliberately not treated as a navigation, so anchor clicks do not bring a dismissed offer back.
- Prices a site splits across bare text nodes were never converted. Server-rendered React writes an interpolated amount as `66 000<!-- --> ₼`: no child elements, and two text nodes that carry no price apart. Both split-price paths skipped any element with `childElementCount === 0`, and neither text node matched on its own. Because discovery reads `textContent`, such pages still offered to convert and then reported "No confidently identified prices found" — tap.az converted 0 of 28 visible prices. The guard now also accepts an element whose text is spread over more than one text node.
- Turkish prices were undetectable. `TRY` knew only the `₺` sign, while Turkish storefronts write `249,90 TL`. `TL` is now a recognised lira marker, but a context-required one, so a German recipe's "2 TL Zucker" is not read as two lira.
- "Converted only" left the original price on screen wherever it was split across elements. The appended-badge path never hid what the site had drawn, and the presentation update explicitly skipped the hide branch for those badges, so both display modes rendered identically. The badge now parks the site's own price nodes in a hidden element and hands them back when the setting changes or the conversion is undone. The default side-by-side mode still only appends, and does not touch the site's DOM.

### Changed

- Page-currency detection also weighs the price markers it can see. Storefronts that price in a symbol and never print an ISO code gave detection almost nothing to work with, which is what kept a context-required marker such as `TL` from ever resolving. Unambiguous markers now score on their own; ambiguous ones only corroborate a currency another signal has already named. A substring test precedes each pattern so currencies absent from the page cost no regex pass. This also lifts tap.az from medium to high confidence.

### Testing

- Added regression coverage for all four fixes: end-to-end tests for the re-offer after an in-page route change, for a price split across bare text nodes, and for "converted only" hiding and then restoring an element-split price; detector scenarios for a Turkish storefront, a German recipe that must not read as one, and a manat marketplace; and a registry test that an appended badge returns the price nodes it parked.

## 2.0.1 - 2026-08-18

A maintenance release. It carries the refactor that followed the 2.0.0 design
work, together with one fix for a conversion the popup would not perform.

### Fixed

- Swapping the currency pair failed with "The target ... matches your default source currency" on any site without a saved source override. The guard against a target that duplicates the default source compared the new target against the *previous* source, and the new target of a swap is always the old source, so it rejected every swap. It now compares against the source the same update saves, and still rejects the case where a remembered site's edit genuinely leaves the global source in place.

### Changed

- Price detection is about 1.7x faster. The symbol-group scan lowercased every marker and re-tested the context-required symbol set on each text node, then discarded both; they are now precomputed once per symbol group. Over a 5,000-text-node page mixing price and non-price content, the scan falls from roughly 48 ms to 27 ms, with byte-identical detection output. This is the local page scan only. Rate fetching is network-bound and cached, and is unchanged.
- Deduplicated three parts of the runtime into shared helpers: `background/http.js` for the timeout-and-abort fetch, `background/catalog-snapshot.js` for cached catalog reads, and `shared/content-script-resources.js` for manifest-derived script injection, which the popup and the background page-action service had each derived on their own.
- Reworked the README: added a table of contents, a development quick-start, and the declared Firefox minimums; shortened the release table; and removed the softmax confidence model, which its own text described as uncalibrated.

### Removed

- The `build-release.sh` and `build-release.ps1` wrappers. Both only ran `npm run build`, which is already cross-platform.
- Fourteen unreachable entries from module export objects. Every function and constant they named is still used inside its own module, so only the export line went.

### Packaging

- Added `npm run build:promo`, which renders the 440x280 Chrome Web Store small promo tile through Chromium from the extension's own gradient, glyph, and badge colours.

### Testing

- Added regression coverage for the swap fix: one test asserting that a global pair swap persists, and one pinning the remembered-site conflict that must still be refused.
- Store-asset capture runs against a realistic storefront fixture, the selection screenshot shows the converted amount, and the test catalog ordering is corrected.

## 2.0.0 - 2026-08-17

A design release. The popup is rebuilt around the live exchange rate, and the
on-page surfaces now share its visual language.

### Added

- The current exchange rate is shown in the popup header the moment it opens, in tabular monospace, with a freshness indicator that distinguishes a live rate from a cached or unavailable one.
- A seven-day rate sparkline, backed by a new rate-history service with its own cache, background refresh, and stale fallback. History failures are contained and never affect the live rate.
- Recent currency pairs are remembered and offered as one-tap chips.
- The on-page convert prompt now states the rate it would apply before the conversion is accepted.
- Source and target currencies carry a symbol disc. Currency symbols are used rather than flag emoji, which Windows does not ship and which do not map cleanly to currencies.

### Changed

- The custom-amount converter is always visible instead of collapsed behind a disclosure, and its result updates as you type.
- Page options is now the single disclosure in the popup; the converter, its amount row, and the primary action are permanently visible.
- Rebuilt the popup's colour and type systems on explicit tokens, replacing the ad-hoc scale and weights that had drifted.
- The page prompt, selection bubble, and toast moved onto the popup's palette so every surface reads as one product. Converted-price colours are unchanged, including any the user has customised.
- New extension icon: a single currency glyph on the brand blue, chosen to stay legible at the 16px toolbar size.

### Fixed

- The sparkline was invisible because `hidden` is reflected by `HTMLElement` but not `SVGElement`, so assigning it left the attribute in place.
- The target-currency list is now narrowed to currencies the rate provider can actually quote from first paint, rather than only after the converter was expanded.

### Testing

- Added rate-history unit coverage and end-to-end coverage for the rate hero and the prompt's rate line.
- Made the end-to-end suite hermetic by stubbing the rate provider inside the extension service worker. The suite previously called the live provider and asserted a fixed rate, so it failed whenever the real rate moved.
- Split screenshot capture into its own Playwright project so the test suite no longer writes image files, and added reproducible icon and store-asset tooling.

## 1.9.2 - 2026-08-11

### Changed

- Refactored the background runtime into small settings, site-preference, and page-action services while preserving the always-on detector, remembered-site behavior, fallback injection, and stale-registration cleanup.
- Centralized persisted-setting defaults and validation in one shared schema, and extracted popup save reconciliation and manifest-resource selection into focused controllers.
- Extracted conversion tracking and bounded mutation-root scheduling from the page converter so dynamic discovery and conversion use the same tested lifecycle rules.

### Fixed

- Kept SPA price discovery and conversion working across URL changes and scheduler restarts, including inside late-added open shadow roots, and promoted oversized mutation queues to a bounded full-page scan.
- Queued explicit full-page conversion behind an in-flight mutation scan instead of dropping it, while ensuring Restore invalidates both active and queued work.
- Applied display mode, color, and shape changes to existing conversion wrappers in place without restarting rate work or replacing converted elements.

### Testing

- Added focused schema, popup-controller, manifest-resource, conversion-registry, and mutation-scheduler unit coverage; verified the real Chrome worker import graph against Firefox's classic-script order.
- Expanded real-browser coverage for SPA-style dynamic content, late shadow roots, queued conversion races, Restore cancellation, and in-place presentation updates.

## 1.9.1 - 2026-08-05

### Fixed

- Fixed the toolbar popup collapsing to a narrow layout in Chrome and Firefox by restoring deterministic popup sizing.
- Kept expanded Page options usable within browser popup height limits by scrolling the popup content internally.
- Normalized color swatches and disclosure markers for Firefox rendering.

### Testing

- Added real Chrome action-popup coverage for popup width, horizontal overflow, and expanded-options scrolling.

## 1.9.0 - 2026-08-02

### Added

- Added converted-price text and background color controls, square/rounded/pill shapes, and a live before-and-after popup preview.
- Added real-time WCAG contrast guidance, keyboard-accessible controls, and a one-click appearance reset.

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

## 1.7.2 - 2026-07-24

Reconstructed from `release/1.7.2/`. This version shipped but was never written
up; the notes below are read from the archive rather than recalled.

### Changed

- Moved the on-page conversion prompt from the bottom of the viewport to the top, and the selection control from the top to the bottom, so the two no longer competed for the same corner.
- Gave the converted value an entrance animation and the prompt a success pulse when a conversion lands.
- Extended the `prefers-reduced-motion` block to cover both new animations as well as the prompt, so a reduced-motion setting still disables everything that moves.

`content/styles.css` is the only file that differs from 1.7.1 apart from the version string.

## 1.7.1 - 2026-07-24

Reconstructed from `release/1.7.1/`. Released between 1.7.0 and 1.7.2; the exact
date was not recorded, so the date above is the day its archive was committed.

### Removed

- Removed the **Show the one-click control on webpages** checkbox from the popup. The on-page prompt now follows the global enabled state alone, rather than a second switch that could silently suppress it. A per-prompt setting returned later as `showPagePrompt`.

## 1.7.0 - 2026-07-24

Reconstructed from `release/1.7.0/`. Released after 1.6.2 on 2026-07-21 and
before 1.7.2; the exact date was not recorded, so the date above is the day its
archive was committed.

This is the first version to load the converter declaratively on every ordinary
webpage, and the beginning of the permission round trip that 1.7.3 reversed and
1.8.0 reinstated.

### Changed

- Replaced the optional `http://*/*` and `https://*/*` grants with required host permissions and a declarative `content_scripts` block, so the converter loaded on ordinary webpages without the user approving each site first.
- Changed remembered websites from "grants access only to this site, you can revoke it anytime" into "automatically converts this website when you revisit it", following that permission change.
- Reworded the popup's prompt toggle to **Show the one-click control on webpages**, and reworded the extension description around one-click control rather than per-site controls.

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
