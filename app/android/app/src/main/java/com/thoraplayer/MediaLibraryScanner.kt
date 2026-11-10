package com.thoraplayer

import android.content.ContentUris
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

class MediaLibraryScanner(private val reactApplicationContext: ReactApplicationContext) {

    fun queryMediaStoreTracks(): MutableList<WritableMap> {
        val tracks = mutableListOf<WritableMap>()
        val resolver = reactApplicationContext.contentResolver
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM_ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH
        )
        val selection = "(" +
            "${MediaStore.Audio.Media.IS_MUSIC} != 0" +
            " OR ${MediaStore.Audio.Media.IS_MUSIC} IS NULL" +
            " OR ${MediaStore.Audio.Media.MIME_TYPE} LIKE 'audio/%'" +
            ")"
        val sortOrder = "${MediaStore.Audio.Media.DATE_MODIFIED} DESC"

        resolver.query(uri, projection, selection, null, sortOrder)?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumArtistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ARTIST)
            val albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val dateModifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
            val displayNameColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val relativePathColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idColumn)
                val contentUri = ContentUris.withAppendedId(uri, id)
                val artist = normalizeArtist(
                    artist = cursor.getString(artistColumn),
                    albumArtist = cursor.getString(albumArtistColumn)
                )
                val title = normalizeText(cursor.getString(titleColumn), "Unknown title")
                val album = normalizeText(cursor.getString(albumColumn), "Unknown album")

                tracks.add(
                    Arguments.createMap().apply {
                        putString("uri", contentUri.toString())
                        putString("title", title)
                        putString("artist", artist)
                        putString("album", album)
                        putDouble("durationMs", cursor.getLong(durationColumn).toDouble())
                        putString("mimeType", cursor.getString(mimeColumn) ?: "")
                        putDouble("sizeBytes", cursor.getLong(sizeColumn).toDouble())
                        putDouble("dateModifiedEpochSeconds", cursor.getLong(dateModifiedColumn).toDouble())
                        putString("displayName", cursor.getString(displayNameColumn) ?: "")
                        putString("relativePath", cursor.getString(relativePathColumn) ?: "")
                    }
                )
            }
        }

        return tracks
    }

    fun performSafScan(limitPerRoot: Int, roots: Set<String>): SafScanResult {
        val rootArray = Arguments.createArray()
        val diagnostics = Arguments.createArray()
        val tracks = Arguments.createArray()
        val trackMaps = mutableListOf<WritableMap>()
        val diagnosticRows = mutableListOf<SyncDiagnostic>()

        roots.forEach { root ->
            val rootUri = Uri.parse(root)
            rootArray.pushString(root)

            if (!hasPersistedReadGrant(rootUri)) {
                pushDiagnostic(diagnostics, diagnosticRows, "WARN", "REVOKED_GRANT", root, "Read grant is not currently persisted")
                return@forEach
            }

            val rootDoc = DocumentFile.fromTreeUri(reactApplicationContext, rootUri)
            if (rootDoc == null || !rootDoc.exists()) {
                pushDiagnostic(diagnostics, diagnosticRows, "ERROR", "ROOT_UNAVAILABLE", root, "SAF root cannot be accessed")
                return@forEach
            }

            val scannedCount = scanDocumentTree(rootDoc, root, limitPerRoot, tracks, diagnostics, trackMaps, diagnosticRows)
            pushDiagnostic(diagnostics, diagnosticRows, "INFO", "ROOT_SCAN_COMPLETE", root, "Scanned $scannedCount audio file(s)")
        }

        return SafScanResult(
            roots = rootArray,
            tracks = tracks,
            diagnostics = diagnostics,
            rootCount = roots.size,
            trackCount = tracks.size(),
            trackMaps = trackMaps,
            diagnosticRows = diagnosticRows
        )
    }

    fun applyQueueReadabilityFilter(result: WritableMap, anchorUri: String?): WritableMap {
        val folderPath = result.getString("folderPath") ?: ""
        val queue = result.getArray("queue") ?: Arguments.createArray()
        val filteredQueue = Arguments.createArray()
        val skippedDiagnostics = Arguments.createArray()

        var skippedCount = 0
        var unreadableCount = 0

        for (index in 0 until queue.size()) {
            val row = queue.getMap(index) ?: continue
            val uri = row.getString("uri").orEmpty().trim()

            if (uri.isBlank()) {
                skippedCount += 1
                skippedDiagnostics.pushMap(
                    Arguments.createMap().apply {
                        putString("level", "WARN")
                        putString("code", "UNRESOLVED_URI")
                        putString("root", folderPath)
                        putString("message", "Queue row skipped because URI is missing")
                    }
                )
                continue
            }

            if (!isTrackUriReadable(uri)) {
                skippedCount += 1
                unreadableCount += 1
                skippedDiagnostics.pushMap(
                    Arguments.createMap().apply {
                        putString("level", "WARN")
                        putString("code", "UNREADABLE_URI")
                        putString("root", folderPath)
                        putString("message", "Queue row skipped because URI is unreadable: $uri")
                    }
                )
                continue
            }

            filteredQueue.pushMap(row)
        }

        val resolvedAnchorIndex = if (!anchorUri.isNullOrBlank()) {
            var match = 0
            var found = false
            for (index in 0 until filteredQueue.size()) {
                val row = filteredQueue.getMap(index)
                if (row?.getString("uri") == anchorUri) {
                    match = index
                    found = true
                    break
                }
            }
            if (found) match else 0
        } else {
            0
        }

        result.putArray("queue", filteredQueue)
        result.putDouble("queueLength", filteredQueue.size().toDouble())
        result.putDouble("anchorIndex", resolvedAnchorIndex.toDouble())
        result.putArray("skippedDiagnostics", skippedDiagnostics)
        result.putDouble("skippedCount", skippedCount.toDouble())
        result.putDouble("unreadableCount", unreadableCount.toDouble())
        return result
    }

    private fun scanDocumentTree(
        root: DocumentFile,
        rootUri: String,
        limitPerRoot: Int,
        tracks: WritableArray,
        diagnostics: WritableArray,
        trackMaps: MutableList<WritableMap>,
        diagnosticRows: MutableList<SyncDiagnostic>
    ): Int {
        val stack = ArrayDeque<Pair<DocumentFile, Int>>()
        stack.add(root to 0)
        var scanned = 0
        var visitedNodes = 0
        var maxDepthSeen = 0
        val maxNodesPerRoot = maxOf(limitPerRoot * 200, 15000)

        while (stack.isNotEmpty() && scanned < limitPerRoot) {
            val (current, depth) = stack.removeLast()
            visitedNodes += 1
            if (depth > maxDepthSeen) {
                maxDepthSeen = depth
            }

            if (visitedNodes > maxNodesPerRoot) {
                pushDiagnostic(
                    diagnostics,
                    diagnosticRows,
                    "WARN",
                    "ROOT_NODE_BUDGET_REACHED",
                    rootUri,
                    "Visited node budget reached ($maxNodesPerRoot) before scan completed"
                )
                break
            }

            if (!current.exists() || !current.canRead()) {
                pushDiagnostic(diagnostics, diagnosticRows, "WARN", "UNREADABLE_NODE", rootUri, current.uri.toString())
                continue
            }

            if (current.isDirectory) {
                val children = runCatching { current.listFiles().toList() }
                    .getOrElse {
                        pushDiagnostic(diagnostics, diagnosticRows, "WARN", "LIST_CHILDREN_FAILED", rootUri, current.uri.toString())
                        emptyList()
                    }

                val childDirectories = children
                    .filter { it.isDirectory }
                    .sortedBy { it.name.orEmpty().lowercase() }
                val childFiles = children
                    .filter { !it.isDirectory }
                    .sortedBy { it.name.orEmpty().lowercase() }

                childFiles.asReversed().forEach { childFile ->
                    stack.add(childFile to (depth + 1))
                }
                childDirectories.asReversed().forEach { childDirectory ->
                    stack.add(childDirectory to (depth + 1))
                }
                continue
            }

            if (!isLikelyAudio(current)) {
                continue
            }

            val track = Arguments.createMap().apply {
                putString("uri", current.uri.toString())
                putString("title", current.name ?: "Unknown title")
                putString("artist", "Unknown artist")
                putString("album", "Unknown album")
                putDouble("durationMs", 0.0)
                putString("mimeType", current.type ?: "")
                putDouble("sizeBytes", current.length().toDouble())
                putDouble("dateModifiedEpochSeconds", (current.lastModified() / 1000L).toDouble())
                putString("displayName", current.name ?: "")
                putString("relativePath", extractRelativePath(root.uri, current.uri))
            }

            tracks.pushMap(track)
            trackMaps.add(track)

            scanned += 1
        }

        pushDiagnostic(
            diagnostics,
            diagnosticRows,
            "INFO",
            "ROOT_TRAVERSAL_STATS",
            rootUri,
            "Visited $visitedNodes node(s), maxDepth=$maxDepthSeen"
        )

        if (scanned >= limitPerRoot) {
            pushDiagnostic(diagnostics, diagnosticRows, "WARN", "ROOT_LIMIT_REACHED", rootUri, "Reached limitPerRoot=$limitPerRoot")
        }

        return scanned
    }

    private fun isLikelyAudio(file: DocumentFile): Boolean {
        val mime = file.type.orEmpty().lowercase()
        if (mime.startsWith("audio/")) {
            return true
        }

        val name = file.name.orEmpty().lowercase()
        return name.endsWith(".mp3") ||
            name.endsWith(".m4a") ||
            name.endsWith(".aac") ||
            name.endsWith(".flac") ||
            name.endsWith(".wav") ||
            name.endsWith(".ogg")
    }

    private fun extractRelativePath(rootUri: Uri, fileUri: Uri): String {
        val rootDocId = DocumentsContract.getTreeDocumentId(rootUri)
        val fileDocId = runCatching { DocumentsContract.getDocumentId(fileUri) }.getOrNull() ?: return ""
        return fileDocId.removePrefix(rootDocId).removePrefix("/")
    }

    private fun hasPersistedReadGrant(uri: Uri): Boolean {
        return reactApplicationContext.contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission
        }
    }

    private fun normalizeArtist(artist: String?, albumArtist: String?): String {
        val normalizedArtist = normalizeOptionalText(artist)
        if (normalizedArtist != null) {
            return normalizedArtist
        }

        val normalizedAlbumArtist = normalizeOptionalText(albumArtist)
        if (normalizedAlbumArtist != null) {
            return normalizedAlbumArtist
        }

        return "Unknown artist"
    }

    private fun normalizeText(value: String?, fallback: String): String {
        return normalizeOptionalText(value) ?: fallback
    }

    private fun normalizeOptionalText(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isBlank()) {
            return null
        }

        val normalized = trimmed.lowercase()
        if (normalized == "<unknown>" || normalized == "unknown" || normalized == "unknown artist" || normalized == "unknown album") {
            return null
        }

        return trimmed
    }

    private fun isTrackUriReadable(uriString: String): Boolean {
        val parsed = runCatching { Uri.parse(uriString) }.getOrNull() ?: return false
        return runCatching {
            reactApplicationContext.contentResolver
                .openAssetFileDescriptor(parsed, "r")
                ?.use { descriptor ->
                    descriptor.length
                } != null
        }.getOrDefault(false)
    }
}
