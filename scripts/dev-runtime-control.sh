#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
APP_ID="com.androidmusicplayerapp"
ACTIVITY="$APP_ID/.MainActivity"
METRO_PORT="8081"
LOG_DIR="${1:-/tmp/android-music-player-runtime}"

mkdir -p "$LOG_DIR"
METRO_LOG="$LOG_DIR/metro.log"
RUNTIME_LOG="$LOG_DIR/runtime.log"
UI_DUMP_DEVICE="/sdcard/window_dump.xml"
UI_DUMP_LOCAL="$LOG_DIR/window_dump.xml"

printf '\n[1/6] Restarting Metro on port %s...\n' "$METRO_PORT"
pkill -f "react-native start --port $METRO_PORT" || true
(
  cd "$APP_DIR"
  nohup npm run start -- --port "$METRO_PORT" --reset-cache >"$METRO_LOG" 2>&1 &
)

for _ in $(seq 1 25); do
  if curl -fsS "http://127.0.0.1:$METRO_PORT/status" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

printf '[2/6] Ensuring adb reverse mapping...\n'
adb reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT"

printf '[3/6] Relaunching app...\n'
adb logcat -c
adb shell am force-stop "$APP_ID"
adb shell am start -n "$ACTIVITY" >/dev/null

APP_READY=0
for _ in $(seq 1 20); do
  adb shell uiautomator dump "$UI_DUMP_DEVICE" >/dev/null 2>&1 || true
  adb pull "$UI_DUMP_DEVICE" "$UI_DUMP_LOCAL" >/dev/null 2>&1 || true
  if grep -q "Tho'ra Music Player" "$UI_DUMP_LOCAL" 2>/dev/null; then
    APP_READY=1
    break
  fi
  sleep 1
done

if [[ "$APP_READY" -ne 1 ]]; then
  echo "Warning: UI did not report expected app title within timeout; continuing with diagnostics."
fi

printf '[4/6] Capturing process logs...\n'
APP_PID="$(adb shell pidof "$APP_ID" | tr -d '\r')"
if [[ -z "$APP_PID" ]]; then
  echo "Could not determine app PID"
  exit 1
fi
adb logcat --pid="$APP_PID" -d >"$RUNTIME_LOG"

printf '[5/6] Capturing UI hierarchy...\n'
adb shell uiautomator dump "$UI_DUMP_DEVICE" >/dev/null
adb pull "$UI_DUMP_DEVICE" "$UI_DUMP_LOCAL" >/dev/null

printf '[6/6] Runtime summary\n'
echo "--- fatal/js errors ---"
grep -Ei "FATAL EXCEPTION|AndroidRuntime|TypeError|ReferenceError|Unhandled JS Exception|Render Error" "$RUNTIME_LOG" || true

echo "--- metro/packager warnings ---"
grep -Ei "Packager|Unable to display loading message|ReactHost|SoftException" "$RUNTIME_LOG" | tail -80 || true

echo "--- ui error markers ---"
grep -Ei "Render Error|TypeError|ReferenceError|Unhandled JS Exception" "$UI_DUMP_LOCAL" || true

echo "\nArtifacts written to: $LOG_DIR"
echo "- Metro log: $METRO_LOG"
echo "- Runtime log: $RUNTIME_LOG"
echo "- UI dump: $UI_DUMP_LOCAL"
