// Renders the Chrome Web Store small promo tile (440x280).
//
// Same approach as build-icons.mjs: Chromium already ships with Playwright, so
// the tile is rasterized in a real renderer instead of adding an image library.
// Colors are the extension's own — the icon gradient and the default converted
// price badge — so the tile matches what a user actually sees after installing.
//
//   node scripts/build-promo-tile.mjs [--out store/chrome/promo]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 440;
const HEIGHT = 280;

// src/icons + scripts/build-icons.mjs
const BRAND = "#1b3fbf";
const BRAND_DEEP = "#16327e";
const GLYPH = "#ffffff";
// CurrencySettings.DEFAULTS converted-price appearance
const BADGE_TEXT = "#166534";
const BADGE_FILL = "#dcfce7";

const markup = `
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 30px 34px;
    box-sizing: border-box;
    background:
      radial-gradient(120% 90% at 82% 8%, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 58%),
      linear-gradient(160deg, ${BRAND} 0%, ${BRAND_DEEP} 100%);
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: ${GLYPH};
    overflow: hidden;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .mark { display: block; flex: none; }
  .name {
    font-size: 25px;
    font-weight: 700;
    letter-spacing: -.017em;
    line-height: 1;
  }
  .demo {
    display: flex;
    align-items: center;
    gap: 13px;
    font-variant-numeric: tabular-nums;
  }
  .from {
    font-size: 41px;
    font-weight: 650;
    letter-spacing: -.022em;
    line-height: 1;
  }
  .arrow { font-size: 27px; opacity: .55; line-height: 1; }
  .badge {
    background: ${BADGE_FILL};
    color: ${BADGE_TEXT};
    font-size: 41px;
    font-weight: 700;
    letter-spacing: -.022em;
    line-height: 1;
    padding: 9px 16px;
    border-radius: .35em;
    white-space: nowrap;
  }
  .tag {
    font-size: 16.5px;
    line-height: 1.35;
    font-weight: 450;
    color: rgba(255,255,255,.88);
    max-width: 34ch;
  }
  .tag b { font-weight: 660; color: ${GLYPH}; }
</style>

<div class="brand">
  <svg class="mark" width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(255,255,255,.22)"/>
        <stop offset="1" stop-color="rgba(255,255,255,.10)"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="11" fill="url(#tile)"/>
    <rect x=".75" y=".75" width="46.5" height="46.5" rx="10.4"
          fill="none" stroke="rgba(255,255,255,.34)" stroke-width="1.5"/>
    <g fill="none" stroke="${GLYPH}" stroke-width="4.2"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="M31.5 15.5H21a5.25 5.25 0 0 0 0 10.5h6a5.25 5.25 0 0 1 0 10.5H16"/>
      <path d="M24 9.5v29"/>
    </g>
  </svg>
  <span class="name">Currency&nbsp;Converter&nbsp;Pro</span>
</div>

<div class="demo">
  <span class="from">$68.00</span>
  <span class="arrow">&rarr;</span>
  <span class="badge">61,20&nbsp;&euro;</span>
</div>

<p class="tag"><b>Every price in your currency.</b> Detected and converted right in your browser.</p>
`;

const outDir = (() => {
  const flag = process.argv.indexOf("--out");
  return resolve(ROOT, flag === -1 ? "store/chrome/promo" : process.argv[flag + 1]);
})();

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(markup);
  const png = await page.screenshot();
  const file = resolve(outDir, `small-promo-tile-${WIDTH}x${HEIGHT}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
} finally {
  await browser.close();
}
