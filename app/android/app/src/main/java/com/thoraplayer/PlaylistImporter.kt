package com.thoraplayer

import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.facebook.react.bridge.ReactApplicationContext

/**
 * Imports a playlist file (m3u/m3u8/pls/xspf) picked through the system file picker:
 * parses it, matches every entry against the library index ([PlaylistEntryResolver]) and
 * creates the playlist (or replaces its tracks when one with the same name exists, so
 * re-importing a repaired playlist refreshes it). Entries that can't be matched are reported,
 * never guessed.
 */
class PlaylistImporter(
    private val reactApplicationContext: ReactApplicationContext,
    private val indexStore: LibraryIndexStore,
    private val persistence: PlaylistImportPersistence,
    private val playlistStore: UserPlaylistStore,
) {
    fun importPlaylistFile(uriString: String, sourceName: String?): PlaylistImportResult {
        val uri = Uri.parse(uriString)
        val fileName = queryDisplayName(uri)
            ?: sourceName?.substringAfterLast('/')?.ifBlank { null }
            ?: uri.lastPathSegment?.substringAfterLast('/')
            ?: "playlist.m3u"

        val bytes = reactApplicationContext.contentResolver.openInputStream(uri)?.use { input ->
            val data = input.readBytes()
            require(data.size <= MAX_PLAYLIST_BYTES) { "PLAYLIST_TOO_LARGE" }
            data
        } ?: throw IllegalStateException("PLAYLIST_UNREADABLE")
        val parsed = PlaylistFileParser.parse(PlaylistFileParser.decode(bytes), fileName)

        val playlistFolder = playlistFolderOf(uri)
        val resolver = PlaylistEntryResolver(indexStore.loadPlaylistMatchTracks(), playlistFolder)
        val diagnostics = mutableListOf<PlaylistEntryDiagnostic>()
        val matched = mutableListOf<PlaylistLibraryTrack>()
        val seen = mutableSetOf<String>()
        val reasons = mutableMapOf<String, Int>()
        var unresolved = 0
        var unsupported = 0
        var duplicates = 0

        parsed.entries.forEach { entry ->
            val result = resolver.resolve(entry)
            reasons[result.reasonCode] = (reasons[result.reasonCode] ?: 0) + 1
            val track = result.track
            when {
                result.status == "unsupported" -> {
                    unsupported += 1
                    diagnostics.add(PlaylistEntryDiagnostic(entry.lineNumber, entry.location, "unsupported", result.reasonCode))
                }
                track == null -> {
                    unresolved += 1
                    diagnostics.add(PlaylistEntryDiagnostic(entry.lineNumber, describe(entry), "unresolved", result.reasonCode))
                }
                !seen.add(track.uri) -> {
                    duplicates += 1
                    diagnostics.add(PlaylistEntryDiagnostic(entry.lineNumber, entry.location, "duplicate", "DUPLICATE_ENTRY", track.uri))
                }
                else -> matched.add(track)
            }
        }

        val playlistName = playlistNameFor(parsed.name, fileName, playlistFolder)
        val playlistId = if (matched.isNotEmpty()) playlistStore.replacePlaylistTracks(playlistName, matched) else null

        val result = PlaylistImportResult(
            sourceUri = uriString,
            sourceName = fileName,
            format = parsed.format,
            totalEntries = parsed.entries.size,
            resolvedCount = matched.size,
            unresolvedCount = unresolved,
            duplicateCount = duplicates,
            unsupportedCount = unsupported,
            diagnostics = diagnostics,
            importedAtSec = System.currentTimeMillis() / 1000L,
            playlistId = playlistId,
            playlistName = if (playlistId != null) playlistName else null,
        )
        persistence.save(result)
        ThoraDiagnostics.log(
            if (matched.isEmpty() && parsed.entries.isNotEmpty()) "warn" else "info",
            "playlist",
            "import",
            mapOf(
                "file" to fileName,
                "playlist" to result.playlistName,
                "entries" to parsed.entries.size,
                "matched" to matched.size,
                "unresolved" to unresolved,
                "unsupported" to unsupported,
                "duplicates" to duplicates,
                "reasons" to reasons.entries.sortedByDescending { it.value }.joinToString(",") { "${it.key}=${it.value}" },
                "firstUnresolved" to diagnostics.filter { it.status == "unresolved" }.take(5).joinToString(" | ") { it.entryText.take(120) },
            ),
        )
        return result
    }

    fun getLatestImport(): PlaylistImportResult? = persistence.getLatest()

    private fun describe(entry: ParsedPlaylistEntry): String {
        val tags = listOfNotNull(entry.artist, entry.title).joinToString(" - ")
        return if (tags.isBlank()) entry.location else "${entry.location} [$tags]"
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        reactApplicationContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.ifBlank { null } else null
        }
    }.getOrNull()

    /** The playlist's own folder on the device, e.g. "Music/Thora/_playlists", for relative entries. */
    private fun playlistFolderOf(uri: Uri): String? {
        val documentId = runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull() ?: return null
        val path = when {
            documentId.startsWith("raw:") -> documentId.removePrefix("raw:").let { raw ->
                DEVICE_ROOTS.firstOrNull { raw.startsWith(it) }?.let { raw.removePrefix(it) }
            }
            documentId.startsWith("primary:") -> documentId.removePrefix("primary:")
            else -> null // e.g. "msf:123": no path; matching falls back to path suffixes and tags
        } ?: return null
        return path.substringBeforeLast('/', "").ifBlank { null }
    }

    private fun playlistNameFor(declared: String?, fileName: String, folder: String?): String {
        val base = declared?.trim()?.ifBlank { null }
            ?: fileName.substringBeforeLast('.').let { stem ->
                // Spotify exports are "<Playlist_Name>/playlist.m3u8": the folder is the name.
                if (stem.equals("playlist", ignoreCase = true)) folder?.substringAfterLast('/') ?: stem else stem
            }
        val cleaned = base.replace('_', ' ').replace(Regex("\\s+"), " ").trim().ifBlank { "Imported playlist" }
        return cleaned.take(MAX_NAME)
    }

    private companion object {
        const val MAX_PLAYLIST_BYTES = 8 * 1024 * 1024
        const val MAX_NAME = 80
        val DEVICE_ROOTS = listOf("/storage/emulated/0/", "/sdcard/")
    }
}
