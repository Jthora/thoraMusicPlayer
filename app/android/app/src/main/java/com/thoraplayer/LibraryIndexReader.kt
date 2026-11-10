package com.thoraplayer

import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import kotlin.random.Random

data class SnapshotStatus(
    val snapshotId: Long,
    val sourceType: String,
    val sourceRoot: String,
    val coverageMode: String,
    val startedAtSec: Long,
    val completedAtSec: Long,
    val scannedCount: Int,
    val insertedCount: Int,
    val updatedCount: Int,
    val duplicateCount: Int,
    val skippedCount: Int,
    val removedCount: Int
)

class LibraryIndexReader(private val dbHelper: SQLiteOpenHelper) {

    companion object {
        private const val TABLE_TRACKS = "indexed_tracks"
        private const val TABLE_SNAPSHOTS = "scan_snapshots"
        private const val TABLE_DIAGNOSTICS = "scan_diagnostics"
    }

    fun getIndexStats(): WritableMap {
        val db = dbHelper.readableDatabase

        val totalTracks = scalarLong(dbHelper, "SELECT COUNT(*) FROM $TABLE_TRACKS")
        val distinctRoots = scalarLong(dbHelper, "SELECT COUNT(DISTINCT source_root) FROM $TABLE_TRACKS")
        val lastUpdatedSec = scalarLong(dbHelper, "SELECT COALESCE(MAX(updated_at_sec), 0) FROM $TABLE_TRACKS")
        val snapshotCount = scalarLong(dbHelper, "SELECT COUNT(*) FROM $TABLE_SNAPSHOTS")

        return Arguments.createMap().apply {
            putDouble("totalTracks", totalTracks.toDouble())
            putDouble("distinctRoots", distinctRoots.toDouble())
            putDouble("lastUpdatedSec", lastUpdatedSec.toDouble())
            putDouble("snapshotCount", snapshotCount.toDouble())
        }
    }

