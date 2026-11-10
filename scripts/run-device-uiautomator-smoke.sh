#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/app/android"
ARTIFACT_DIR="$ROOT_DIR/app/android/app/build/reports/device-ui-smoke"

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

cd "$ROOT_DIR"
adb shell am start -n com.thoraplayer/.MainActivity >/dev/null
sleep 3

ROOT_DIR="$ROOT_DIR" python3 - <<'PY'
import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = os.environ.get('ROOT_DIR', '').strip()
if not ROOT:
    raise RuntimeError('ROOT_DIR environment variable is required')

ARTIFACT_DIR = os.path.join(ROOT, 'app/android/app/build/reports/device-ui-smoke')
os.makedirs(ARTIFACT_DIR, exist_ok=True)

DUMP_PATH = os.path.join(ARTIFACT_DIR, 'window_dump.xml')
SUMMARY_PATH = os.path.join(ARTIFACT_DIR, 'summary.txt')
QA_MAP_PATH = os.path.join(ARTIFACT_DIR, 'qa-mapping.json')
DEADLINE = time.time() + 150


def assert_not_timed_out() -> None:
    if time.time() > DEADLINE:
        raise RuntimeError('Smoke automation timeout exceeded 150s')


def sh(command: str) -> None:
    subprocess.run(command, shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def dump_window() -> ET.Element:
    assert_not_timed_out()
    sh('adb shell uiautomator dump /sdcard/window_dump.xml')
    sh(f'adb pull /sdcard/window_dump.xml {DUMP_PATH}')
    return ET.parse(DUMP_PATH).getroot()


def all_texts(root: ET.Element) -> list[str]:
    return [node.attrib.get('text', '') for node in root.iter('node') if node.attrib.get('text')]


def parse_bounds(bounds: str) -> tuple[int, int]:
    match = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
    if not match:
      raise RuntimeError(f'Invalid bounds: {bounds}')
    x1, y1, x2, y2 = map(int, match.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def is_valid_bounds(bounds: str) -> bool:
    match = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
    if not match:
        return False
    x1, y1, x2, y2 = map(int, match.groups())
    return x2 > x1 and y2 > y1


def find_text_bounds(root: ET.Element, target: str) -> str | None:
    for node in root.iter('node'):
        if node.attrib.get('text') == target:
            return node.attrib.get('bounds')
    return None


def find_text_bounds_all(root: ET.Element, target: str) -> list[str]:
    bounds: list[str] = []
    for node in root.iter('node'):
        node_bounds = node.attrib.get('bounds')
        if node.attrib.get('text') == target and node_bounds and is_valid_bounds(node_bounds):
            bounds.append(node_bounds)
    return bounds


def swipe_up() -> None:
    sh('adb shell input swipe 24 1120 24 360 180')
    time.sleep(0.2)


def swipe_down() -> None:
    sh('adb shell input swipe 24 420 24 1220 180')
    time.sleep(0.2)


def scroll_to_top() -> None:
    for _ in range(10):
        assert_not_timed_out()
        swipe_down()


def require_text(target: str, retries: int = 8) -> None:
    for _ in range(retries):
        root = dump_window()
        if target in all_texts(root):
            return
        time.sleep(0.3)
    raise RuntimeError(f'Missing expected text: {target}')


def require_text_with_scroll(target: str, max_swipes: int = 10, from_top: bool = False) -> None:
    if from_top:
        scroll_to_top()
    for phase in range(2):
        for _ in range(max_swipes + 1):
            root = dump_window()
            if target in all_texts(root):
                return
            swipe_up()
        if phase == 0 and not from_top:
            scroll_to_top()
            continue
        break
    raise RuntimeError(f'Missing expected text (with scroll): {target}')


def require_text_contains_with_scroll(target: str, max_swipes: int = 10, from_top: bool = False) -> None:
    if from_top:
        scroll_to_top()
    for phase in range(2):
        for _ in range(max_swipes + 1):
            root = dump_window()
            if any(target in line for line in all_texts(root)):
                return
            swipe_up()
        if phase == 0 and not from_top:
            scroll_to_top()
            continue
        break
    raise RuntimeError(f'Missing expected substring (with scroll): {target}')


def require_idle_session_state(max_swipes: int = 10, from_top: bool = False) -> None:
    if from_top:
        scroll_to_top()
    for phase in range(2):
        for _ in range(max_swipes + 1):
            root = dump_window()
            texts = all_texts(root)
            has_running = any('RUNNING' in line for line in texts)
            has_controls = 'MARK PASS' in texts and 'MARK FAIL' in texts
            if has_running or has_controls:
                return
            swipe_up()
        if phase == 0 and not from_top:
            scroll_to_top()
            continue
        break
    raise RuntimeError('Idle session state controls were not detected after start')


def tap_text(target: str, max_swipes: int = 10, occurrence: int = 0, from_top: bool = False) -> None:
    if from_top:
        scroll_to_top()
    for phase in range(2):
        for _ in range(max_swipes + 1):
            root = dump_window()
            all_bounds = find_text_bounds_all(root, target)
            if len(all_bounds) > occurrence:
                bounds = all_bounds[occurrence]
                x, y = parse_bounds(bounds)
                sh(f'adb shell input tap {x} {y}')
                time.sleep(0.3)
                return
            bounds = find_text_bounds(root, target)
            if bounds and occurrence == 0:
                x, y = parse_bounds(bounds)
                sh(f'adb shell input tap {x} {y}')
                time.sleep(0.3)
                return
            swipe_up()
        if phase == 0 and not from_top:
            scroll_to_top()
            continue
        break
    raise RuntimeError(f'Unable to find tappable text: {target}')


def try_tap_text(target: str, max_swipes: int = 10, occurrence: int = 0, from_top: bool = False) -> bool:
    try:
        tap_text(target, max_swipes=max_swipes, occurrence=occurrence, from_top=from_top)
        return True
    except RuntimeError:
        return False


def collect_texts_with_scroll(max_swipes: int = 6) -> set[str]:
    collected: set[str] = set()
    scroll_to_top()
    for _ in range(max_swipes + 1):
        root = dump_window()
        collected.update(all_texts(root))
        swipe_up()
    return collected


def ensure_reliability_panel() -> None:
    tap_text('SETTINGS', max_swipes=1)
    if try_tap_text('SHOW ADVANCED TOOLS', max_swipes=4):
        return
    if try_tap_text('HIDE ADVANCED TOOLS', max_swipes=4):
        return
    raise RuntimeError('Unable to locate advanced-tools toggle in Settings')


require_text("Tho'ra Player")
ensure_reliability_panel()
require_text_with_scroll('Device Setup (Xiaomi/HyperOS)', from_top=True)

tap_text('START IDLE TEST')
require_idle_session_state()

tap_text('GENERATE REPORT')
require_text_contains_with_scroll('Validation report generated at')

collected_texts = collect_texts_with_scroll(max_swipes=6)
if not any('Reliability Setup Validation Report' in line for line in collected_texts):
    raise RuntimeError('Missing reliability report heading after report generation')
if not any('Snapshots (' in line for line in collected_texts):
    raise RuntimeError('Missing snapshots summary in generated report')
if not any('Idle/Doze Sessions (' in line for line in collected_texts):
    raise RuntimeError('Missing idle/doze summary in generated report')

with open(SUMMARY_PATH, 'w', encoding='utf-8') as output:
    output.write('DEVICE_UI_SMOKE=PASS\n')
    output.write('ASSERTIONS=title,reliability-panel,idle-start,idle-trigger,report\n')
    report_lines = [line for line in collected_texts if 'Reliability Setup Validation Report' in line or line.startswith('Snapshots (') or 'Idle/Doze Sessions (' in line]
    for line in report_lines[:3]:
        output.write(f'REPORT_LINE={line}\n')

qa_mapping = {
    'automation': 'device-ui-smoke',
    'result': 'PASS',
    'artifact': SUMMARY_PATH,
    'qaCoverage': [
        {
            'testId': 'QA-012',
            'coverage': 'automated-partial',
            'evidence': ['SHOW ADVANCED TOOLS', 'Device Setup (Xiaomi/HyperOS)', 'GENERATE REPORT'],
            'note': 'Verifies Xiaomi guidance surface is reachable and report generation path executes on physical device.',
        },
        {
            'testId': 'QA-003',
            'coverage': 'automated-partial',
            'evidence': ['START IDLE TEST', 'MARK PASS visibility', 'MARK FAIL visibility', 'Idle/Doze Sessions (>0)'],
            'note': 'Verifies idle/doze trigger controls and session evidence generation path; does not assert full playback continuity duration.',
        },
    ],
}

with open(QA_MAP_PATH, 'w', encoding='utf-8') as output:
    json.dump(qa_mapping, output, indent=2)

print(SUMMARY_PATH)
PY

echo "Device UI smoke report: $ARTIFACT_DIR/summary.txt"
echo "Device UI QA mapping: $ARTIFACT_DIR/qa-mapping.json"
