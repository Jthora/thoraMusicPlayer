#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
REPORT_DIR="$ROOT_DIR/app/android/app/build/reports/device-robustness"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

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

SMOKE_LOG="$REPORT_DIR/device-ui-smoke.log"
OEM_LOG="$REPORT_DIR/stage41-oem.log"
PERM_LOG="$REPORT_DIR/permission-revocation.log"
JSON_OUT="$REPORT_DIR/device-robustness-bundle.json"
TXT_OUT="$REPORT_DIR/device-robustness-bundle.txt"

SMOKE_CODE=$(run_case "cd '$APP_DIR' && npm run test:device-ui" "$SMOKE_LOG")
OEM_CODE=$(run_case "cd '$APP_DIR' && npm run test:stage4.1:oem" "$OEM_LOG")
PERM_CODE=$(run_case "cd '$APP_DIR' && npm run test:failure:permission-revocation" "$PERM_LOG")

SMOKE_STATUS="FAIL"
OEM_STATUS="FAIL"
PERM_STATUS="FAIL"
[[ "$SMOKE_CODE" -eq 0 ]] && SMOKE_STATUS="PASS"
[[ "$OEM_CODE" -eq 0 ]] && OEM_STATUS="PASS"
[[ "$PERM_CODE" -eq 0 ]] && PERM_STATUS="PASS"

OVERALL="FAIL"
if [[ "$SMOKE_STATUS" == "PASS" && "$OEM_STATUS" == "PASS" && "$PERM_STATUS" == "PASS" ]]; then
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
      "status": "$SMOKE_STATUS",
      "exitCode": $SMOKE_CODE,
      "log": "$SMOKE_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/summary.txt",
        "$ROOT_DIR/app/android/app/build/reports/device-ui-smoke/qa-mapping.json"
      ]
    },
    {
      "id": "stage4.1-oem-hardening",
      "status": "$OEM_STATUS",
      "exitCode": $OEM_CODE,
      "log": "$OEM_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/stage4-1-oem-hardening/summary.txt",
        "$ROOT_DIR/app/android/app/build/reports/stage4-1-oem-hardening/qa-mapping.json"
      ]
    },
    {
      "id": "permission-revocation-injection",
      "status": "$PERM_STATUS",
      "exitCode": $PERM_CODE,
      "log": "$PERM_LOG",
      "artifacts": [
        "$ROOT_DIR/app/android/app/build/reports/permission-revocation-injection/summary.txt",
        "$ROOT_DIR/app/android/app/build/reports/permission-revocation-injection/result.json"
      ]
    }
  ]
}
EOF

{
  echo "DEVICE_ROBUSTNESS_BUNDLE=$OVERALL"
  echo "TIMESTAMP_UTC=$TIMESTAMP"
  echo "DEVICE_SERIALS=$(echo "$DEVICE_SERIALS" | tr '\n' ',' | sed 's/,$//')"
  echo "RUN_device-ui-smoke=$SMOKE_STATUS (exit=$SMOKE_CODE)"
  echo "RUN_stage4.1-oem-hardening=$OEM_STATUS (exit=$OEM_CODE)"
  echo "RUN_permission-revocation-injection=$PERM_STATUS (exit=$PERM_CODE)"
  echo "JSON=$JSON_OUT"
} >"$TXT_OUT"

cat "$TXT_OUT"

if [[ "$OVERALL" != "PASS" ]]; then
  exit 1
fi
