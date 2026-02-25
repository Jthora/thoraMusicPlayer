#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
ANDROID_DIR="$ROOT_DIR/app/android"
REPORT_DIR="$ROOT_DIR/app/android/app/build/reports/p0-release"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_UI_AUTOMATION="${RUN_UI_AUTOMATION:-0}"

mkdir -p "$REPORT_DIR"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found in PATH"
  exit 1
fi

DEVICE_SERIALS="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [[ -z "$DEVICE_SERIALS" ]]; then
  echo "No connected Android device found"
  exit 1
fi

run_case() {
  local command="$1"
  local log_file="$2"
  set +e
  bash -lc "$command" >"$log_file" 2>&1
  local code=$?
  set -e
  echo "$code"
}

BUILD_LOG="$REPORT_DIR/assemble-release.log"
SMOKE_LOG="$REPORT_DIR/device-ui-smoke-release.log"
JSON_OUT="$REPORT_DIR/p0-release-bundle.json"
TXT_OUT="$REPORT_DIR/p0-release-bundle.txt"
CLASS_JSON_OUT="$REPORT_DIR/failure-classification.json"
CLASS_TXT_OUT="$REPORT_DIR/failure-classification.txt"

BUILD_CODE=$(run_case "cd '$ANDROID_DIR' && ./gradlew :app:assembleRelease" "$BUILD_LOG")
SMOKE_CODE=0
if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
  SMOKE_CODE=$(run_case "cd '$APP_DIR' && npm run test:device-ui" "$SMOKE_LOG")
fi

BUILD_STATUS="FAIL"
SMOKE_STATUS="SKIPPED"
[[ "$BUILD_CODE" -eq 0 ]] && BUILD_STATUS="PASS"
if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
  SMOKE_STATUS="FAIL"
  [[ "$SMOKE_CODE" -eq 0 ]] && SMOKE_STATUS="PASS"
fi

OVERALL="FAIL"
if [[ "$RUN_UI_AUTOMATION" != "1" && "$BUILD_STATUS" == "PASS" ]]; then
  OVERALL="PASS"
elif [[ "$BUILD_STATUS" == "PASS" && "$SMOKE_STATUS" == "PASS" ]]; then
  OVERALL="PASS"
fi

cat >"$JSON_OUT" <<EOF
{
  "timestampUtc": "$TIMESTAMP",
  "overall": "$OVERALL",
  "deviceSerials": [$(printf '"%s",' $DEVICE_SERIALS | sed 's/,$//')],
  "runs": [
    {
      "id": "assemble-release",
      "status": "$BUILD_STATUS",
      "exitCode": $BUILD_CODE,
      "log": "$BUILD_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/outputs/apk/release/app-release.apk"
      ]
    },
    {
      "id": "device-ui-smoke-release",
      "status": "$SMOKE_STATUS",
      "exitCode": $SMOKE_CODE,
      "log": "$SMOKE_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/summary.txt",
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/qa-mapping.json"
      ]
    }
  ]
}
EOF

{
  echo "P0_RELEASE_BUNDLE=$OVERALL"
  echo "TIMESTAMP_UTC=$TIMESTAMP"
  echo "DEVICE_SERIALS=$(echo \"$DEVICE_SERIALS\" | tr '\n' ',' | sed 's/,$//')"
  echo "RUN_assemble-release=$BUILD_STATUS (exit=$BUILD_CODE)"
  if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
    echo "RUN_device-ui-smoke-release=$SMOKE_STATUS (exit=$SMOKE_CODE)"
  else
    echo "RUN_device-ui-smoke-release=$SMOKE_STATUS (set RUN_UI_AUTOMATION=1 to enable)"
  fi
  echo "JSON=$JSON_OUT"
} >"$TXT_OUT"

cat "$TXT_OUT"

python3 "$ROOT_DIR/scripts/classify-p0-failures.py" \
  --bundle "$JSON_OUT" \
  --out-json "$CLASS_JSON_OUT" \
  --out-txt "$CLASS_TXT_OUT"

echo "CLASSIFICATION_JSON=$CLASS_JSON_OUT"
echo "CLASSIFICATION_TXT=$CLASS_TXT_OUT"

if [[ "$OVERALL" != "PASS" ]]; then
  exit 1
fi
