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

class UserPlaylistStore(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "user_playlists.db"
        private const val DATABASE_VERSION = 1
        private const val TABLE_PLAYLISTS = "user_playlists"
        private const val TABLE_ENTRIES = "user_playlist_entries"
        private const val MAX_PLAYLIST_NAME_LENGTH = 80
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_PLAYLISTS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at_sec INTEGER NOT NULL,
                updated_at_sec INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_playlists_name ON $TABLE_PLAYLISTS(name)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_ENTRIES (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                uri TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                FOREIGN KEY(playlist_id) REFERENCES $TABLE_PLAYLISTS(id) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_user_playlist_entries_playlist ON $TABLE_ENTRIES(playlist_id)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_playlist_entries_pos ON $TABLE_ENTRIES(playlist_id, position)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    }

    fun createPlaylist(name: String): WritableMap {
        val trimmed = name.trim()
        require(trimmed.isNotBlank()) { "PLAYLIST_NAME_REQUIRED" }
        require(trimmed.length <= MAX_PLAYLIST_NAME_LENGTH) { "PLAYLIST_NAME_TOO_LONG" }

        val db = writableDatabase
        val lowered = trimmed.lowercase(Locale.US)
        db.rawQuery(
            "SELECT id FROM $TABLE_PLAYLISTS WHERE lower(name) = ? LIMIT 1",
            arrayOf(lowered)
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                throw IllegalArgumentException("PLAYLIST_NAME_EXISTS")
            }
        }

        val now = nowSec()
        val id = db.insertOrThrow(
            TABLE_PLAYLISTS,
            null,
            ContentValues().apply {
                put("name", trimmed)
                put("created_at_sec", now)
                put("updated_at_sec", now)
            }
        )

        return getPlaylistById(id) ?: Arguments.createMap().apply {
            putDouble("id", id.toDouble())
            putString("name", trimmed)
            putDouble("entryCount", 0.0)
            putDouble("updatedAtSec", now.toDouble())
        }
    }

    fun listPlaylists(): WritableArray {
        val db = readableDatabase
        val array = Arguments.createArray()
        val sql =
            """
            SELECT p.id, p.name, p.updated_at_sec, COUNT(e.id) AS entry_count
            FROM $TABLE_PLAYLISTS p
            LEFT JOIN $TABLE_ENTRIES e ON e.playlist_id = p.id
            GROUP BY p.id, p.name, p.updated_at_sec
            ORDER BY p.updated_at_sec DESC, p.name ASC
            """.trimIndent()

        db.rawQuery(sql, null).use { cursor ->
            while (cursor.moveToNext()) {
                array.pushMap(
                    Arguments.createMap().apply {
                        putDouble("id", cursor.getLong(0).toDouble())
                        putString("name", cursor.getString(1))
                        putDouble("updatedAtSec", cursor.getLong(2).toDouble())
                        putDouble("entryCount", cursor.getInt(3).toDouble())
                    }
                )
            }
        }

        return array
    }

    fun searchPlaylistsByName(query: String, limit: Int): WritableArray {
        val db = readableDatabase
        val safeLimit = if (limit <= 0) 30 else limit
        val normalized = query.trim().lowercase(Locale.US)
        if (normalized.isBlank()) {
            return Arguments.createArray()
        }

        val array = Arguments.createArray()
        val contains = "%$normalized%"
        val prefix = "$normalized%"
        val sql =
            """
            SELECT p.id, p.name, p.updated_at_sec, COUNT(e.id) AS entry_count
            FROM $TABLE_PLAYLISTS p
            LEFT JOIN $TABLE_ENTRIES e ON e.playlist_id = p.id
            WHERE lower(p.name) LIKE ?
            GROUP BY p.id, p.name, p.updated_at_sec
            ORDER BY
                CASE
                    WHEN lower(p.name) = ? THEN 0
                    WHEN lower(p.name) LIKE ? THEN 1
                    ELSE 2
                END,
                lower(p.name) ASC,
                p.updated_at_sec DESC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(contains, normalized, prefix, safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                array.pushMap(
                    Arguments.createMap().apply {
                        putDouble("id", cursor.getLong(0).toDouble())
                        putString("name", cursor.getString(1))
                        putDouble("updatedAtSec", cursor.getLong(2).toDouble())
                        putDouble("entryCount", cursor.getInt(3).toDouble())
                    }
                )
            }
        }

        return array
    }

    fun getRecentlyPlayedPlaylists(limit: Int): WritableArray {
        val db = readableDatabase
        val safeLimit = if (limit <= 0) 20 else limit
        val array = Arguments.createArray()
        val sql =
            """
            SELECT p.id, p.name, p.updated_at_sec, COUNT(e.id) AS entry_count
            FROM $TABLE_PLAYLISTS p
            LEFT JOIN $TABLE_ENTRIES e ON e.playlist_id = p.id
            GROUP BY p.id, p.name, p.updated_at_sec
            ORDER BY p.updated_at_sec DESC, p.name ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                array.pushMap(
                    Arguments.createMap().apply {
                        putDouble("id", cursor.getLong(0).toDouble())
                        putString("name", cursor.getString(1))
                        putDouble("updatedAtSec", cursor.getLong(2).toDouble())
                        putDouble("entryCount", cursor.getInt(3).toDouble())
                    }
                )
            }
        }

        return array
    }

    fun getPlaylistEntries(playlistId: Long): WritableArray {
        val db = readableDatabase
        requirePlaylistExists(db, playlistId)
        return toWritableArray(queryPlaylistRows(db, playlistId))
    }

    fun addTrack(playlistId: Long, track: ReadableMap): WritableArray {
        val db = writableDatabase
        db.beginTransaction()
        try {
            requirePlaylistExists(db, playlistId)
            val nextPosition = getNextPosition(db, playlistId)
            db.insertOrThrow(
                TABLE_ENTRIES,
                null,
                ContentValues().apply {
                    put("playlist_id", playlistId)
                    put("position", nextPosition)
                    put("uri", track.getStringOrEmpty("uri"))
                    put("title", track.getStringOrDefault("title", "Unknown title"))
                    put("artist", track.getStringOrDefault("artist", "Unknown artist"))
                    put("album", track.getStringOrDefault("album", "Unknown album"))
                    put("duration_ms", track.getLongOrZero("durationMs"))
                    put("display_name", track.getStringOrDefault("displayName", ""))
                    put("relative_path", track.getStringOrDefault("relativePath", ""))
                }
            )

            touchPlaylist(db, playlistId)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        return getPlaylistEntries(playlistId)
    }

    fun removeTrack(playlistId: Long, position: Int): WritableArray {
        val db = writableDatabase
        db.beginTransaction()
        try {
            requirePlaylistExists(db, playlistId)
            db.delete(
                TABLE_ENTRIES,
                "playlist_id = ? AND position = ?",
                arrayOf(playlistId.toString(), position.toString())
            )
            compactPositions(db, playlistId)
            touchPlaylist(db, playlistId)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        return getPlaylistEntries(playlistId)
    }

    fun moveTrack(playlistId: Long, fromPosition: Int, toPosition: Int): WritableArray {
        val db = writableDatabase
        db.beginTransaction()
        try {
            requirePlaylistExists(db, playlistId)
            val rows = queryPlaylistRows(db, playlistId).toMutableList()

            if (fromPosition !in rows.indices || toPosition !in rows.indices || fromPosition == toPosition) {
                db.setTransactionSuccessful()
                return toWritableArray(rows)
            }

            val moved = rows.removeAt(fromPosition)
            rows.add(toPosition, moved)

            db.delete(TABLE_ENTRIES, "playlist_id = ?", arrayOf(playlistId.toString()))

            rows.forEachIndexed { index, row ->
                db.insertOrThrow(
                    TABLE_ENTRIES,
                    null,
                    ContentValues().apply {
                        put("playlist_id", playlistId)
                        put("position", index)
                        put("uri", row.uri)
                        put("title", row.title)
                        put("artist", row.artist)
                        put("album", row.album)
                        put("duration_ms", row.durationMs)
                        put("display_name", row.displayName)
                        put("relative_path", row.relativePath)
                    }
                )
            }

            touchPlaylist(db, playlistId)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        return getPlaylistEntries(playlistId)
    }

    private fun queryPlaylistRows(db: SQLiteDatabase, playlistId: Long): List<PlaylistEntryRow> {
        val rows = mutableListOf<PlaylistEntryRow>()
        val sql =
            """
            SELECT position, uri, title, artist, album, duration_ms, display_name, relative_path
            FROM $TABLE_ENTRIES
            WHERE playlist_id = ?
            ORDER BY position ASC
            """.trimIndent()

        db.rawQuery(sql, arrayOf(playlistId.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(
                    PlaylistEntryRow(
                        position = cursor.getInt(0),
                        uri = cursor.getString(1),
                        title = cursor.getString(2),
                        artist = cursor.getString(3),
                        album = cursor.getString(4),
                        durationMs = cursor.getLong(5),
                        displayName = cursor.getString(6),
                        relativePath = cursor.getString(7)
                    )
                )
            }
        }

        return rows
    }

    private fun toWritableArray(rows: List<PlaylistEntryRow>): WritableArray {
        val array = Arguments.createArray()
        rows.forEach { row ->
            array.pushMap(
                Arguments.createMap().apply {
                    putDouble("position", row.position.toDouble())
                    putString("uri", row.uri)
                    putString("title", row.title)
                    putString("artist", row.artist)
                    putString("album", row.album)
                    putDouble("durationMs", row.durationMs.toDouble())
                    putString("displayName", row.displayName)
                    putString("relativePath", row.relativePath)
                }
            )
        }
        return array
    }

    private fun compactPositions(db: SQLiteDatabase, playlistId: Long) {
        val rows = mutableListOf<Pair<Long, Int>>()
        db.rawQuery(
            "SELECT id, position FROM $TABLE_ENTRIES WHERE playlist_id = ? ORDER BY position ASC",
            arrayOf(playlistId.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(cursor.getLong(0) to cursor.getInt(1))
            }
        }

        rows.forEachIndexed { index, row ->
            if (row.second != index) {
                db.update(
                    TABLE_ENTRIES,
                    ContentValues().apply { put("position", index) },
                    "id = ?",
                    arrayOf(row.first.toString())
                )
            }
        }
    }

    private fun getPlaylistById(id: Long): WritableMap? {
        val db = readableDatabase
        val sql =
            """
            SELECT p.id, p.name, p.updated_at_sec, COUNT(e.id) AS entry_count
            FROM $TABLE_PLAYLISTS p
            LEFT JOIN $TABLE_ENTRIES e ON e.playlist_id = p.id
            WHERE p.id = ?
            GROUP BY p.id, p.name, p.updated_at_sec
            LIMIT 1
            """.trimIndent()

        db.rawQuery(sql, arrayOf(id.toString())).use { cursor ->
            if (!cursor.moveToFirst()) {
                return null
            }

            return Arguments.createMap().apply {
                putDouble("id", cursor.getLong(0).toDouble())
                putString("name", cursor.getString(1))
                putDouble("updatedAtSec", cursor.getLong(2).toDouble())
                putDouble("entryCount", cursor.getInt(3).toDouble())
            }
        }
    }

    private fun getNextPosition(db: SQLiteDatabase, playlistId: Long): Int {
        db.rawQuery(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM $TABLE_ENTRIES WHERE playlist_id = ?",
            arrayOf(playlistId.toString())
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getInt(0)
            }
        }

        return 0
    }

    private fun requirePlaylistExists(db: SQLiteDatabase, playlistId: Long) {
        val exists = db.rawQuery(
            "SELECT 1 FROM $TABLE_PLAYLISTS WHERE id = ? LIMIT 1",
            arrayOf(playlistId.toString())
        ).use { cursor ->
            cursor.moveToFirst()
        }

        if (!exists) {
            throw IllegalArgumentException("PLAYLIST_NOT_FOUND")
        }
    }

    private fun touchPlaylist(db: SQLiteDatabase, playlistId: Long) {
        db.update(
            TABLE_PLAYLISTS,
            ContentValues().apply { put("updated_at_sec", nowSec()) },
            "id = ?",
            arrayOf(playlistId.toString())
        )
    }

    private fun nowSec(): Long = System.currentTimeMillis() / 1000L

    private data class PlaylistEntryRow(
        val position: Int,
        val uri: String,
        val title: String,
        val artist: String,
        val album: String,
        val durationMs: Long,
        val displayName: String,
        val relativePath: String,
    )
}
