# thora-transfer

This tool copies music from the LAN-only network drive to the Redmi A3. The path is NAS → Mac mini → phone over USB, and it repairs old playlists along the way.

- **Read-only on the NAS.** It never opens a NAS file for writing.
- **Nothing staged on the Mac.** Files stream from the mounted share straight to the phone; the Mac has about 9 GB free.
- **Resumable and incremental.** Re-running `push` only sends what's missing or changed. Every file's size is checked on the phone after pushing.
- **Never deletes by surprise.** Deleting only happens through `prune --apply`, and only under `phone_root`.

Everything it writes on the phone lives under `phone_root` (default `/sdcard/Music/Thora`). That covers `<source label>/…` for music and `_playlists/` for repaired playlists.

## One-time setup (do this while the Mac has internet)

```sh
scripts/transfer/setup.sh          # venv + mutagen, creates thora-transfer.toml from the example
scripts/thora-transfer doctor      # python, mutagen, ffprobe, adb + phone, free space
```

`thora-transfer.toml` is gitignored. Edit `[[sources]]` once you know the share's mount path.

## Connection day

### 1. Bring up the wired LAN (no internet on it)
1. Plug the Ethernet cable into the Mac mini. That's `en0` ("Ethernet").
2. Open System Settings → Network → Ethernet → Details → TCP/IP:
   - If the LAN hands out addresses (DHCP), leave it on DHCP.
   - Otherwise choose **Configure IPv4: Manually**, give the Mac an address in the NAS's subnet, and **leave Router blank**.

   A blank router keeps the no-internet cable from becoming the default route, so Wi-Fi internet keeps working.
3. **Subnet collision:** Wi-Fi is on `192.168.1.0/24`. If the wired LAN also uses `192.168.1.x`, turn Wi-Fi off for the transfer. Otherwise traffic to the NAS may go out the wrong interface.
4. If both use DHCP and internet breaks, put Wi-Fi first in the service order: Network → ⋯ → Set Service Order.

### 2. Find and mount the share (read-only)
```sh
dns-sd -B _smb._tcp local.          # Ctrl-C after a few seconds; lists SMB hosts that advertise
arp -a -i en0                       # anything answering on the wired LAN
smbutil view -g //HOST              # list shares on a host (prompts for credentials)
mkdir -p ~/NAS/SHARE && mount_smbfs -o rdonly //USER@HOST/SHARE ~/NAS/SHARE
```
Finder (Go → Connect to Server → `smb://HOST/SHARE`) also works, and it stores the password in Keychain. Credentials never go in the config.

Then point `[[sources]]` in `thora-transfer.toml` at folders inside the mount, and check it:
```sh
scripts/thora-transfer nas-check    # mount type, read-only flag, readable, read throughput
```

### 3. Transfer
```sh
scripts/thora-transfer inventory           # walk + tags into ~/ThoraTransfer/state.db (re-runs are incremental)
scripts/thora-transfer plan                # phone paths, duplicates, unsupported formats, capacity check
scripts/thora-transfer push --dry-run      # what would be sent
scripts/thora-transfer push                # send, verify sizes, rescan MediaStore
scripts/thora-transfer report              # NAS vs plan vs phone vs MediaStore counts
```

- **If `plan` says it doesn't fit** (phone has about 97 GB free, minus `headroom_gb`):
  - push one source at a time with `push --source LABEL`, or cap a run with `push --max-gb 40`
  - narrow a source with `exclude` globs
  - set `transcode = "opus192"` on a lossless-heavy source. Only lossless files are converted, one at a time, in a temp file that is deleted after each push.
- **Unsupported formats** (ape, wv, dsf/dff, wma, aiff …) are listed in the report and never pushed.
- **Interrupted?** Re-run `push`. Partial files are detected by size and re-sent.
- **Removed or renamed things on the NAS?** `prune` lists phone files that aren't in the current plan. `prune --apply` deletes them.

### 4. Playlists
```sh
scripts/thora-transfer playlists                       # repair every playlist found in the sources
scripts/thora-transfer playlists --input ~/old-lists   # plus extra files/folders (.txt = "Artist - Title" lines)
scripts/thora-transfer playlists --apply-review ~/ThoraTransfer/reports/<ts>/playlists/review.csv
scripts/thora-transfer playlists --push                # copy the .m3u8 files to <phone_root>/_playlists
```

- **Formats read:** m3u/m3u8 (with `#EXTINF`), pls, xspf, wpl, CSV (Spotify/Exportify-style), and Apple Music/iTunes `Library.xml`.
- **Matching:** entries are matched by the ladder in `docs/production/playlist-matching-spec.md`: exact → moved folders → format change → renamed file → tags/ISRC → fuzzy (review only).
- **Review:** ambiguous rows go to `review.csv`. Fill the `choice` column with `1`/`2`/`3`, `skip`, or a phone path like `library/Artist/Album/01 Song.flac`, then run `--apply-review`. Decisions are remembered across runs.
- **Old absolute paths** (e.g. the Linux box's `/home/jono/workspace/github/spotifyBackerUpper/`) are mapped with `[[playlists.remap]]`.
- **Output:** canonical UTF-8 `.m3u8` files with paths relative to `_playlists/`. Unmatched entries stay in the file as `#THORA-REVIEW:` / `#THORA-UNRESOLVED:` / `#THORA-SKIPPED:` comments, so nothing is silently dropped.

`pull-playlists` copies playlists exported by the app (`_playlists/exported/`) back to the Mac.

## Tests

```sh
cd scripts/transfer && .venv/bin/python -m unittest discover -s tests -t .
.venv/bin/python tests/make_fixture.py /tmp/fake-nas   # tagged audio + broken playlists for an end-to-end run
```

For an end-to-end run against the phone, use a config with `phone_root = "/sdcard/Music/Thora-test"`. Afterwards run `adb shell rm -rf /sdcard/Music/Thora-test` and rescan.
