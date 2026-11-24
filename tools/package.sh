#!/usr/bin/env bash
# Builds dist/MediaHarbor-<version>.zip, ready to load in Chrome or upload to the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
OUT="dist/MediaHarbor-v${VERSION}.zip"
rm -f "$OUT"
(cd extension && zip -r -9 -q "../$OUT" . -x '*.DS_Store')
echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
