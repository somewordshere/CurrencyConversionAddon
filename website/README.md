# Twinprice website

A buildless, responsive landing page and privacy page for the existing Chrome and Firefox extension. The original extension files and release process are separate.

## Preview

From this directory, run `npm run dev` and open `http://127.0.0.1:4173`.
Run `npm run check` to check JavaScript syntax. No installation or build is required.

## Content

- `dist/index.html`: landing page, store links, screenshot, FAQs.
- `dist/styles.css`: shared responsive styles, keyboard focus, reduced motion.
- `dist/demo.js`: local example conversions; no requests or persistence.
- `dist/privacy/index.html`: the full existing extension policy and website privacy information.
- `sync-policy.mjs`: run `node sync-policy.mjs` from this directory to refresh the privacy page from the parent extension's `privacy-policy.md`.

Example rates are illustrative, not live financial data. The demo loops through PLN, USD, JPY, UAH, GBP, MXN, ZAR, KRW, KZT, INR and DZD at 2.8-second intervals with a 420ms upward slide. The badge reserves space for the widest example; only text transforms and opacity animate, avoiding per-frame width layout. Formatted example amounts are cached once. These choices are not the full extension currency catalog. Selecting a currency pauses the loop; Play animation resumes it. Turning conversion off, focusing the currency picker, leaving the demo out of view, or hiding the tab suspends cycling. Reduced-motion preferences disable automatic playback by default and remove slide transitions. Automatic changes do not trigger screen-reader announcements. There is no standalone calculator, analytics, tracking, or account system.

## Launch notes

Firefox's current branding was verified directly through Mozilla's add-on API: “Twinprice - Currency Converter for Every Page,” by Krlo, at `https://addons.mozilla.org/en-US/firefox/addon/twinprice/`. The site's logo and favicon use the official 128px icon from that listing (`dist/assets/twinprice-icon.png`). Chrome's last verified listing still used Currency Converter Pro; naming-transition notices now apply only to Chrome. Recheck names and policies when updating the published extension; do not imply both stores have the same release. The published policy is synced from the current extension policy and includes its version and effective date.

The real shopping screenshot is copied unchanged from the extension repository. It is labeled as historical and its rates are not presented as current. Source and support links target the repository documented by the extension.

## Hosting

The public website is https://twinprice.com/. The Wrangler configuration deploys only this directory's authored dist/ assets to the existing twinprice Worker. The custom domain is managed by Cloudflare. The workers.dev endpoint and preview URLs are disabled.

Use Wrangler 4.x from this directory: run wrangler deploy --dry-run, then wrangler deploy. Worker Access is scoped to previews only so the production custom domain is public; do not modify the shared owner-only Access policy or other applications.

The website source and assets are tracked in GitHub. Extension source and release archives must remain outside the deployed dist/ directory.
