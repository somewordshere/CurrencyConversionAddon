# Chrome Web Store Privacy Answers

These answers are written to match Currency Converter Pro version 1.5.1.

## Single purpose

Currency Converter Pro detects monetary prices on webpages and converts them into a currency selected by the user.

## Permission justifications

### `storage`

Stores the user's enabled state, source/target currency preferences, display mode,
and page-prompt preference. It also stores recent currency codes,
remembered website origins, and the latest successful exchange-rate data so the
extension can continue working temporarily while offline.

### `contextMenus`

Adds the “Convert selected currency” command to Chrome's right-click menu so users can convert a highlighted price.

### `activeTab` and `scripting`

Temporarily inspect price text and currency metadata on the active webpage after
the user invokes the extension and display the requested conversions. Page
content is processed locally and is not transmitted.

### Optional website access: `http://*/*` and `https://*/*`

Allows the user to opt individual websites into automatic conversion on future
visits. Access is requested for the current origin only, never granted to every
website by default, and is revoked when the user forgets that website.

### Host access: `https://api.frankfurter.dev/*`

Required to retrieve reference exchange rates. Requests contain only ISO currency
codes for the source and supported quote currencies. Page content, selected text,
price values, and visited URLs are not sent.

## Remote code

Select:

**No, I am not using remote code.**

The extension downloads exchange-rate data as JSON but does not download or execute JavaScript, WebAssembly, or other executable code.

## Data usage disclosure

The extension locally accesses website content because that access is necessary
to detect prices and currencies. It does not transmit, sell, or retain website
content or selected text. It locally retains only origins deliberately marked
by the user for automatic conversion.

Core extension settings may be stored through Chrome Storage Sync. Recent
currencies, remembered origins, and exchange-rate data are cached locally.
Only currency codes are sent to Frankfurter.

When the dashboard asks which data is **collected**, answer according to the exact wording shown by the current dashboard:

- If “collected” means transmitted off the user's device to the developer or a third party, do not select website content or browsing history. Neither is transmitted.
- If the dashboard explicitly treats local access or local processing as collection, select **Website content** and explain that it is processed locally only for the user-facing conversion feature and is never transmitted or retained.

Do not claim collection of:

- Personally identifiable information
- Health information
- Authentication information
- Personal communications
- Location
- Browsing history sent off-device
- Financial or payment information

Prices shown publicly on shopping webpages are processed as webpage content, not collected as the user's personal financial information.

## Limited Use certification

The extension's use of webpage access is limited to its single user-facing purpose: detecting and converting prices. Data is not used for advertising, profiling, credit decisions, sale, or unrelated purposes. The developer does not allow humans to read user webpage data.

## Privacy policy URL

Use the public repository policy URL:

`https://github.com/somewordshere/CurrencyConversionAddon/blob/main/privacy-policy.md`

Before submission, verify that the support contact named by the Store listing is available to users.
