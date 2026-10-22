#!/usr/bin/env bash
# Builds the Chrome Web Store upload: dist/monty-filters-<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/hide-sold-out"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/manifest.json")"
OUT="$ROOT/dist/monty-filters-$VERSION.zip"

for f in manifest.json background.js content.js content.css \
         icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png; do
  [[ -f "$SRC/$f" ]] || { echo "missing $f" >&2; exit 1; }
done
node --check "$SRC/content.js"
node --check "$SRC/background.js"

mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$SRC" && zip -qr -X "$OUT" manifest.json background.js content.js content.css icons \
  -x '*.DS_Store')
echo "Built $OUT"
unzip -l "$OUT"
