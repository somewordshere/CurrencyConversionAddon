// Composes Chrome Web Store screenshots (1280x800) from captured product shots.
//
// Capture the source images first, then run this:
//   npx playwright test tests/e2e/shot.spec.js
//   node scripts/build-store-screenshots.mjs
//
// Copy lives in TILES below and is meant to be edited.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = resolve(ROOT, "screenshots");
const OUT = resolve(ROOT, "store/chrome/screenshots");
const WIDTH = 1280;
const HEIGHT = 800;

const TILES = [
  {
    file: "01-live-rate.png",
    source: "v2-popup-light.png",
    kicker: "Live rate, front and centre",
    headline: "See the rate before you convert",
    body: "Every conversion shows the exact rate, how fresh it is, and the last seven days at a glance.",
    shotWidth: 420
  },
  {
    file: "02-on-page.png",
    source: "v2-inpage-prompt.png",
    kicker: "Works where you shop",
    headline: "Convert prices where you shop",
    body: "One click converts every price in view. The original stays beside it, or is replaced — your choice.",
    shotWidth: 760
  },
  {
    file: "03-converted.png",
    source: "v2-inpage.png",
    kicker: "Readable at a glance",
    headline: "Converted prices that stand out",
    body: "Style the converted price however you like. Contrast is checked for you as you pick colours.",
    shotWidth: 760
  },
  {
    file: "04-select-price.png",
    source: "v2-inpage-selection.png",
    kicker: "One price at a time",
    headline: "Highlight a price to convert it",
    body: "Select any price and a converter appears right beside it. Nothing else on the page is touched.",
    shotWidth: 760
  }
];

function dataUri(file) {
  const path = resolve(SHOTS, file);
  if (!existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

function tileMarkup(tile, image) {
  return `<style>
  @font-face { font-family: x; src: local("Segoe UI"); }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; display: grid;
    grid-template-columns: 1fr 1fr; align-items: center; gap: 56px;
    padding: 0 80px;
    background: linear-gradient(152deg, #16327e 0%, #1b3fbf 58%, #2350d8 100%);
    color: #fff;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .kicker {
    font-size: 17px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: #a9bef5; margin-bottom: 22px;
  }
  h1 {
    font-size: 52px; line-height: 1.08; letter-spacing: -.025em;
    font-weight: 700; margin-bottom: 26px; text-wrap: balance;
  }
  p { font-size: 22px; line-height: 1.5; color: #d5e0fb; max-width: 30ch; }
  .stage { display: flex; justify-content: center; align-items: center; }
  img {
    width: ${tile.shotWidth}px; height: auto; display: block;
    border-radius: 10px;
    box-shadow: 0 40px 80px -24px rgba(6, 12, 32, .65), 0 6px 18px rgba(6, 12, 32, .3);
  }
  .missing {
    width: ${tile.shotWidth}px; height: 420px; display: grid; place-items: center;
    border: 2px dashed #a9bef5; border-radius: 10px; color: #a9bef5; font-size: 20px;
  }
</style>
<div>
  <div class="kicker">${tile.kicker}</div>
  <h1>${tile.headline}</h1>
  <p>${tile.body}</p>
</div>
<div class="stage">
  ${image ? `<img src="${image}" alt="">` : `<div class="missing">${tile.source} not captured</div>`}
</div>`;
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  for (const tile of TILES) {
    const image = dataUri(tile.source);
    if (!image) console.warn(`! ${tile.source} is missing — rendering a placeholder.`);
    await page.setContent(tileMarkup(tile, image));
    await page.waitForTimeout(120);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    writeFileSync(resolve(OUT, tile.file), png);
    console.log(`wrote ${resolve(OUT, tile.file)} (${(png.length / 1024).toFixed(0)}KB)`);
  }
} finally {
  await browser.close();
}
