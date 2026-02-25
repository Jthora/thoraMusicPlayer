package com.androidmusicplayerapp

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.Locale

class LibraryIndexStore(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    private val reader = LibraryIndexReader(this)
    private val browseReader = LibraryBrowseReader(this)

    companion object {
        private const val DATABASE_NAME = "library_index.db"
        private const val DATABASE_VERSION = 4

        private const val TABLE_TRACKS = "indexed_tracks"
        private const val TABLE_SNAPSHOTS = "scan_snapshots"
        private const val TABLE_DIAGNOSTICS = "scan_diagnostics"
        private const val TABLE_TRACK_PLAY_STATS = "track_play_stats"
    }

    data class UpsertSummary(
        val scanned: Int,
        val inserted: Int,
        val updated: Int,
        val duplicate: Int,
        val skipped: Int,
        val removed: Int,
        val snapshotId: Long,
        val coverageMode: String
    )

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_TRACKS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canonical_uri TEXT NOT NULL UNIQUE,
                source_type TEXT NOT NULL,
                source_root TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                modified_sec INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                dedup_key TEXT NOT NULL,
                search_tokens TEXT NOT NULL,
                updated_at_sec INTEGER NOT NULL
            )
            """.trimIndent()
        )

        db.execSQL("CREATE INDEX IF NOT EXISTS idx_tracks_dedup_key ON $TABLE_TRACKS(dedup_key)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_tracks_search_tokens ON $TABLE_TRACKS(search_tokens)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_tracks_source_root ON $TABLE_TRACKS(source_root)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_SNAPSHOTS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                source_root TEXT NOT NULL,
                started_at_sec INTEGER NOT NULL,
                completed_at_sec INTEGER NOT NULL,
                scanned_count INTEGER NOT NULL,
                inserted_count INTEGER NOT NULL,
                updated_count INTEGER NOT NULL,
                duplicate_count INTEGER NOT NULL,
                skipped_count INTEGER NOT NULL,
                removed_count INTEGER NOT NULL DEFAULT 0,
                coverage_mode TEXT NOT NULL DEFAULT 'FULL'
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_DIAGNOSTICS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL,
                level TEXT NOT NULL,
                code TEXT NOT NULL,
                root TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at_sec INTEGER NOT NULL,
                FOREIGN KEY(snapshot_id) REFERENCES $TABLE_SNAPSHOTS(id)
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_diag_snapshot ON $TABLE_DIAGNOSTICS(snapshot_id)")

        createTrackPlayStatsTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            runCatching {
                db.execSQL("ALTER TABLE $TABLE_SNAPSHOTS ADD COLUMN removed_count INTEGER NOT NULL DEFAULT 0")
            }
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS $TABLE_DIAGNOSTICS (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_id INTEGER NOT NULL,
                    level TEXT NOT NULL,
                    code TEXT NOT NULL,
                    root TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at_sec INTEGER NOT NULL,
                    FOREIGN KEY(snapshot_id) REFERENCES $TABLE_SNAPSHOTS(id)
                )
                """.trimIndent()
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_diag_snapshot ON $TABLE_DIAGNOSTICS(snapshot_id)")
        }

        if (oldVersion < 3) {
            runCatching {
                db.execSQL("ALTER TABLE $TABLE_SNAPSHOTS ADD COLUMN coverage_mode TEXT NOT NULL DEFAULT 'FULL'")
            }
        }

        if (oldVersion < 4) {
            createTrackPlayStatsTable(db)
            backfillTrackPlayStatsForExistingTracks(db)
        }
    }

    private fun createTrackPlayStatsTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_TRACK_PLAY_STATS (
                uri TEXT PRIMARY KEY,
                play_count INTEGER NOT NULL DEFAULT 0,
                last_played_at_sec INTEGER NOT NULL DEFAULT 0,
                last_completed_at_sec INTEGER NOT NULL DEFAULT 0,
                skip_count INTEGER NOT NULL DEFAULT 0,
                updated_at_sec INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(uri) REFERENCES $TABLE_TRACKS(canonical_uri) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_track_play_stats_updated ON $TABLE_TRACK_PLAY_STATS(updated_at_sec)")
    }

    private fun backfillTrackPlayStatsForExistingTracks(db: SQLiteDatabase) {
        val now = nowSec()
        db.execSQL(
            """
            INSERT OR IGNORE INTO $TABLE_TRACK_PLAY_STATS (
                uri,
                play_count,
                last_played_at_sec,
                last_completed_at_sec,
                skip_count,
                updated_at_sec
            )
            SELECT
                canonical_uri,
                0,
                0,
                0,
                0,
                ?
            FROM $TABLE_TRACKS
            """.trimIndent(),
            arrayOf(now)
        )
    }

    fun upsertTracks(
        tracks: List<ReadableMap>,
        sourceType: String,
        sourceRoot: String
    ): UpsertSummary {
        return syncIncremental(
            tracks = tracks,
            sourceType = sourceType,
            sourceRoot = sourceRoot,
            diagnostics = emptyList(),
            allowRemoval = false,
            coverageMode = "PARTIAL"
        )
    }

    fun syncIncremental(
        tracks: List<ReadableMap>,
        sourceType: String,
        sourceRoot: String,
        diagnostics: List<SyncDiagnostic>,
        allowRemoval: Boolean,
        coverageMode: String
    ): UpsertSummary {
        val db = writableDatabase
        val startedAtSec = nowSec()
        val normalizedCoverage = coverageMode.uppercase(Locale.US).ifBlank { "PARTIAL" }

        var scanned = 0
        var inserted = 0
        var updated = 0
        var duplicate = 0
        var skipped = 0
        var removed = 0
        val seenUris = mutableSetOf<String>()

        db.beginTransaction()
        try {
            tracks.forEach { track ->
                scanned += 1

                val canonicalUri = track.getStringOrEmpty("uri")
                if (canonicalUri.isBlank()) {
                    skipped += 1
                    return@forEach
                }

                seenUris.add(canonicalUri)

                val normalized = normalizeTrack(track)
                val dedupKey = buildDedupKey(normalized)
                val searchTokens = buildSearchTokens(normalized)
                val updatedAtSec = nowSec()

                val existingByUri = queryTrackIdByCanonicalUri(db, canonicalUri)
                if (existingByUri != null) {
                    updateTrack(
                        db = db,
                        id = existingByUri,
                        canonicalUri = canonicalUri,
                        sourceType = sourceType,
                        sourceRoot = sourceRoot,
                        normalized = normalized,
                        dedupKey = dedupKey,
                        searchTokens = searchTokens,
                        updatedAtSec = updatedAtSec
                    )
                    updated += 1
                    return@forEach
                }

                val possibleDuplicateUri = queryCanonicalUriByDedupKey(db, dedupKey)
                if (possibleDuplicateUri != null && possibleDuplicateUri != canonicalUri) {
                    duplicate += 1
                    return@forEach
                }

                insertTrack(
                    db = db,
                    canonicalUri = canonicalUri,
                    sourceType = sourceType,
                    sourceRoot = sourceRoot,
                    normalized = normalized,
                    dedupKey = dedupKey,
                    searchTokens = searchTokens,
                    updatedAtSec = updatedAtSec
                )
                inserted += 1
            }

            removed = if (allowRemoval) {
                removeMissingTracksForSource(db, sourceType, sourceRoot, seenUris)
            } else {
                0
            }

            val snapshotId = insertSnapshot(
                db = db,
                sourceType = sourceType,
                sourceRoot = sourceRoot,
                startedAtSec = startedAtSec,
                completedAtSec = nowSec(),
                scanned = scanned,
                inserted = inserted,
                updated = updated,
                duplicate = duplicate,
                skipped = skipped,
                removed = removed,
                coverageMode = normalizedCoverage
            )

            insertDiagnostics(
                db = db,
                snapshotId = snapshotId,
                diagnostics = diagnostics + listOf(
                    SyncDiagnostic(
                        level = "INFO",
                        code = "SYNC_COVERAGE_MODE",
                        root = sourceRoot,
                        message = normalizedCoverage
                    ),
                    SyncDiagnostic(
                        level = "INFO",
                        code = if (allowRemoval) "DELTA_REMOVED" else "DELTA_REMOVAL_SKIPPED",
                        root = sourceRoot,
                        message = if (allowRemoval) {
                            "Removed $removed stale track(s)"
                        } else {
                            "Removal skipped because scan coverage is $normalizedCoverage"
                        }
                    )
                )
            )

            db.setTransactionSuccessful()
            return UpsertSummary(
                scanned = scanned,
                inserted = inserted,
                updated = updated,
                duplicate = duplicate,
                skipped = skipped,
                removed = removed,
                snapshotId = snapshotId,
                coverageMode = normalizedCoverage
            )
        } finally {
            db.endTransaction()
        }
    }

    fun getLatestSnapshotStatus(): SnapshotStatus? {
        return reader.getLatestSnapshotStatus()
    }

    fun getSnapshotDiagnostics(snapshotId: Long, limit: Int): WritableArray {
        return reader.getSnapshotDiagnostics(snapshotId, limit)
    }

    fun getIndexStats(): WritableMap {
        return reader.getIndexStats()
    }

    fun searchTracks(query: String, limit: Int): WritableArray {
        return reader.searchTracks(query, limit)
    }

    fun searchTracksByScope(query: String, scope: String, limit: Int): WritableArray {
        return reader.searchTracksByScope(query, scope, limit)
    }

    fun browseAlbums(limit: Int): WritableArray {
        return browseReader.browseAlbums(limit)
    }

    fun browseArtists(limit: Int): WritableArray {
        return browseReader.browseArtists(limit)
    }

    fun browseSongs(limit: Int): WritableArray {
        return browseReader.browseSongs(limit)
    }

    fun getRecentlyPlayedTracks(limit: Int): WritableArray {
        return browseReader.getRecentlyPlayedTracks(limit)
    }

    fun getPopularTracks(limit: Int, windowDays: Int?): WritableArray {
        return browseReader.getPopularTracks(limit, windowDays)
    }

    fun getRecentlyPlayedAlbums(limit: Int): WritableArray {
        return browseReader.getRecentlyPlayedAlbums(limit)
    }

    fun generateFolderQueue(folderPath: String, anchorUri: String?, sortMode: String, limit: Int): WritableMap {
        return reader.generateFolderQueue(folderPath, anchorUri, sortMode, limit)
    }

    fun resolvePlaylistCandidate(entry: String): String? {
        return reader.resolvePlaylistCandidate(entry)
    }

    fun resolvePlaylistRelativePath(relativePathOrSuffix: String): String? {
        return reader.resolvePlaylistRelativePath(relativePathOrSuffix)
    }

    fun resolvePlaylistFilename(fileName: String): String? {
        return reader.resolvePlaylistFilename(fileName)
    }

    fun recordPlaybackEvent(
        uri: String,
        eventType: String,
        positionMs: Long,
        durationMs: Long
    ): TrackPlayStats {
        require(uri.isNotBlank()) { "PLAYBACK_EVENT_URI_REQUIRED" }

        val normalizedEventType = normalizePlaybackEventType(eventType)
        val safePositionMs = positionMs.coerceAtLeast(0L)
        val safeDurationMs = durationMs.coerceAtLeast(0L)
        val now = nowSec()
        val db = writableDatabase

        db.beginTransaction()
        try {
            val trackExists = queryTrackIdByCanonicalUri(db, uri) != null
            require(trackExists) { "PLAYBACK_EVENT_TRACK_NOT_FOUND" }

            ensureTrackPlayStatsRow(db, uri, now)
            val existing = queryTrackPlayStats(db, uri) ?: TrackPlayStats(
                uri = uri,
                playCount = 0,
                lastPlayedAtSec = 0,
                lastCompletedAtSec = 0,
                skipCount = 0,
            )

            var playCount = existing.playCount
            var lastPlayedAtSec = existing.lastPlayedAtSec
            var lastCompletedAtSec = existing.lastCompletedAtSec
            var skipCount = existing.skipCount

            when (normalizedEventType) {
                "PLAY_STARTED" -> {
                    lastPlayedAtSec = now
                }

                "PLAY_COMPLETED" -> {
                    lastPlayedAtSec = now
                    if (meetsCompletionThreshold(safePositionMs, safeDurationMs)) {
                        playCount += 1
                        lastCompletedAtSec = now
                    }
                }

                "PLAY_SKIPPED" -> {
                    lastPlayedAtSec = now
                    skipCount += 1
                }

                "PLAY_PAUSED" -> {
                    lastPlayedAtSec = now
                }
            }

            db.update(
                TABLE_TRACK_PLAY_STATS,
                ContentValues().apply {
                    put("play_count", playCount)
                    put("last_played_at_sec", lastPlayedAtSec)
                    put("last_completed_at_sec", lastCompletedAtSec)
                    put("skip_count", skipCount)
                    put("updated_at_sec", now)
                },
                "uri = ?",
                arrayOf(uri)
            )

            val result = TrackPlayStats(
                uri = uri,
                playCount = playCount,
                lastPlayedAtSec = lastPlayedAtSec,
                lastCompletedAtSec = lastCompletedAtSec,
                skipCount = skipCount,
            )

            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    private fun normalizeTrack(track: ReadableMap): NormalizedTrack {
        return NormalizedTrack(
            title = track.getStringOrDefault("title", "Unknown title"),
            artist = track.getStringOrDefault("artist", "Unknown artist"),
            album = track.getStringOrDefault("album", "Unknown album"),
            durationMs = track.getLongOrZero("durationMs"),
            mimeType = track.getStringOrDefault("mimeType", ""),
            sizeBytes = track.getLongOrZero("sizeBytes"),
            modifiedSec = track.getLongOrZero("dateModifiedEpochSeconds"),
            displayName = track.getStringOrDefault("displayName", ""),
            relativePath = track.getStringOrDefault("relativePath", "")
        )
    }

    private fun buildDedupKey(track: NormalizedTrack): String {
        return listOf(
            track.title.trim().lowercase(),
            track.artist.trim().lowercase(),
            track.durationMs.toString()
        ).joinToString("|")
    }

    private fun buildSearchTokens(track: NormalizedTrack): String {
        return listOf(
            track.title,
            track.artist,
            track.album,
            track.displayName,
            track.relativePath
        ).joinToString(" ").trim().lowercase()
    }

    private fun queryTrackIdByCanonicalUri(db: SQLiteDatabase, uri: String): Long? {
        val sql = "SELECT id FROM $TABLE_TRACKS WHERE canonical_uri = ? LIMIT 1"
        db.rawQuery(sql, arrayOf(uri)).use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getLong(0)
            }
        }
        return null
    }

    private fun queryCanonicalUriByDedupKey(db: SQLiteDatabase, dedupKey: String): String? {
        val sql = "SELECT canonical_uri FROM $TABLE_TRACKS WHERE dedup_key = ? LIMIT 1"
        db.rawQuery(sql, arrayOf(dedupKey)).use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getString(0)
            }
        }
        return null
    }

    private fun queryTrackPlayStats(db: SQLiteDatabase, uri: String): TrackPlayStats? {
        val sql =
            """
            SELECT uri, play_count, last_played_at_sec, last_completed_at_sec, skip_count
            FROM $TABLE_TRACK_PLAY_STATS
            WHERE uri = ?
            LIMIT 1
            """.trimIndent()

        db.rawQuery(sql, arrayOf(uri)).use { cursor ->
            if (cursor.moveToFirst()) {
                return TrackPlayStats(
                    uri = cursor.getString(0),
                    playCount = cursor.getInt(1),
                    lastPlayedAtSec = cursor.getLong(2),
                    lastCompletedAtSec = cursor.getLong(3),
                    skipCount = cursor.getInt(4),
                )
            }
        }

        return null
    }

    private fun insertTrack(
        db: SQLiteDatabase,
        canonicalUri: String,
        sourceType: String,
        sourceRoot: String,
        normalized: NormalizedTrack,
        dedupKey: String,
        searchTokens: String,
        updatedAtSec: Long
    ) {
        db.insertOrThrow(TABLE_TRACKS, null, trackValues(
            canonicalUri = canonicalUri,
            sourceType = sourceType,
            sourceRoot = sourceRoot,
            normalized = normalized,
            dedupKey = dedupKey,
            searchTokens = searchTokens,
            updatedAtSec = updatedAtSec
        ))
        ensureTrackPlayStatsRow(db, canonicalUri, updatedAtSec)
    }

    private fun updateTrack(
        db: SQLiteDatabase,
        id: Long,
        canonicalUri: String,
        sourceType: String,
        sourceRoot: String,
        normalized: NormalizedTrack,
        dedupKey: String,
        searchTokens: String,
        updatedAtSec: Long
    ) {
        db.update(
            TABLE_TRACKS,
            trackValues(
                canonicalUri = canonicalUri,
                sourceType = sourceType,
                sourceRoot = sourceRoot,
                normalized = normalized,
                dedupKey = dedupKey,
                searchTokens = searchTokens,
                updatedAtSec = updatedAtSec
            ),
            "id = ?",
            arrayOf(id.toString())
        )
        ensureTrackPlayStatsRow(db, canonicalUri, updatedAtSec)
    }

    private fun ensureTrackPlayStatsRow(db: SQLiteDatabase, uri: String, updatedAtSec: Long) {
        db.insertWithOnConflict(
            TABLE_TRACK_PLAY_STATS,
            null,
            ContentValues().apply {
                put("uri", uri)
                put("play_count", 0)
                put("last_played_at_sec", 0)
                put("last_completed_at_sec", 0)
                put("skip_count", 0)
                put("updated_at_sec", updatedAtSec)
            },
            SQLiteDatabase.CONFLICT_IGNORE
        )
    }

    private fun normalizePlaybackEventType(raw: String): String {
        return when (raw.trim().uppercase(Locale.US)) {
            "PLAY_STARTED" -> "PLAY_STARTED"
            "PLAY_COMPLETED" -> "PLAY_COMPLETED"
            "PLAY_SKIPPED" -> "PLAY_SKIPPED"
            "PLAY_PAUSED" -> "PLAY_PAUSED"
            else -> throw IllegalArgumentException("PLAYBACK_EVENT_TYPE_INVALID")
        }
    }

    private fun meetsCompletionThreshold(positionMs: Long, durationMs: Long): Boolean {
        if (positionMs >= 30_000L) {
            return true
        }

        if (durationMs <= 0L) {
            return false
        }

        return positionMs * 100L >= durationMs * 70L
    }

    private fun trackValues(
        canonicalUri: String,
        sourceType: String,
        sourceRoot: String,
        normalized: NormalizedTrack,
        dedupKey: String,
        searchTokens: String,
        updatedAtSec: Long
    ) = ContentValues().apply {
        put("canonical_uri", canonicalUri)
        put("source_type", sourceType)
        put("source_root", sourceRoot)
        put("title", normalized.title)
        put("artist", normalized.artist)
        put("album", normalized.album)
        put("duration_ms", normalized.durationMs)
        put("mime_type", normalized.mimeType)
        put("size_bytes", normalized.sizeBytes)
        put("modified_sec", normalized.modifiedSec)
        put("display_name", normalized.displayName)
        put("relative_path", normalized.relativePath)
        put("dedup_key", dedupKey)
        put("search_tokens", searchTokens)
        put("updated_at_sec", updatedAtSec)
    }

    private fun insertSnapshot(
        db: SQLiteDatabase,
        sourceType: String,
        sourceRoot: String,
        startedAtSec: Long,
        completedAtSec: Long,
        scanned: Int,
        inserted: Int,
        updated: Int,
        duplicate: Int,
        skipped: Int,
        removed: Int,
        coverageMode: String
    ): Long {
        val values = ContentValues().apply {
            put("source_type", sourceType)
            put("source_root", sourceRoot)
            put("started_at_sec", startedAtSec)
            put("completed_at_sec", completedAtSec)
            put("scanned_count", scanned)
            put("inserted_count", inserted)
            put("updated_count", updated)
            put("duplicate_count", duplicate)
            put("skipped_count", skipped)
            put("removed_count", removed)
            put("coverage_mode", coverageMode)
        }

        return db.insertOrThrow(TABLE_SNAPSHOTS, null, values)
    }

    private fun insertDiagnostics(
        db: SQLiteDatabase,
        snapshotId: Long,
        diagnostics: List<SyncDiagnostic>
    ) {
        if (diagnostics.isEmpty()) {
            return
        }

        diagnostics.forEach { diagnostic ->
            val values = ContentValues().apply {
                put("snapshot_id", snapshotId)
                put("level", diagnostic.level.uppercase(Locale.US))
                put("code", diagnostic.code)
                put("root", diagnostic.root)
                put("message", diagnostic.message)
                put("created_at_sec", nowSec())
            }

            db.insertOrThrow(TABLE_DIAGNOSTICS, null, values)
        }
    }

    private fun removeMissingTracksForSource(
        db: SQLiteDatabase,
        sourceType: String,
        sourceRoot: String,
        seenUris: Set<String>
    ): Int {
        val existingUris = mutableSetOf<String>()
        val sql = "SELECT canonical_uri FROM $TABLE_TRACKS WHERE source_type = ? AND source_root = ?"
        db.rawQuery(sql, arrayOf(sourceType, sourceRoot)).use { cursor ->
            while (cursor.moveToNext()) {
                existingUris.add(cursor.getString(0))
            }
        }

        val removedUris = existingUris - seenUris
        removedUris.forEach { uri ->
            db.delete(TABLE_TRACKS, "canonical_uri = ?", arrayOf(uri))
        }

        return removedUris.size
    }

    private fun nowSec(): Long = System.currentTimeMillis() / 1000L

}
