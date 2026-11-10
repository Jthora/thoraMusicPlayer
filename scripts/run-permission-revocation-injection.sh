#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/app/android"
ARTIFACT_DIR="$ROOT_DIR/app/android/app/build/reports/permission-revocation-injection"
PACKAGE_NAME="com.thoraplayer"
ACTIVITY_NAME="com.thoraplayer/.MainActivity"

mkdir -p "$ARTIFACT_DIR"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found in PATH"
  exit 1
fi

DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {count++} END {print count+0}')"
if [[ "$DEVICE_COUNT" -lt 1 ]]; then
  echo "No connected Android device found"
  exit 1
fi

cd "$ANDROID_DIR"
./gradlew :app:installRelease >/dev/null

export ARTIFACT_DIR
export PACKAGE_NAME
export ACTIVITY_NAME

python3 - <<'PY'
import json
import os
import subprocess
import time
import xml.etree.ElementTree as ET

ARTIFACT_DIR = os.environ['ARTIFACT_DIR']
PACKAGE_NAME = os.environ['PACKAGE_NAME']
ACTIVITY_NAME = os.environ['ACTIVITY_NAME']

DUMP_PATH = os.path.join(ARTIFACT_DIR, 'window_dump.xml')
SUMMARY_PATH = os.path.join(ARTIFACT_DIR, 'summary.txt')
JSON_PATH = os.path.join(ARTIFACT_DIR, 'result.json')


def sh(command: str) -> None:
    subprocess.run(command, shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def dump_window() -> ET.Element:
    sh('adb shell uiautomator dump /sdcard/window_dump.xml')
    sh(f'adb pull /sdcard/window_dump.xml {DUMP_PATH}')
    return ET.parse(DUMP_PATH).getroot()


def all_texts(root: ET.Element) -> list[str]:
    return [node.attrib.get('text', '') for node in root.iter('node') if node.attrib.get('text')]


def require_contains(target: str, retries: int = 12) -> None:
    for _ in range(retries):
        root = dump_window()
        if any(target in text for text in all_texts(root)):
            return
        time.sleep(1)
    raise RuntimeError(f'Missing expected UI text containing: {target}')


def relaunch() -> None:
    sh(f'adb shell am force-stop {PACKAGE_NAME}')
    sh(f'adb shell am start -n {ACTIVITY_NAME}')
    time.sleep(4)


# Baseline: ensure permission granted and app is healthy.
sh(f'adb shell pm grant {PACKAGE_NAME} android.permission.READ_MEDIA_AUDIO')
relaunch()
require_contains("Tho'ra Player")
require_contains('READ_MEDIA_AUDIO: Granted')

# Failure injection: revoke permission and confirm app remains responsive with not-granted state.
sh(f'adb shell pm revoke {PACKAGE_NAME} android.permission.READ_MEDIA_AUDIO')
relaunch()
require_contains("Tho'ra Player")
require_contains('READ_MEDIA_AUDIO: Not granted')

# Recovery: grant permission again and confirm status returns to granted.
sh(f'adb shell pm grant {PACKAGE_NAME} android.permission.READ_MEDIA_AUDIO')
relaunch()
require_contains('READ_MEDIA_AUDIO: Granted')

with open(SUMMARY_PATH, 'w', encoding='utf-8') as output:
    output.write('PERMISSION_REVOCATION_INJECTION=PASS\n')
    output.write('ASSERTIONS=baseline-granted,revoke-not-granted,liveness-after-revoke,regrant-recovery\n')

with open(JSON_PATH, 'w', encoding='utf-8') as output:
    json.dump(
        {
            'automation': 'permission-revocation-injection',
            'result': 'PASS',
            'artifact': SUMMARY_PATH,
            'assertions': [
                'Baseline app launch with READ_MEDIA_AUDIO granted',
                'Permission revoked and app relaunch remains responsive',
                'READ_MEDIA_AUDIO status reflects Not granted after revoke',
                'Permission re-grant recovers READ_MEDIA_AUDIO status to Granted',
            ],
        },
        output,
        indent=2,
    )
PY

echo "Permission revocation injection report: $ARTIFACT_DIR/summary.txt"
echo "Permission revocation injection json: $ARTIFACT_DIR/result.json"
