package com.androidmusicplayerapp

import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray

class LibraryBrowseReader(private val dbHelper: SQLiteOpenHelper) {

    companion object {
        private const val TABLE_TRACKS = "indexed_tracks"
        private const val TABLE_TRACK_PLAY_STATS = "track_play_stats"
    }

    fun getRecentlyPlayedTracks(limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 20 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT t.canonical_uri, t.title, t.artist, t.album, t.duration_ms, t.mime_type, t.size_bytes,
                   t.modified_sec, t.display_name, t.relative_path
            FROM $TABLE_TRACKS t
            INNER JOIN $TABLE_TRACK_PLAY_STATS s ON s.uri = t.canonical_uri
            WHERE s.last_played_at_sec > 0
            ORDER BY s.last_played_at_sec DESC, t.canonical_uri ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("uri", cursor.getString(0))
                        putString("title", cursor.getString(1))
                        putString("artist", cursor.getString(2))
                        putString("album", cursor.getString(3))
                        putDouble("durationMs", cursor.getLong(4).toDouble())
                        putString("mimeType", cursor.getString(5))
                        putDouble("sizeBytes", cursor.getLong(6).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(7).toDouble())
                        putString("displayName", cursor.getString(8))
                        putString("relativePath", cursor.getString(9))
                    }
                )
            }
        }

        return rows
    }

    fun getPopularTracks(limit: Int, windowDays: Int?): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 20 else limit
        val safeWindowDays = windowDays?.takeIf { it > 0 }
        val rows = Arguments.createArray()

        val sqlBuilder = StringBuilder(
            """
            SELECT t.canonical_uri, t.title, t.artist, t.album, t.duration_ms, t.mime_type, t.size_bytes,
                   t.modified_sec, t.display_name, t.relative_path
            FROM $TABLE_TRACKS t
            INNER JOIN $TABLE_TRACK_PLAY_STATS s ON s.uri = t.canonical_uri
            WHERE s.play_count > 0
            """.trimIndent()
        )

        val args = mutableListOf<String>()
        if (safeWindowDays != null) {
            val cutoffSec = (System.currentTimeMillis() / 1000L) - (safeWindowDays.toLong() * 86_400L)
            sqlBuilder.append(" AND s.last_completed_at_sec >= ?")
            args.add(cutoffSec.toString())
        }

        sqlBuilder.append(" ORDER BY s.play_count DESC, s.last_completed_at_sec DESC, t.canonical_uri ASC LIMIT ?")
        args.add(safeLimit.toString())

        db.rawQuery(sqlBuilder.toString(), args.toTypedArray()).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("uri", cursor.getString(0))
                        putString("title", cursor.getString(1))
                        putString("artist", cursor.getString(2))
                        putString("album", cursor.getString(3))
                        putDouble("durationMs", cursor.getLong(4).toDouble())
                        putString("mimeType", cursor.getString(5))
                        putDouble("sizeBytes", cursor.getLong(6).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(7).toDouble())
                        putString("displayName", cursor.getString(8))
                        putString("relativePath", cursor.getString(9))
                    }
                )
            }
        }

        return rows
    }

    fun browseAlbums(limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 50 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT album, COUNT(*) AS track_count, MIN(artist) AS sample_artist
            FROM $TABLE_TRACKS
            GROUP BY lower(album)
            ORDER BY lower(album) ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("album", cursor.getString(0))
                        putDouble("trackCount", cursor.getInt(1).toDouble())
                        putString("sampleArtist", cursor.getString(2))
                    }
                )
            }
        }

        return rows
    }

    fun browseArtists(limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 50 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT artist, COUNT(*) AS track_count, COUNT(DISTINCT album) AS album_count
            FROM $TABLE_TRACKS
            GROUP BY lower(artist)
            ORDER BY lower(artist) ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("artist", cursor.getString(0))
                        putDouble("trackCount", cursor.getInt(1).toDouble())
                        putDouble("albumCount", cursor.getInt(2).toDouble())
                    }
                )
            }
        }

        return rows
    }

    fun browseSongs(limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 100 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT canonical_uri, title, artist, album, duration_ms, mime_type, size_bytes,
                   modified_sec, display_name, relative_path
            FROM $TABLE_TRACKS
            ORDER BY lower(title) ASC, lower(artist) ASC, canonical_uri ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("uri", cursor.getString(0))
                        putString("title", cursor.getString(1))
                        putString("artist", cursor.getString(2))
                        putString("album", cursor.getString(3))
                        putDouble("durationMs", cursor.getLong(4).toDouble())
                        putString("mimeType", cursor.getString(5))
                        putDouble("sizeBytes", cursor.getLong(6).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(7).toDouble())
                        putString("displayName", cursor.getString(8))
                        putString("relativePath", cursor.getString(9))
                    }
                )
            }
        }

        return rows
    }

    fun getRecentlyPlayedAlbums(limit: Int): WritableArray {
        val db = dbHelper.readableDatabase
        val safeLimit = if (limit <= 0) 20 else limit
        val rows = Arguments.createArray()

        val sql =
            """
            SELECT t.album, COUNT(*) AS track_count, MIN(t.artist) AS sample_artist,
                   MAX(s.last_played_at_sec) AS last_played_at_sec
            FROM $TABLE_TRACKS t
            INNER JOIN $TABLE_TRACK_PLAY_STATS s ON s.uri = t.canonical_uri
            WHERE s.last_played_at_sec > 0
            GROUP BY lower(t.album)
            ORDER BY last_played_at_sec DESC, lower(t.album) ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(safeLimit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                        putString("album", cursor.getString(0))
                        putDouble("trackCount", cursor.getInt(1).toDouble())
                        putString("sampleArtist", cursor.getString(2))
                        putDouble("lastPlayedAtSec", cursor.getLong(3).toDouble())
                    }
                )
            }
        }

        return rows
    }
}
