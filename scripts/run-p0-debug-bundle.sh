#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
REPORT_DIR="$ROOT_DIR/app/android/app/build/reports/p0-debug"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_SUPPLEMENTAL_ROBUSTNESS="${RUN_SUPPLEMENTAL_ROBUSTNESS:-0}"
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
  local label="$1"
  local command="$2"
  local log_file="$3"

  set +e
  bash -lc "$command" >"$log_file" 2>&1
  local code=$?
  set -e

  echo "$code"
}

UI_LOG="$REPORT_DIR/device-ui-smoke.log"
INST_LOG="$REPORT_DIR/device-ui-instrumentation.log"
ROBUSTNESS_LOG="$REPORT_DIR/device-robustness.log"
JSON_OUT="$REPORT_DIR/p0-debug-bundle.json"
TXT_OUT="$REPORT_DIR/p0-debug-bundle.txt"
CLASS_JSON_OUT="$REPORT_DIR/failure-classification.json"
CLASS_TXT_OUT="$REPORT_DIR/failure-classification.txt"

UI_CODE=0
INST_CODE=0
if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
  UI_CODE=$(run_case "device-ui-smoke" "cd '$APP_DIR' && npm run test:device-ui" "$UI_LOG")
  INST_CODE=$(run_case "device-ui-instrumentation" "cd '$APP_DIR' && npm run test:device-ui:instrumentation" "$INST_LOG")
fi
ROBUSTNESS_CODE=0
if [[ "$RUN_SUPPLEMENTAL_ROBUSTNESS" == "1" ]]; then
  ROBUSTNESS_CODE=$(run_case "device-robustness-supplemental" "cd '$APP_DIR' && npm run test:device:robustness" "$ROBUSTNESS_LOG")
fi

UI_STATUS="SKIPPED"
INST_STATUS="SKIPPED"
ROBUSTNESS_STATUS="NOT_RUN"
if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
  UI_STATUS="FAIL"
  INST_STATUS="FAIL"
  [[ "$UI_CODE" -eq 0 ]] && UI_STATUS="PASS"
  [[ "$INST_CODE" -eq 0 ]] && INST_STATUS="PASS"
fi
if [[ "$RUN_SUPPLEMENTAL_ROBUSTNESS" == "1" ]]; then
  ROBUSTNESS_STATUS="FAIL"
  [[ "$ROBUSTNESS_CODE" -eq 0 ]] && ROBUSTNESS_STATUS="PASS"
fi

OVERALL="FAIL"
if [[ "$RUN_UI_AUTOMATION" != "1" ]]; then
  OVERALL="PASS"
elif [[ "$UI_STATUS" == "PASS" && "$INST_STATUS" == "PASS" ]]; then
  OVERALL="PASS"
fi

cat >"$JSON_OUT" <<EOF
{
  "timestampUtc": "$TIMESTAMP",
  "overall": "$OVERALL",
  "deviceSerials": [$(printf '"%s",' $DEVICE_SERIALS | sed 's/,$//')],
  "runs": [
    {
      "id": "device-ui-smoke",
      "status": "$UI_STATUS",
      "exitCode": $UI_CODE,
      "log": "$UI_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/summary.txt",
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/qa-mapping.json"
      ]
    },
    {
      "id": "device-ui-instrumentation",
      "status": "$INST_STATUS",
      "exitCode": $INST_CODE,
      "log": "$INST_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/androidTests/connected/debug/index.html"
      ]
    }
  ],
  "supplemental": {
    "id": "device-robustness-supplemental",
    "status": "$ROBUSTNESS_STATUS",
    "exitCode": $ROBUSTNESS_CODE,
    "log": "$ROBUSTNESS_LOG",
    "nonBlocking": true,
    "artifacts": [
      "$ROOT_DIR/app/android/app/build/reports/device-robustness/device-robustness-bundle.txt",
      "$ROOT_DIR/app/android/app/build/reports/device-robustness/device-robustness-bundle.json"
    ]
  }
}
EOF

{
  echo "P0_DEBUG_BUNDLE=$OVERALL"
  echo "TIMESTAMP_UTC=$TIMESTAMP"
  echo "DEVICE_SERIALS=$(echo "$DEVICE_SERIALS" | tr '\n' ',' | sed 's/,$//')"
  if [[ "$RUN_UI_AUTOMATION" == "1" ]]; then
    echo "RUN_device-ui-smoke=$UI_STATUS (exit=$UI_CODE)"
    echo "RUN_device-ui-instrumentation=$INST_STATUS (exit=$INST_CODE)"
  else
    echo "RUN_device-ui-smoke=$UI_STATUS (set RUN_UI_AUTOMATION=1 to enable)"
    echo "RUN_device-ui-instrumentation=$INST_STATUS (set RUN_UI_AUTOMATION=1 to enable)"
  fi
  if [[ "$RUN_SUPPLEMENTAL_ROBUSTNESS" == "1" ]]; then
    echo "SUPPLEMENT_device-robustness=$ROBUSTNESS_STATUS (exit=$ROBUSTNESS_CODE, non-blocking)"
  else
    echo "SUPPLEMENT_device-robustness=$ROBUSTNESS_STATUS (set RUN_SUPPLEMENTAL_ROBUSTNESS=1 to enable)"
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
