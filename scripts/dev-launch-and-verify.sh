#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
APP_ID="com.thoraplayer"
ACTIVITY="$APP_ID/.MainActivity"
PORT="8081"
MAX_LAUNCH_ATTEMPTS=2

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found in PATH" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found in PATH" >&2
  exit 1
fi

if [[ -z "$(adb devices | awk 'NR>1 && $2=="device" {print $1}' | head -1)" ]]; then
  echo "No connected Android device found" >&2
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
  echo "Starting Metro on port ${PORT}..."
  (
    cd "$APP_DIR"
    nohup npm run start -- --port "$PORT" --reset-cache > /tmp/android-music-player-metro.log 2>&1 &
  )

  for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
      break
    fi
    sleep 1
  done
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
  echo "Metro failed to become ready. Check /tmp/android-music-player-metro.log" >&2
  exit 1
fi

adb reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null
for attempt in $(seq 1 "$MAX_LAUNCH_ATTEMPTS"); do
  adb shell am force-stop "$APP_ID"
  adb shell am start -n "$ACTIVITY" >/dev/null
  sleep 5

  if adb logcat -d | tail -300 | grep -q "Unable to load script"; then
    echo "Detected bundle-load failure on launch attempt ${attempt}."
    if [[ "$attempt" -lt "$MAX_LAUNCH_ATTEMPTS" ]]; then
      echo "Restarting Metro and retrying launch..."
      pkill -f "react-native start -- --port ${PORT}" || true
      (
        cd "$APP_DIR"
        nohup npm run start -- --port "$PORT" --reset-cache > /tmp/android-music-player-metro.log 2>&1 &
      )
      for _ in $(seq 1 45); do
        if curl -fsS "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
          break
        fi
        sleep 1
      done
      adb reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null
      continue
    fi
  fi

  break
done

adb shell uiautomator dump /sdcard/window_dump.xml >/dev/null
adb pull /sdcard/window_dump.xml /tmp/amp_dev_launch_verify.xml >/dev/null

python3 - <<'PY'
import re
xml = open('/tmp/amp_dev_launch_verify.xml', encoding='utf-8').read()
texts = set(re.findall(r'text="([^"]+)"', xml))
print('APP_RENDERED_OK=' + str("Tho'ra Player" in texts or 'HOME' in texts))
print('HAS_RED_BOX_HINT=' + str('Unable to load script' in xml or 'JSBundleLoader.kt:33' in xml))
PY

echo "Dev launch complete. Metro status: running on ${PORT}"