package com.androidmusicplayerapp

import android.database.sqlite.SQLiteOpenHelper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

class SearchRelevanceValidator(private val dbHelper: SQLiteOpenHelper) {

    companion object {
        private const val TABLE_TRACKS = "indexed_tracks"
    }

    fun validate(sampleLimit: Int, resultLimit: Int): WritableMap {
        val safeSampleLimit = sampleLimit.coerceIn(1, 50)
        val safeResultLimit = resultLimit.coerceIn(1, 25)

        val samples = loadSamples(safeSampleLimit)
        if (samples.isEmpty()) {
            return Arguments.createMap().apply {
                putDouble("sampled", 0.0)
                putDouble("passed", 0.0)
                putDouble("failed", 0.0)
                putDouble("passRate", 0.0)
                putString("status", "NO_DATA")
                putArray("failedExamples", Arguments.createArray())
            }
        }

        var passed = 0
        var failed = 0
        val failedExamples = Arguments.createArray()

        samples.forEach { sample ->
            val query = buildQuery(sample)
            if (query.isBlank()) {
                failed += 1
                failedExamples.pushMap(
                    Arguments.createMap().apply {
                        putString("query", "")
                        putString("targetTitle", sample.title)
                        putString("targetUri", sample.uri)
                        putString("reason", "EMPTY_QUERY")
                    }
                )
                return@forEach
            }

            val resultUris = runSearch(query, safeResultLimit)
            if (resultUris.contains(sample.uri)) {
                passed += 1
            } else {
                failed += 1
                failedExamples.pushMap(
                    Arguments.createMap().apply {
                        putString("query", query)
                        putString("targetTitle", sample.title)
                        putString("targetUri", sample.uri)
                        putString("reason", "NOT_IN_TOP_RESULTS")
                        putString("topResultUri", resultUris.firstOrNull())
                    }
                )
            }
        }

        val sampled = samples.size
        val passRate = if (sampled == 0) 0.0 else (passed.toDouble() / sampled.toDouble())

        return Arguments.createMap().apply {
            putDouble("sampled", sampled.toDouble())
            putDouble("passed", passed.toDouble())
            putDouble("failed", failed.toDouble())
            putDouble("passRate", passRate)
            putString("status", if (failed == 0) "PASS" else "WARN")
            putArray("failedExamples", failedExamples)
        }
    }

    private fun loadSamples(limit: Int): List<SampleTrack> {
        val db = dbHelper.readableDatabase
        val samples = mutableListOf<SampleTrack>()

        val sql =
            """
            SELECT canonical_uri, title, artist, album, display_name, relative_path
            FROM $TABLE_TRACKS
            ORDER BY modified_sec DESC, canonical_uri ASC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(limit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                samples.add(
                    SampleTrack(
                        uri = cursor.getString(0),
                        title = cursor.getString(1),
                        artist = cursor.getString(2),
                        album = cursor.getString(3),
                        displayName = cursor.getString(4),
                        relativePath = cursor.getString(5)
                    )
                )
            }
        }

        return samples
    }

    private fun runSearch(query: String, limit: Int): List<String> {
        val db = dbHelper.readableDatabase
        val q = "%${query.trim().lowercase()}%"
        val uris = mutableListOf<String>()

        val sql =
            """
            SELECT canonical_uri
            FROM $TABLE_TRACKS
            WHERE search_tokens LIKE ?
            ORDER BY modified_sec DESC
            LIMIT ?
            """.trimIndent()

        db.rawQuery(sql, arrayOf(q, limit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                uris.add(cursor.getString(0))
            }
        }

        return uris
    }

    private fun buildQuery(sample: SampleTrack): String {
        return extractToken(sample.title)
            ?: extractToken(sample.artist)
            ?: extractToken(sample.album)
            ?: extractToken(sample.displayName)
            ?: extractToken(sample.relativePath.substringAfterLast('/'))
            ?: ""
    }

    private fun extractToken(value: String?): String? {
        if (value.isNullOrBlank()) {
            return null
        }

        return value
            .lowercase()
            .split(Regex("[^a-z0-9]+"))
            .firstOrNull { it.length >= 3 }
    }

    private data class SampleTrack(
        val uri: String,
        val title: String,
        val artist: String,
        val album: String,
        val displayName: String,
        val relativePath: String,
    )
}
