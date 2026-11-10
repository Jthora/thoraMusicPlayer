package com.thoraplayer

data class PlaylistImportResult(
    val sourceUri: String,
    val sourceName: String,
    val format: String,
    val totalEntries: Int,
    val resolvedCount: Int,
    val unresolvedCount: Int,
    val duplicateCount: Int,
    val unsupportedCount: Int,
    val diagnostics: List<PlaylistEntryDiagnostic>,
    val importedAtSec: Long,
    /** The playlist created or refreshed by this import; null when no entry matched. */
    val playlistId: Long? = null,
    val playlistName: String? = null,
)

data class PlaylistEntryDiagnostic(
    val lineNumber: Int,
    val entryText: String,
    val status: String,
    val reasonCode: String,
    val resolvedUri: String? = null,
)

