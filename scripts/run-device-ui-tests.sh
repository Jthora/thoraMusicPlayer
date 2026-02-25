#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/app/android"
APP_DIR="$ROOT_DIR/app"
METRO_PID=""

cleanup() {
  if [[ -n "$METRO_PID" ]] && kill -0 "$METRO_PID" >/dev/null 2>&1; then
    kill "$METRO_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

cd "$APP_DIR"

npx react-native start --port 8081 >/tmp/android-music-player-metro.log 2>&1 &
METRO_PID="$!"

METRO_READY=0
for _ in $(seq 1 45); do
  if ! kill -0 "$METRO_PID" >/dev/null 2>&1; then
    echo "Metro exited before becoming ready"
    tail -n 40 /tmp/android-music-player-metro.log || true
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:8081/status" 2>/dev/null | grep -q "packager-status:running"; then
      METRO_READY=1
      break
    fi
  elif grep -q "Welcome to Metro\|Metro waiting on" /tmp/android-music-player-metro.log 2>/dev/null; then
    METRO_READY=1
    break
  fi

  sleep 1
done

if [[ "$METRO_READY" -ne 1 ]]; then
  echo "Metro did not become ready within timeout"
  tail -n 40 /tmp/android-music-player-metro.log || true
  exit 1
fi

adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true

cd "$ANDROID_DIR"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found in PATH"
  exit 1
fi

CONNECTED_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {count++} END {print count+0}')"
if [[ "$CONNECTED_COUNT" -lt 1 ]]; then
  echo "No connected Android device found"
  exit 1
fi

./gradlew :app:connectedDebugAndroidTest

echo "Instrumentation report: $ANDROID_DIR/app/build/reports/androidTests/connected/debug/index.html"