    fun searchTracks(query: String, limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 50 else limit
        val q = "%${query.trim().lowercase()}%"

        val rows = Arguments.createArray()
        val sql =
            """
            SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                   modified_sec, display_name, relative_path
            FROM $TABLE_TRACKS
            WHERE search_tokens LIKE ?
            ORDER BY modified_sec DESC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(q, safeLimit.toString())).use { cursor ->
            val uriCol = cursor.getColumnIndexOrThrow("canonical_uri")
            val titleCol = cursor.getColumnIndexOrThrow("title")
            val artistCol = cursor.getColumnIndexOrThrow("artist")
            val albumCol = cursor.getColumnIndexOrThrow("album")
            val durationCol = cursor.getColumnIndexOrThrow("duration_ms")
            val mimeCol = cursor.getColumnIndexOrThrow("mime_type")
            val sizeCol = cursor.getColumnIndexOrThrow("size_bytes")
            val modifiedCol = cursor.getColumnIndexOrThrow("modified_sec")
            val displayCol = cursor.getColumnIndexOrThrow("display_name")
            val relativeCol = cursor.getColumnIndexOrThrow("relative_path")

            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("uri", cursor.getString(uriCol))
                        putString("title", cursor.getString(titleCol))
                        putString("artist", cursor.getString(artistCol))
                        putString("album", cursor.getString(albumCol))
                        putDouble("durationMs", cursor.getLong(durationCol).toDouble())
                        putString("mimeType", cursor.getString(mimeCol))
                        putDouble("sizeBytes", cursor.getLong(sizeCol).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(modifiedCol).toDouble())
                        putString("displayName", cursor.getString(displayCol))
                        putString("relativePath", cursor.getString(relativeCol))
                    }
                )
            }
        }

        return rows
    }

    fun searchTracksByScope(query: String, scope: String, limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 50 else limit
        val normalized = query.trim().lowercase()
        val contains = "%$normalized%"
        val prefix = "$normalized%"

        val rows = Arguments.createArray()
        val queryConfig =
            when (scope) {
                "song_names" ->
                    Pair(
                        """
                    SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                           modified_sec, display_name, relative_path
                    FROM $TABLE_TRACKS
                    WHERE lower(title) LIKE ?
                    ORDER BY
                        CASE
                            WHEN lower(title) = ? THEN 0
                            WHEN lower(title) LIKE ? THEN 1
                            ELSE 2
                        END,
                        lower(title) ASC,
                        lower(artist) ASC,
                        canonical_uri ASC
                    LIMIT ?
                    """.trimIndent(),
                        arrayOf(contains, normalized, prefix, safeLimit.toString())
                    )
                "song_albums" ->
                    Pair(
                        """
                    SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                           modified_sec, display_name, relative_path
                    FROM $TABLE_TRACKS
                    WHERE lower(album) LIKE ?
                    ORDER BY
                        CASE
                            WHEN lower(album) = ? THEN 0
                            WHEN lower(album) LIKE ? THEN 1
                            ELSE 2
                        END,
                        lower(album) ASC,
                        lower(title) ASC,
                        canonical_uri ASC
                    LIMIT ?
                    """.trimIndent(),
                        arrayOf(contains, normalized, prefix, safeLimit.toString())
                    )
                "song_artists" ->
                    Pair(
                        """
                    SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                           modified_sec, display_name, relative_path
                    FROM $TABLE_TRACKS
                    WHERE lower(artist) LIKE ?
                    ORDER BY
                        CASE
                            WHEN lower(artist) = ? THEN 0
                            WHEN lower(artist) LIKE ? THEN 1
                            ELSE 2
                        END,
                        lower(artist) ASC,
                        lower(title) ASC,
                        canonical_uri ASC
                    LIMIT ?
                    """.trimIndent(),
                        arrayOf(contains, normalized, prefix, safeLimit.toString())
                    )
                "playlist_titles" ->
                    Pair(
                        """
                    SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                           modified_sec, display_name, relative_path
                    FROM $TABLE_TRACKS
                    WHERE 1 = 0
                    LIMIT ?
                    """.trimIndent(),
                        arrayOf(safeLimit.toString())
                    )
                else ->
                    Pair(
                        """
                    SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                           modified_sec, display_name, relative_path
                    FROM $TABLE_TRACKS
                    WHERE search_tokens LIKE ?
                    ORDER BY
                        CASE
                            WHEN lower(title) = ? THEN 0
                            WHEN lower(title) LIKE ? THEN 1
                            WHEN lower(title) LIKE ? THEN 2
                            WHEN lower(artist) = ? OR lower(album) = ? THEN 3
                            WHEN lower(artist) LIKE ? OR lower(album) LIKE ? THEN 4
                            ELSE 5
                        END,
                        lower(title) ASC,
                        lower(artist) ASC,
                        canonical_uri ASC
                    LIMIT ?
                    """.trimIndent(),
                        arrayOf(
                            contains,
                            normalized,
                            prefix,
                            contains,
                            normalized,
                            normalized,
                            prefix,
                            prefix,
                            safeLimit.toString()
                        )
                    )
            }

        val (sql, args) = queryConfig

        db.rawQuery(sql, args).use { cursor ->
            val uriCol = cursor.getColumnIndexOrThrow("canonical_uri")
            val titleCol = cursor.getColumnIndexOrThrow("title")
            val artistCol = cursor.getColumnIndexOrThrow("artist")
            val albumCol = cursor.getColumnIndexOrThrow("album")
            val durationCol = cursor.getColumnIndexOrThrow("duration_ms")
            val mimeCol = cursor.getColumnIndexOrThrow("mime_type")
            val sizeCol = cursor.getColumnIndexOrThrow("size_bytes")
            val modifiedCol = cursor.getColumnIndexOrThrow("modified_sec")
            val displayCol = cursor.getColumnIndexOrThrow("display_name")
            val relativeCol = cursor.getColumnIndexOrThrow("relative_path")

            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("uri", cursor.getString(uriCol))
                        putString("title", cursor.getString(titleCol))
                        putString("artist", cursor.getString(artistCol))
                        putString("album", cursor.getString(albumCol))
                        putDouble("durationMs", cursor.getLong(durationCol).toDouble())
                        putString("mimeType", cursor.getString(mimeCol))
                        putDouble("sizeBytes", cursor.getLong(sizeCol).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(modifiedCol).toDouble())
                        putString("displayName", cursor.getString(displayCol))
                        putString("relativePath", cursor.getString(relativeCol))
                    }
                )
            }
        }

        return rows
    }

    fun generateFolderQueue(
        folderPath: String,
        anchorUri: String?,
        sortMode: String,
        limit: Int
    ): WritableMap {
        val db = dbHelper.readableDatabase
        val normalizedFolder = folderPath.trim().trim('/').lowercase()
        val safeLimit = if (limit <= 0) 500 else limit
        val whereArg = "%$normalizedFolder%"

        val unsortedRows = mutableListOf<QueueRow>()
        val sql =
            """
            SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                   modified_sec, display_name, relative_path
            FROM $TABLE_TRACKS
            WHERE lower(relative_path) LIKE ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(whereArg)).use { cursor ->
            val uriCol = cursor.getColumnIndexOrThrow("canonical_uri")
            val titleCol = cursor.getColumnIndexOrThrow("title")
            val artistCol = cursor.getColumnIndexOrThrow("artist")
            val albumCol = cursor.getColumnIndexOrThrow("album")
            val durationCol = cursor.getColumnIndexOrThrow("duration_ms")
            val mimeCol = cursor.getColumnIndexOrThrow("mime_type")
            val sizeCol = cursor.getColumnIndexOrThrow("size_bytes")
            val modifiedCol = cursor.getColumnIndexOrThrow("modified_sec")
            val displayCol = cursor.getColumnIndexOrThrow("display_name")
            val relativeCol = cursor.getColumnIndexOrThrow("relative_path")

            while (cursor.moveToNext()) {
                unsortedRows.add(
                    QueueRow(
                        uri = cursor.getString(uriCol),
                        title = cursor.getString(titleCol),
                        artist = cursor.getString(artistCol),
                        album = cursor.getString(albumCol),
                        durationMs = cursor.getLong(durationCol),
                        mimeType = cursor.getString(mimeCol),
                        sizeBytes = cursor.getLong(sizeCol),
                        modifiedSec = cursor.getLong(modifiedCol),
                        displayName = cursor.getString(displayCol),
                        relativePath = cursor.getString(relativeCol)
                    )
                )
            }
        }

