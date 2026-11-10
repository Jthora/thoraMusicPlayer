#!/usr/bin/env bash
# Regenerate Tho'ra's adaptive launcher icon layers from a square logo (ffmpeg only).
#
#   scripts/build/make-launcher-icons.sh [logo.png] [percent]
#
# - logo.png: square source image, default FusionGirl_Icon_x1024.png at the repo root
# - percent:  logo size as a share of the 108 dp adaptive canvas (default 66). 66 fills the
#             Redmi A3 launcher's rounded mask without showing the logo's own frame, and keeps the
#             blade tips inside a circular mask too. Above ~70 the tips clip on circular masks.
#
# Writes mipmap-*/ic_launcher_foreground.png (the logo) and ic_launcher_monochrome.png (a white
# silhouette from the logo's brightness, used by Android's themed icons). The background color
# is res/values/ic_launcher_background.xml; the layers are combined in
# res/mipmap-anydpi-v26/ic_launcher*.xml.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SRC="${1:-$REPO/FusionGirl_Icon_x1024.png}"
PERCENT="${2:-66}"
RES="$REPO/app/android/app/src/main/res"
FF="$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)"

MONO="format=rgba,geq=r=255:g=255:b=255:a='clip((0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y)-60)*255/140,0,255)*alpha(X,Y)/255'"
for pair in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  density=${pair%:*}
  canvas=${pair#*:}
  size=$(( canvas * PERCENT / 100 ))
  size=$(( size - size % 2 ))
  pad="pad=${canvas}:${canvas}:(ow-iw)/2:(oh-ih)/2:color=0x00000000"
  "$FF" -v error -y -i "$SRC" -vf "scale=${size}:${size}:flags=lanczos,format=rgba,${pad}" \
    -frames:v 1 "$RES/mipmap-$density/ic_launcher_foreground.png"
  "$FF" -v error -y -i "$SRC" -vf "${MONO},scale=${size}:${size}:flags=lanczos,${pad}" \
    -frames:v 1 "$RES/mipmap-$density/ic_launcher_monochrome.png"
  echo "$density: ${canvas}px canvas, logo ${size}px"
done
