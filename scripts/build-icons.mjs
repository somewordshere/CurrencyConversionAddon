// Renders the extension icon to PNG at every size the manifests declare.
//
// Chromium is already a dev dependency through Playwright, so the icons are
// rasterized in a real renderer instead of adding an image-processing package.
//
//   node scripts/build-icons.mjs [--out src/icons]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 32, 48, 128];

const BRAND = "#1b3fbf";
const BRAND_DEEP = "#16327e";
const GLYPH = "#ffffff";

// Drawn on a 48-unit grid. The glyph is deliberately oversized and heavy: the
// 16px toolbar icon is seen every day and decides the mark, not the store tile.
function iconMarkup(size) {
  const radius = size <= 16 ? 9 : 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="${radius}" fill="url(#tile)"/>
  <g fill="none" stroke="${GLYPH}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M31.5 15.5H21a5.25 5.25 0 0 0 0 10.5h6a5.25 5.25 0 0 1 0 10.5H16"/>
    <path d="M24 9.5v29"/>
  </g>
</svg>`;
}

const outDir = (() => {
  const flag = process.argv.indexOf("--out");
  return resolve(ROOT, flag === -1 ? "src/icons" : process.argv[flag + 1]);
})();

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${iconMarkup(size)}`
    );
    // omitBackground keeps the area outside the rounded corners transparent.
    const png = await page.screenshot({ omitBackground: true });
    const file = resolve(outDir, `icon${size}.png`);
    writeFileSync(file, png);
    console.log(`wrote ${file} (${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