        val sortedRows = sortFolderRows(sortMode, folderPath, unsortedRows).take(safeLimit)
        val queue = Arguments.createArray().apply {
            sortedRows.forEach { row ->
                pushMap(row.toWritableMap())
            }
        }

        val resolvedAnchorIndex = resolveAnchorIndex(queue, anchorUri)

        return Arguments.createMap().apply {
            putString("folderPath", folderPath)
            putString("sortMode", sortMode)
            putArray("queue", queue)
            putDouble("queueLength", queue.size().toDouble())
            putDouble("anchorIndex", resolvedAnchorIndex.toDouble())
            putDouble("queueRevision", System.currentTimeMillis().toDouble())
        }
    }

    fun getLatestSnapshotStatus(): SnapshotStatus? {
        val db = dbHelper.readableDatabase
        val sql =
            """
            SELECT id, source_type, source_root, started_at_sec, completed_at_sec,
                   scanned_count, inserted_count, updated_count, duplicate_count,
                     skipped_count, removed_count, COALESCE(coverage_mode, 'FULL')
            FROM $TABLE_SNAPSHOTS
            ORDER BY id DESC
            LIMIT 1
            """.trimIndent()

        db.rawQuery(sql, null).use { cursor ->
            if (!cursor.moveToFirst()) {
                return null
            }

            return SnapshotStatus(
                snapshotId = cursor.getLong(0),
                sourceType = cursor.getString(1),
                sourceRoot = cursor.getString(2),
                coverageMode = cursor.getString(11),
                startedAtSec = cursor.getLong(3),
                completedAtSec = cursor.getLong(4),
                scannedCount = cursor.getInt(5),
                insertedCount = cursor.getInt(6),
                updatedCount = cursor.getInt(7),
                duplicateCount = cursor.getInt(8),
                skippedCount = cursor.getInt(9),
                removedCount = cursor.getInt(10)
            )
        }
    }

    fun getSnapshotDiagnostics(snapshotId: Long, limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 100 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT level, code, root, message, created_at_sec
            FROM $TABLE_DIAGNOSTICS
            WHERE snapshot_id = ?
            ORDER BY id DESC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(snapshotId.toString(), safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("level", cursor.getString(0))
                        putString("code", cursor.getString(1))
                        putString("root", cursor.getString(2))
                        putString("message", cursor.getString(3))
                        putDouble("createdAtSec", cursor.getLong(4).toDouble())
                    }
                )
            }
        }

        return rows
    }

    private fun scalarLong(dbHelper: SQLiteOpenHelper, sql: String): Long {
        dbHelper.readableDatabase.rawQuery(sql, null).use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getLong(0)
            }
        }
        return 0L
    }

    private fun resolveAnchorIndex(queue: WritableArray, anchorUri: String?): Int {
        if (anchorUri.isNullOrBlank()) {
            return 0
        }

        for (index in 0 until queue.size()) {
            val item = queue.getMap(index)
            if (item != null && item.hasKey("uri") && item.getString("uri") == anchorUri) {
                return index
            }
        }

        return 0
    }

    private fun sortFolderRows(sortMode: String, folderPath: String, rows: List<QueueRow>): List<QueueRow> {
        val safeSort = sortMode.lowercase()

        val comparator = Comparator<QueueRow> { left, right ->
            when (safeSort) {
                "modified" -> compareForModified(left, right)
                else -> compareForName(left, right)
            }
        }

        val sorted = rows.sortedWith(comparator)
        if (safeSort != "random") {
            return sorted
        }

        val seed = folderPath.lowercase().hashCode().toLong()
        return sorted.shuffled(Random(seed))
    }

    private fun compareForName(left: QueueRow, right: QueueRow): Int {
        val leftTrack = extractTrackNumber(left)
        val rightTrack = extractTrackNumber(right)

        val trackComparison = compareTrackNumber(leftTrack, rightTrack)
        if (trackComparison != 0) {
            return trackComparison
        }

        val nameComparison = left.sortName.compareTo(right.sortName)
        if (nameComparison != 0) {
            return nameComparison
        }

        val modifiedComparison = right.modifiedSec.compareTo(left.modifiedSec)
        if (modifiedComparison != 0) {
            return modifiedComparison
        }

        return left.uri.compareTo(right.uri)
    }

    private fun compareForModified(left: QueueRow, right: QueueRow): Int {
        val modifiedComparison = right.modifiedSec.compareTo(left.modifiedSec)
        if (modifiedComparison != 0) {
            return modifiedComparison
        }

        val leftTrack = extractTrackNumber(left)
        val rightTrack = extractTrackNumber(right)
        val trackComparison = compareTrackNumber(leftTrack, rightTrack)
        if (trackComparison != 0) {
            return trackComparison
        }

        val nameComparison = left.sortName.compareTo(right.sortName)
        if (nameComparison != 0) {
            return nameComparison
        }

        return left.uri.compareTo(right.uri)
    }

    private fun compareTrackNumber(left: Int?, right: Int?): Int {
        return when {
            left != null && right != null -> left.compareTo(right)
            left != null -> -1
            right != null -> 1
            else -> 0
        }
    }

    private fun extractTrackNumber(row: QueueRow): Int? {
        val source = row.displayName.ifBlank { row.relativePath.substringAfterLast('/') }
        val match = Regex("^(\\d{1,3})[\\s._-]").find(source)
        return match?.groupValues?.getOrNull(1)?.toIntOrNull()
    }

    private data class QueueRow(
        val uri: String,
        val title: String,
        val artist: String,
        val album: String,
        val durationMs: Long,
        val mimeType: String,
        val sizeBytes: Long,
        val modifiedSec: Long,
        val displayName: String,
        val relativePath: String,
    ) {
        val sortName: String
            get() = displayName.ifBlank { relativePath.substringAfterLast('/') }.lowercase()

        fun toWritableMap() = Arguments.createMap().apply {
            putString("uri", uri)
            putString("title", title)
            putString("artist", artist)
            putString("album", album)
            putDouble("durationMs", durationMs.toDouble())
            putString("mimeType", mimeType)
            putDouble("sizeBytes", sizeBytes.toDouble())
            putDouble("dateModifiedEpochSeconds", modifiedSec.toDouble())
            putString("displayName", displayName)
            putString("relativePath", relativePath)
        }
    }
}
