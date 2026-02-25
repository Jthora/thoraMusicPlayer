#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/app/android/app/build/reports/p0-prioritization"
DEBUG_CLASS="$ROOT_DIR/app/android/app/build/reports/p0-debug/failure-classification.json"
RELEASE_CLASS="$ROOT_DIR/app/android/app/build/reports/p0-release/failure-classification.json"
OUT_JSON="$REPORT_DIR/p0-blocker-prioritization.json"
OUT_TXT="$REPORT_DIR/p0-blocker-prioritization.txt"

mkdir -p "$REPORT_DIR"

python3 "$ROOT_DIR/scripts/prioritize-p0-blockers.py" \
  --debug "$DEBUG_CLASS" \
  --release "$RELEASE_CLASS" \
  --out-json "$OUT_JSON" \
  --out-txt "$OUT_TXT"

cat "$OUT_TXT"
echo "PRIORITIZATION_JSON=$OUT_JSON"
echo "PRIORITIZATION_TXT=$OUT_TXT"
