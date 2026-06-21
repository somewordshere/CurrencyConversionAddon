# Currency Converter Privacy Policy

Effective date: June 21, 2026

Currency Converter is a Chrome extension that identifies prices on webpages and converts them into a currency selected by the user.

## Information processed by the extension

To provide currency detection and conversion, the extension processes the following information locally in the user's browser:

- Visible webpage text that may contain prices or currency markers
- Structured product and price metadata contained in the webpage
- The webpage's domain and declared language, used as weak currency-detection signals
- Text deliberately highlighted by the user for individual conversion

This webpage information is processed temporarily on the user's device. It is not collected by the developer, stored by the extension, or transmitted to the developer or the exchange-rate provider.

## Settings and locally stored information

The extension stores:

- Whether the extension is enabled
- The selected source-currency mode
- The selected target currency
- A temporary daily cache of exchange rates

Extension settings are stored using Chrome Storage Sync and may be synchronized by Google according to the user's Chrome settings and Google's privacy practices. Exchange-rate data is stored locally in Chrome and is replaced as rates are refreshed.

The extension does not store webpage contents, highlighted text, browsing history, or visited URLs.

## Exchange-rate service

The extension requests reference exchange rates from the public Frankfurter API at:

https://api.frankfurter.dev/

Only currency codes required for a conversion, such as `CHF` and `EUR`, are included in these requests. Webpage contents, highlighted text, prices, URLs, and browsing history are not sent to Frankfurter.

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

The extension uses the following Chrome permissions:

- `storage`: saves extension settings and caches exchange rates
- `contextMenus`: provides the “Convert selected currency” right-click action
- Access to HTTP and HTTPS webpages: detects and displays currency conversions
- Access to `api.frankfurter.dev`: retrieves exchange rates

## Data retention and deletion

Webpage information and selected text are processed only while the relevant webpage is open and are not retained.

Saved settings remain until the user changes them, clears extension data, or uninstalls the extension. Cached exchange rates are refreshed by date and are removed when Chrome removes the extension's local storage.

## Security

All external exchange-rate requests use HTTPS. The extension does not execute remotely hosted code.

## Children

The extension is not designed to collect personal information from children or any other users.

## Changes to this policy

If the extension's data practices change, this policy will be updated before the changed version is published.

## Contact

For privacy questions, contact the developer using the support contact shown on the Currency Converter Chrome Web Store listing.

