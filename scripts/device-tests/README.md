# Tho'ra device tests

`thora_devicetest.py` tests the real app on the Redmi A3 over USB. It needs only Python 3 (stdlib), adb and ffmpeg. It doesn't need root or a debuggable build. It drives the app the way the outside world does:

- **System media keys** (`cmd media_session dispatch`). These take the same path as Bluetooth, the lock screen and the notification.
- **The UI**, through uiautomator.
- **Android's own records**: `dumpsys media_session`, `dumpsys meminfo`, process exit-info and logcat.
- **The app's diagnostics log** at `Android/data/com.thoraplayer/files/diagnostics/events.jsonl`.

While a run is going, the phone's music volume is 0. Volume and night mode are restored when the run ends.

```sh
cd scripts/device-tests
S=--serial=YXAECI79W8EQGE7X   # required whenever more than one device is connected

python3 thora_devicetest.py $S fixtures                 # 12 tagged 30 s tracks in /sdcard/Music/Thora-test; #05 is corrupt
python3 thora_devicetest.py $S functional --apk ../../app/android/app/build/outputs/apk/release/app-release.apk
python3 thora_devicetest.py $S soak --minutes 480       # e.g. overnight; screen off, repeat all
python3 thora_devicetest.py $S cleanup                  # remove the fixtures
```

`functional --only "seek,Doze"` runs only the checks whose names contain those words.

## What `functional` checks

1. In-place install of the APK.
2. Cold launch time.
3. Starting playback from All Songs.
4. The playback position advances.
5. Pause/resume keeps the position.
6. Fast-forward/rewind keys seek.
7. Next/previous keys change tracks.
8. A corrupt file is skipped, and the skip is logged.
9. Repeat-one loops.
10. Shuffle changes the play order.
11. The media notification shows the track and opens the app.
12. After the process is killed, a media-button "play" resumes the same track at the same position.
13. The UI shows the resumed track.
14. Playback continues in forced Doze with the screen off.
15. The process survives UI churn: background/foreground cycles, a night-mode toggle and memory trims.

## What `soak` checks

Every 30 s it samples the process id, playback state, track, PSS / Java / native heap and thread count. The soak fails if any of these happens:

- The process changes or dies.
- Fewer than 97 % of samples are playing.
- PSS grows faster than `--max-slope` MB/hour (default 6) after warm-up.
- Thread count grows by more than 8.
- Tracks stop changing.

## Reports

Each run writes `~/ThoraTransfer/devicetest/<timestamp>-<kind>/`. It contains:

- `summary.md` and `summary.json`
- `logcat.txt`
- `diagnostics.jsonl`
- `samples.csv` (soak only)

A run fails if any check fails, or if logcat shows a crash, an ANR or a death of the app's process.
