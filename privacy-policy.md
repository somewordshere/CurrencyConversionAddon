# Currency Converter Pro Privacy Policy

Effective date: July 24, 2026

Currency Converter Pro is a Chrome and Firefox extension that identifies prices on webpages and converts them into a currency selected by the user.

## Information processed by the extension

To provide currency detection and conversion, the extension processes the following information locally in the user's browser:

- Visible webpage text that may contain prices or currency markers
- Structured product and price metadata contained in the webpage
- The webpage's domain and declared language, used as weak currency-detection signals
- Text deliberately highlighted by the user for individual conversion

The extension is available on ordinary HTTP and HTTPS webpages so it can display
the one-click page control before the toolbar popup is opened. This webpage information is processed temporarily on the user's device. Raw page
contents and highlighted text are not collected by the developer, retained by
the extension, or transmitted to the developer or exchange-rate provider. A
detected ISO source-currency code may be included in the rate request described
below.

## Settings and locally stored information

The extension stores:

- Whether the extension is enabled
- The selected source-currency mode for each website where the user chooses one
- The selected target currency
- The price-display preference
- Recently selected currency codes
- A cache of exchange rates, including the rate date and fetch time
- Website origins associated with an explicit source currency or automatic-conversion preference

Core extension settings use the browser's extension sync storage and may be
synchronized by Google or Mozilla according to the user's browser settings and
the browser provider's privacy practices. Recent currencies, per-website source
currencies, remembered website origins, and exchange-rate data are stored locally
in the browser.

The extension does not store webpage contents, highlighted text, or general
browsing history. It stores only website origins for which the user explicitly
selects a source currency or enables automatic conversion. Removing the explicit
source choice by selecting `AUTO` deletes that website's source-currency entry.

## Exchange-rate service

The extension requests reference exchange rates from the public Frankfurter API at:

https://api.frankfurter.dev/

Only ISO currency codes for the source and supported quote currencies are included
in these requests. Webpage contents, highlighted text, price values, URLs, and
browsing history are not sent to Frankfurter.

Requests use HTTPS. As with normal internet requests, Frankfurter and its infrastructure provider may receive technical request information such as the user's IP address and browser network metadata. Their handling of that information is governed by their own practices.

## Data sharing and sale

The developer does not:

- Collect or sell personal information
- Collect browsing history
- Use analytics or advertising trackers
- Use data for personalized advertising
- Share webpage content, highlighted text, or visited URLs with third parties
- Allow humans to read user webpage data

## Permissions

The extension uses the following browser permissions:

- `storage`: saves extension settings and caches exchange rates
- `contextMenus`: provides the “Convert selected currency” right-click action
- Access to HTTP and HTTPS websites: displays the one-click conversion control and
  locally scans and updates visible prices; page contents and URLs are not transmitted
- `activeTab` and `scripting`: provides a user-triggered fallback on supported pages
  where the normal page control could not be loaded
- Access to `api.frankfurter.dev`: retrieves exchange rates

## Data retention and deletion

Webpage information and selected text are processed only while the relevant webpage is open and are not retained.

Saved settings, per-website source choices, and remembered website origins remain
until the user changes them, clears extension data, or uninstalls the extension. Cached exchange rates
are refreshed regularly and remain available as an offline fallback until local
extension data is cleared or the extension is uninstalled.

## Security

All external exchange-rate requests use HTTPS. The extension does not execute remotely hosted code.

## Children

The extension is not designed to collect personal information from children or any other users.

## Changes to this policy

If the extension's data practices change, this policy will be updated before the changed version is published.

## Contact

For privacy questions, contact the developer using the support contact shown on the Currency Converter Pro store listing or GitHub repository.
