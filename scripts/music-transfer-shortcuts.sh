#!/usr/bin/env bash
set -euo pipefail

export MUSIC_SRC_ROOT="/home/jono/workspace/github/spotifyBackerUpper"
export MUSIC_SRC_OUTPUT="$MUSIC_SRC_ROOT/output"
export MUSIC_SRC_PLAYLISTS="$MUSIC_SRC_ROOT/output/playlists"
export MUSIC_SRC_LIKED="$MUSIC_SRC_ROOT/liked_songs_17jul2025"
export MUSIC_SRC_PL_DL="$MUSIC_SRC_ROOT/playlist_downloads"
export MUSIC_SRC_DOWNLOADS="$MUSIC_SRC_ROOT/downloads"
export MUSIC_DST_ROOT="/sdcard/Music/spotifyBackerUpper"

cat <<EOF
Shortcuts loaded.

Source:
  MUSIC_SRC_ROOT=$MUSIC_SRC_ROOT
  MUSIC_SRC_OUTPUT=$MUSIC_SRC_OUTPUT
  MUSIC_SRC_PLAYLISTS=$MUSIC_SRC_PLAYLISTS
  MUSIC_SRC_LIKED=$MUSIC_SRC_LIKED
  MUSIC_SRC_PL_DL=$MUSIC_SRC_PL_DL
  MUSIC_SRC_DOWNLOADS=$MUSIC_SRC_DOWNLOADS

Destination:
  MUSIC_DST_ROOT=$MUSIC_DST_ROOT

Suggested staged transfer:
  adb shell mkdir -p "$MUSIC_DST_ROOT"
  adb push "$MUSIC_SRC_OUTPUT" "$MUSIC_DST_ROOT/output"
  adb push "$MUSIC_SRC_PLAYLISTS" "$MUSIC_DST_ROOT/playlists"
  adb push "$MUSIC_SRC_LIKED" "$MUSIC_DST_ROOT/liked_songs_17jul2025"
  adb push "$MUSIC_SRC_PL_DL" "$MUSIC_DST_ROOT/playlist_downloads"
  adb push "$MUSIC_SRC_DOWNLOADS" "$MUSIC_DST_ROOT/downloads"
EOF
