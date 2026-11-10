"""SQLite state: inventory, transfer plan, push records, playlist decisions."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ns INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ext TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    album_artist TEXT,
    album TEXT,
    track_no INTEGER,
    disc_no INTEGER,
    year INTEGER,
    genre TEXT,
    isrc TEXT,
    duration_ms INTEGER,
    codec TEXT,
    sample_rate INTEGER,
    bits_per_sample INTEGER,
    bitrate INTEGER,
    quick_hash TEXT,
    full_hash TEXT,
    tag_error TEXT,
    last_seen_run INTEGER NOT NULL,
    UNIQUE (source, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_quick_hash ON files(size, quick_hash);

CREATE TABLE IF NOT EXISTS plan (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    dest_rel TEXT,
    action TEXT NOT NULL,
    duplicate_of INTEGER,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_action ON plan(action);

CREATE TABLE IF NOT EXISTS pushes (
    dest_rel TEXT PRIMARY KEY,
    file_id INTEGER,
    src_size INTEGER NOT NULL,
    src_mtime_ns INTEGER NOT NULL,
    device_size INTEGER NOT NULL,
    pushed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    command TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    summary_json TEXT
);

-- Which library file each playlist entry matched in the last `playlists` run (drives [selection]).
CREATE TABLE IF NOT EXISTS playlist_matches (
    playlist_key TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    file_id INTEGER NOT NULL,
    PRIMARY KEY (playlist_key, entry_key)
);

CREATE TABLE IF NOT EXISTS playlist_decisions (
    playlist_key TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    chosen_file_id INTEGER,
    decided_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_key, entry_key)
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


def start_run(conn: sqlite3.Connection, command: str) -> int:
    cursor = conn.execute(
        "INSERT INTO runs(command, started_at) VALUES (?, ?)", (command, int(time.time()))
    )
    conn.commit()
    return int(cursor.lastrowid)


def finish_run(conn: sqlite3.Connection, run_id: int, summary: dict) -> None:
    conn.execute(
        "UPDATE runs SET finished_at = ?, summary_json = ? WHERE id = ?",
        (int(time.time()), json.dumps(summary, sort_keys=True), run_id),
    )
    conn.commit()


def latest_run_id(conn: sqlite3.Connection, command: str) -> int | None:
    row = conn.execute(
        "SELECT id FROM runs WHERE command = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1",
        (command,),
    ).fetchone()
    return int(row["id"]) if row else None
