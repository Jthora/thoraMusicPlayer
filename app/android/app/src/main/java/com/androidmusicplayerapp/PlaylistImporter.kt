package com.androidmusicplayerapp

import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.ReactApplicationContext
import java.nio.charset.Charset
import java.util.Locale

class PlaylistImporter(
    private val reactApplicationContext: ReactApplicationContext,
    private val indexStore: LibraryIndexStore,
    private val persistence: PlaylistImportPersistence,
) {

    fun importPlaylistFile(uriString: String, sourceName: String?): PlaylistImportResult {
        val uri = Uri.parse(uriString)
        val name = sourceName?.ifBlank { null } ?: (uri.lastPathSegment ?: "playlist")
        val format = detectFormat(name)

        val content = readTextWithFallback(uri)
        val rawEntries = parsePlaylistEntries(content)
        val diagnostics = mutableListOf<PlaylistEntryDiagnostic>()
        val seenResolvedUris = mutableSetOf<String>()

        var resolvedCount = 0
        var unresolvedCount = 0
        var duplicateCount = 0
        var unsupportedCount = 0

        rawEntries.forEach { entry ->
            val resolution = resolveEntry(entry.value, uri)
            when (resolution.status) {
                "resolved" -> {
                    val resolvedUri = resolution.resolvedUri.orEmpty()
                    if (resolvedUri.isBlank()) {
                        unresolvedCount += 1
                        diagnostics.add(
                            PlaylistEntryDiagnostic(
                                lineNumber = entry.lineNumber,
                                entryText = entry.value,
                                status = "unresolved",
                                reasonCode = "EMPTY_RESOLUTION"
                            )
                        )
                    } else if (seenResolvedUris.contains(resolvedUri)) {
                        duplicateCount += 1
                        diagnostics.add(
                            PlaylistEntryDiagnostic(
                                lineNumber = entry.lineNumber,
                                entryText = entry.value,
                                status = "duplicate",
                                reasonCode = "DUPLICATE_ENTRY",
                                resolvedUri = resolvedUri
                            )
                        )
                    } else {
                        seenResolvedUris.add(resolvedUri)
                        resolvedCount += 1
                    }
                }

                "unsupported" -> {
                    unsupportedCount += 1
                    diagnostics.add(
                        PlaylistEntryDiagnostic(
                            lineNumber = entry.lineNumber,
                            entryText = entry.value,
                            status = "unsupported",
                            reasonCode = resolution.reasonCode
                        )
                    )
                }

                else -> {
                    unresolvedCount += 1
                    diagnostics.add(
                        PlaylistEntryDiagnostic(
                            lineNumber = entry.lineNumber,
                            entryText = entry.value,
                            status = "unresolved",
                            reasonCode = resolution.reasonCode
                        )
                    )
                }
            }
        }

        val result = PlaylistImportResult(
            sourceUri = uriString,
            sourceName = name,
            format = format,
            totalEntries = rawEntries.size,
            resolvedCount = resolvedCount,
            unresolvedCount = unresolvedCount,
            duplicateCount = duplicateCount,
            unsupportedCount = unsupportedCount,
            diagnostics = diagnostics,
            importedAtSec = System.currentTimeMillis() / 1000L
        )

        persistence.save(result)
        return result
    }

    fun getLatestImport(): PlaylistImportResult? {
        return persistence.getLatest()
    }

    private fun resolveEntry(entryValue: String, playlistUri: Uri): PlaylistResolution {
        val trimmed = entryValue.trim()
        if (trimmed.isBlank()) {
            return PlaylistResolution(status = "unsupported", reasonCode = "EMPTY_ENTRY")
        }

        val lowered = trimmed.lowercase(Locale.US)
        if (lowered.startsWith("http://") || lowered.startsWith("https://")) {
            return PlaylistResolution(status = "unsupported", reasonCode = "UNSUPPORTED_URI")
        }

        if (lowered.startsWith("content://") || lowered.startsWith("file://")) {
            val byCanonical = indexStore.resolvePlaylistCandidate(trimmed)
            if (byCanonical != null) {
                return PlaylistResolution(status = "resolved", reasonCode = "CANONICAL_MATCH", resolvedUri = byCanonical)
            }
            return PlaylistResolution(status = "unresolved", reasonCode = "NO_MATCH")
        }

        val normalized = normalizePath(trimmed)
        val byRelative = indexStore.resolvePlaylistRelativePath(normalized)
        if (byRelative != null) {
            return PlaylistResolution(status = "resolved", reasonCode = "RELATIVE_MATCH", resolvedUri = byRelative)
        }

        val maybeBaseName = normalized.substringAfterLast('/').ifBlank { normalized }
        val byFilename = indexStore.resolvePlaylistFilename(maybeBaseName)
        if (byFilename != null) {
            return PlaylistResolution(status = "resolved", reasonCode = "FILENAME_HEURISTIC", resolvedUri = byFilename)
        }

        val byPlaylistLocal = resolveRelativeToPlaylistDocument(normalized, playlistUri)
        if (byPlaylistLocal != null) {
            return PlaylistResolution(status = "resolved", reasonCode = "PLAYLIST_BASE_MATCH", resolvedUri = byPlaylistLocal)
        }

        return PlaylistResolution(status = "unresolved", reasonCode = "NO_MATCH")
    }

    private fun parsePlaylistEntries(content: String): List<PlaylistLine> {
        return content
            .lineSequence()
            .mapIndexedNotNull { index, raw ->
                val trimmed = raw.trim()
                when {
                    trimmed.isBlank() -> null
                    trimmed.startsWith("#") -> null
                    else -> PlaylistLine(lineNumber = index + 1, value = trimmed)
                }
            }
            .toList()
    }

    private fun readTextWithFallback(uri: Uri): String {
        val bytes = reactApplicationContext.contentResolver.openInputStream(uri)?.use { input ->
            input.readBytes()
        } ?: throw IllegalStateException("Playlist file cannot be opened")

        val utf8 = runCatching { bytes.toString(Charset.forName("UTF-8")) }.getOrNull()
        if (!utf8.isNullOrBlank()) {
            return utf8
        }

        return bytes.toString(Charset.forName("ISO-8859-1"))
    }

    private fun detectFormat(name: String): String {
        val lowered = name.lowercase(Locale.US)
        return when {
            lowered.endsWith(".m3u8") -> "m3u8"
            lowered.endsWith(".m3u") -> "m3u"
            else -> "m3u"
        }
    }

    private fun normalizePath(value: String): String {
        return value.replace('\\', '/').trim().trimStart('/')
    }

    private fun resolveRelativeToPlaylistDocument(entry: String, playlistUri: Uri): String? {
        val normalizedEntry = canonicalizeRelativePath(entry)
        if (normalizedEntry.isBlank()) {
            return null
        }

        val baseCandidates = mutableListOf<String>()
        val fromDocumentId = runCatching { DocumentsContract.getDocumentId(playlistUri) }.getOrNull()
        val fromPathSegment = playlistUri.lastPathSegment

        listOf(fromDocumentId, fromPathSegment)
            .filterNotNull()
            .forEach { raw ->
                val parent = raw.substringBeforeLast('/', "")
                if (parent.isNotBlank()) {
                    baseCandidates.add(parent)
                }
                val withoutVolume = parent.substringAfter(':', "")
                if (withoutVolume.isNotBlank()) {
                    baseCandidates.add(withoutVolume)
                }
            }

        return baseCandidates
            .map { base -> "$base/$normalizedEntry" }
            .map { canonicalizeRelativePath(it) }
            .firstNotNullOfOrNull { candidate ->
                indexStore.resolvePlaylistRelativePath(candidate)
            }
    }

    private fun canonicalizeRelativePath(value: String): String {
        val segments = value
            .replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." }

        val stack = ArrayDeque<String>()
        segments.forEach { segment ->
            if (segment == "..") {
                if (stack.isNotEmpty()) {
                    stack.removeLast()
                }
            } else {
                stack.addLast(segment)
            }
        }

        return stack.joinToString("/")
    }

    private data class PlaylistLine(
        val lineNumber: Int,
        val value: String,
    )
}
