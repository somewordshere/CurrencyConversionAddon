#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$ROOT_DIR/manifest.json','utf8')).version)")
RELEASE_DIR="$ROOT_DIR/release"
OUTPUT="$RELEASE_DIR/currency-converter-$VERSION.zip"

mkdir -p "$RELEASE_DIR"
rm -f "$OUTPUT"

cd "$ROOT_DIR"
zip -q -r "$OUTPUT" \
  manifest.json \
  background/catalog.js \
  background/rates.js \
  background/service-worker.js \
  content/content.js \
  content/converter.js \
  content/detector.js \
  content/number-parser.js \
  content/page-ui.js \
  content/styles.css \
  popup/popup.css \
  popup/popup.html \
  popup/popup.js \
  shared/currencies.js \
  shared/messages.js \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png

printf '%s\n' "$OUTPUT"
