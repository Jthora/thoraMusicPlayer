"""Recover Spotify playlist rosters without an account or API key.

Public playlists stay viewable after a subscription ends. For each known playlist ID this reads
  - https://open.spotify.com/embed/playlist/<id>  -> track list (title, artists, duration, track URI),
    first 100 tracks only
  - https://open.spotify.com/playlist/<id>        -> "N items", to tell when the embed cut a list short
and writes one Exportify-style CSV per playlist, which `playlists --input <dir>` matches against the
library by artist/title/duration. Requests are spaced out; nothing is ever sent to Spotify but GETs.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
CSV_HEADER = ["Track URI", "Track Name", "Artist Name(s)", "Album Name", "Duration (ms)"]
EMBED_LIMIT = 100


class RosterError(Exception):
    pass


# The playlist page only includes its server-rendered meta tags ("N items") for some user agents.
PAGE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"


def _get(url: str, timeout: float = 30, user_agent: str = USER_AGENT) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        raise RosterError(f"HTTP {error.code}") from None
    except urllib.error.URLError as error:
        raise RosterError(f"network: {error.reason}") from None


def parse_embed(page: str) -> tuple[str, str, list[dict]]:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not match:
        raise RosterError("embed page has no data (playlist removed or made private?)")
    data = json.loads(match.group(1))
    entity = (((data.get("props") or {}).get("pageProps") or {}).get("state") or {}).get("data", {}).get("entity")
    if not entity or entity.get("type") != "playlist":
        raise RosterError("embed page has no playlist")
    tracks = [
        {
            "uri": item.get("uri", ""),
            "title": item.get("title", ""),
            "artists": item.get("subtitle", ""),
            "duration_ms": int(item.get("duration") or 0),
        }
        for item in entity.get("trackList") or []
        if item.get("title")
    ]
    return entity.get("name") or "", entity.get("subtitle") or "", tracks


def parse_total(page: str) -> int | None:
    match = re.search(r'<meta property="og:description" content="([^"]*)"', page)
    if not match:
        return None
    items = re.search(r"([\d,]+)\s+(items|songs|tracks)", html.unescape(match.group(1)))
    return int(items.group(1).replace(",", "")) if items else None


def _safe_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return cleaned[:120] or "playlist"


def fetch_rosters(rosters_json: Path, out_dir: Path, delay: float = 1.5, only: list[str] | None = None) -> dict:
    entries = json.loads(rosters_json.read_text(encoding="utf-8"))["playlists"]
    wanted = {}
    for entry in entries:
        playlist_id = entry.get("spotify_id")
        if playlist_id and playlist_id not in wanted and (not only or playlist_id in only or entry["name"] in only):
            wanted[playlist_id] = entry["name"]
    out_dir.mkdir(parents=True, exist_ok=True)
    used: set[str] = set()
    results = []
    print(f"[spotify] fetching {len(wanted)} public playlist roster(s) -> {out_dir}")
    for number, (playlist_id, known_name) in enumerate(wanted.items(), start=1):
        row = {"id": playlist_id, "known_name": known_name}
        try:
            name, owner, tracks = parse_embed(_get(f"https://open.spotify.com/embed/playlist/{playlist_id}"))
            time.sleep(delay)
            try:
                total = parse_total(_get(f"https://open.spotify.com/playlist/{playlist_id}", user_agent=PAGE_USER_AGENT))
            except RosterError:
                total = None
            name = name or known_name
            base = _safe_name(name)
            filename = base
            counter = 2
            while filename.casefold() in used:
                filename = f"{base} ({counter})"
                counter += 1
            used.add(filename.casefold())
            with (out_dir / f"{filename}.csv").open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(CSV_HEADER)
                for track in tracks:
                    writer.writerow([track["uri"], track["title"], track["artists"], "", track["duration_ms"]])
            missing = (total - len(tracks)) if total is not None and total > len(tracks) else 0
            row.update(status="ok", name=name, owner=owner, file=f"{filename}.csv", tracks=len(tracks),
                       total=total, missing_beyond_embed=missing)
            note = f"  (+{missing} not shown by the embed)" if missing else ""
            print(f"  [{number}/{len(wanted)}] {name}: {len(tracks)} tracks{note}")
        except RosterError as error:
            row.update(status="unavailable", error=str(error))
            print(f"  [{number}/{len(wanted)}] {known_name}: UNAVAILABLE ({error})", file=sys.stderr)
        results.append(row)
        time.sleep(delay)
    summary = {
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "unavailable": sum(1 for r in results if r["status"] != "ok"),
        "tracks": sum(r.get("tracks", 0) for r in results),
        "cut_short": [{"name": r["name"], "missing": r["missing_beyond_embed"]} for r in results if r.get("missing_beyond_embed")],
        "playlists": results,
    }
    (out_dir.parent / "fetch-summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"[spotify] {summary['ok']} recovered ({summary['tracks']} tracks), {summary['unavailable']} unavailable, "
          f"{len(summary['cut_short'])} longer than the embed's {EMBED_LIMIT}-track view")
    return summary
