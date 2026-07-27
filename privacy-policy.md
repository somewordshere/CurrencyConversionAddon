# Currency Converter Pro Privacy Policy

Effective date: July 27, 2026 (version 1.8.0)

Currency Converter Pro is a Chrome and Firefox extension that identifies prices on webpages and converts them into a currency selected by the user.

## Information processed by the extension

To provide currency detection and conversion, the extension processes the following information locally in the user's browser:

- Visible webpage text that may contain prices or currency markers
- Structured product and price metadata contained in the webpage
- The webpage's domain and declared language, used as weak currency-detection signals
- Text deliberately highlighted by the user for individual conversion

When the converter is enabled, a lightweight detector runs on ordinary HTTP and
HTTPS webpages as they open. It checks locally for supported prices and shows the
on-page conversion prompt only after a likely price is found. A website that the
user marks for automatic conversion may also have its supported prices converted
when it is visited. Webpage information is processed temporarily on the user's
device. Raw page contents and highlighted text are not collected by the developer,
retained by the extension, or transmitted to the developer or exchange-rate
provider. A detected ISO source-currency code may be included in the rate request
described below.

The **Convert custom amount** disclosure processes the entered amount locally and
does not need to inspect the current webpage. If the source remains `AUTO` and no
page conversion has identified it, the popup requires the user to choose an
explicit source currency. The amount itself is not included in the rate request.

## Settings and locally stored information

The extension stores:

- Whether the extension is enabled
- The selected source-currency mode
- The selected target currency
- Price-display and page-prompt preferences
- Recently selected currency codes
- A cache of exchange rates, including the rate date and fetch time
- The origins of websites the user chooses for automatic conversion
- A source-currency mode for an automatic-conversion website, including a manual currency or `AUTO`

Core extension settings use the browser's extension sync storage and may be
synchronized by Google or Mozilla according to the user's browser settings and
the browser provider's privacy practices. Recent currencies, remembered website
origins, their source-currency modes, and exchange-rate data are stored locally in
the browser.

The extension does not store webpage contents, highlighted text, or general
browsing history. It stores only the website origins the user deliberately marks
for automatic conversion and any source-currency mode associated with those
origins, until the user removes that access. Selecting `AUTO` replaces a manual
website source with that website's automatic-detection mode.

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
- Access to ordinary HTTP and HTTPS webpages: loads the local price detector when
  pages open so the extension can find supported prices and offer conversion
  without requiring a toolbar click. Page contents and URLs are not transmitted
- `activeTab` and `scripting`: provides a user-triggered fallback on supported
  pages where the normal detector was not loaded, including manually allowed local files
- Access to `api.frankfurter.dev`: retrieves exchange rates

## Limited Use

Information received through browser extension APIs is used only to provide
Currency Converter Pro's disclosed single purpose and is handled in accordance
with the Chrome Web Store User Data Policy, including the Limited Use
requirements. It is not used for advertising, profiling, credit decisions, sale,
or unrelated purposes, and humans are not allowed to read webpage data.

## Data retention and deletion

Webpage information and selected text are processed only while the relevant webpage is open and are not retained.

Saved settings and automatic-conversion website origins remain until the user
changes them, clears extension data, or uninstalls the extension. Turning off the
global **Enable converter** switch stops price scanning, prompts, and automatic
conversion without deleting a saved automatic-conversion origin or its
source-currency mode.

Turning off **Convert this site automatically** deletes the remembered origin and
its source-currency mode. Ordinary local price detection and the on-page prompt
remain available while the global converter is enabled. Selecting `AUTO` for an
automatic-conversion website stores automatic detection as that website's source
mode.
Cached exchange rates are refreshed regularly and remain available as an offline
fallback until local extension data is cleared or the extension is uninstalled.

## Security

All external exchange-rate requests use HTTPS. The extension does not execute remotely hosted code.

## Children

The extension is not designed to collect personal information from children or any other users.

## Changes to this policy

If the extension's data practices change, this policy will be updated before the changed version is published.

## Contact

For privacy questions, contact the developer using the support contact shown on the Currency Converter Pro store listing or GitHub repository.
