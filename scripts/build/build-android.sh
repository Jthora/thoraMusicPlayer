#!/usr/bin/env bash
# Low-memory Android build for this Mac mini (8 GB RAM; swap lives on a nearly full disk).
#
#   scripts/build/build-android.sh :app:assembleRelease
#
# - single-use Gradle JVM (nothing lingers afterwards), Kotlin compiled in-process (no second JVM),
#   2 Gradle workers, at most 2 parallel C++ compiles per module (lowmem.init.gradle + jobpool.cmake),
#   release lint skipped
# - watchdog: kills the build if free space on the data volume drops below MIN_FREE_MB (default 1200),
#   so a runaway build can't fill the disk
set -u
MIN_FREE_MB=${MIN_FREE_MB:-1200}
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$JAVA_HOME/bin:$PATH"
cd "$REPO/app/android" || exit 2

free_mb() { df -m /System/Volumes/Data | awk 'NR==2 {print $4}'; }
# Kill a process and all its descendants (gradlew -> client JVM -> single-use daemon -> workers),
# and nothing else: other projects' Gradle processes are left alone.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}
echo "[build] start free=$(free_mb)MB swap: $(sysctl -n vm.swapusage)"
if (( $(free_mb) < MIN_FREE_MB + 2000 )); then
  echo "[build] refusing to start: need at least $((MIN_FREE_MB + 2000)) MB free"
  exit 98
fi

./gradlew --no-daemon --console=plain \
  -I "$HERE/lowmem.init.gradle" \
  -Pthora.jobpool="$HERE/jobpool.cmake" \
  -Pkotlin.compiler.execution.strategy=in-process \
  -Dorg.gradle.workers.max=2 \
  "$@" &
GRADLE_PID=$!

min_seen=$(free_mb)
while kill -0 "$GRADLE_PID" 2>/dev/null; do
  f=$(free_mb)
  (( f < min_seen )) && min_seen=$f
  if (( f < MIN_FREE_MB )); then
    echo "[build] ABORT: ${f} MB free < ${MIN_FREE_MB} MB; stopping Gradle"
    kill_tree "$GRADLE_PID"
    wait "$GRADLE_PID" 2>/dev/null
    echo "[build] min free ${min_seen} MB"
    exit 99
  fi
  perl -e 'select(undef, undef, undef, 3)'
done
wait "$GRADLE_PID"
rc=$?
echo "[build] exit=$rc min free=${min_seen}MB end free=$(free_mb)MB swap: $(sysctl -n vm.swapusage)"
exit $rc
