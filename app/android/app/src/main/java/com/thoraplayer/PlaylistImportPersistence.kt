package com.thoraplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class PlaylistImportPersistence(context: Context) {

    companion object {
        private const val PREFS_NAME = "playlist_imports"
        private const val KEY_IMPORTS = "imports_history"
        private const val MAX_HISTORY = 25
        // A big unmatched playlist must not bloat SharedPreferences (read into memory on every launch).
        private const val MAX_STORED_DIAGNOSTICS = 200
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(result: PlaylistImportResult) {
        val existing = getHistoryJsonArray()
        val next = JSONArray()
        next.put(toJson(result))

        for (index in 0 until existing.length()) {
            if (next.length() >= MAX_HISTORY) {
                break
            }
            next.put(existing.getJSONObject(index))
        }

        val commitOk = prefs.edit().putString(KEY_IMPORTS, next.toString()).commit()
        if (!commitOk) {
            throw IllegalStateException("PLAYLIST_IMPORT_PERSISTENCE_WRITE_FAILED")
        }
    }

    fun getLatest(): PlaylistImportResult? {
        val existing = getHistoryJsonArray()
        if (existing.length() == 0) {
            return null
        }

        return fromJson(existing.getJSONObject(0))
    }

    private fun getHistoryJsonArray(): JSONArray {
        val raw = prefs.getString(KEY_IMPORTS, "[]") ?: "[]"
        return runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
    }

    private fun toJson(result: PlaylistImportResult): JSONObject {
        val diagnosticsArray = JSONArray().apply {
            result.diagnostics.take(MAX_STORED_DIAGNOSTICS).forEach { diagnostic ->
                put(
                    JSONObject().apply {
                        put("lineNumber", diagnostic.lineNumber)
                        put("entryText", diagnostic.entryText)
                        put("status", diagnostic.status)
                        put("reasonCode", diagnostic.reasonCode)
                        put("resolvedUri", diagnostic.resolvedUri)
                    }
                )
            }
        }

        return JSONObject().apply {
            put("sourceUri", result.sourceUri)
            put("sourceName", result.sourceName)
            put("format", result.format)
            put("totalEntries", result.totalEntries)
            put("resolvedCount", result.resolvedCount)
            put("unresolvedCount", result.unresolvedCount)
            put("duplicateCount", result.duplicateCount)
            put("unsupportedCount", result.unsupportedCount)
            put("diagnostics", diagnosticsArray)
            put("importedAtSec", result.importedAtSec)
            result.playlistId?.let { put("playlistId", it) }
            result.playlistName?.let { put("playlistName", it) }
        }
    }

    private fun fromJson(json: JSONObject): PlaylistImportResult {
        val diagnostics = mutableListOf<PlaylistEntryDiagnostic>()
        val diagnosticsJson = json.optJSONArray("diagnostics") ?: JSONArray()

        for (index in 0 until diagnosticsJson.length()) {
            val row = diagnosticsJson.optJSONObject(index) ?: continue
            val resolvedUri =
                if (row.has("resolvedUri") && !row.isNull("resolvedUri")) {
                    row.optString("resolvedUri", "")
                } else {
                    null
                }
            diagnostics.add(
                PlaylistEntryDiagnostic(
                    lineNumber = row.optInt("lineNumber", 0),
                    entryText = row.optString("entryText", ""),
                    status = row.optString("status", "unresolved"),
                    reasonCode = row.optString("reasonCode", "UNKNOWN"),
                    resolvedUri = resolvedUri
                )
            )
        }

        return PlaylistImportResult(
            sourceUri = json.optString("sourceUri", ""),
            sourceName = json.optString("sourceName", "playlist"),
            format = json.optString("format", "m3u"),
            totalEntries = json.optInt("totalEntries", 0),
            resolvedCount = json.optInt("resolvedCount", 0),
            unresolvedCount = json.optInt("unresolvedCount", 0),
            duplicateCount = json.optInt("duplicateCount", 0),
            unsupportedCount = json.optInt("unsupportedCount", 0),
            diagnostics = diagnostics,
            importedAtSec = json.optLong("importedAtSec", 0L),
            playlistId = if (json.has("playlistId")) json.optLong("playlistId") else null,
            playlistName = json.optString("playlistName", "").ifBlank { null },
        )
    }
}
