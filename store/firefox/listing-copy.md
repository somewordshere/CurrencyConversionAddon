# Firefox Add-ons listing copy

## Name

Currency Converter Pro

## Summary

Convert webpage prices privately with searchable currencies, automatic detection, per-site controls, and cached exchange rates.

## Description

Currency Converter Pro makes prices on shopping pages easier to understand without sending your browsing activity to the developer.

### Highlights

- Search currencies by name or ISO code.
- Detect a page's source currency automatically, or choose it manually.
- Convert a whole page, one highlighted price, or a typed amount.
- Keep original prices beside converted values or replace them.
- Remember only websites you explicitly approve.
- Continue temporarily with clearly labeled cached rates when the provider is unavailable.
- Undo webpage changes at any time.

### Privacy

Page contents, visited URLs, highlighted text, and price values are processed locally. Only the selected ISO source and target currency codes are sent to the Frankfurter exchange-rate service. The extension contains no advertising, analytics, tracking, or remotely hosted code.

See the repository privacy policy for complete storage, permission, retention, and provider details.

## Compatibility

- Firefox Desktop 140 or newer
- Manifest V3

## Submission notes

- Upload `release/<version>/currency-converter-pro-<version>-firefox.zip`.
- Submit source separately if Mozilla requests it; the extension archive itself contains runtime files only.
- The manifest declares required `websiteContent` transmission because a page-detected ISO source currency code can be sent to the rate provider. No raw page text, URL, price amount, or browsing history is transmitted.
