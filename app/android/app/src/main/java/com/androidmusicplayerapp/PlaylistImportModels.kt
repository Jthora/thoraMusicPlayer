package com.androidmusicplayerapp

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
)

data class PlaylistEntryDiagnostic(
    val lineNumber: Int,
    val entryText: String,
    val status: String,
    val reasonCode: String,
    val resolvedUri: String? = null,
)

data class PlaylistResolution(
    val status: String,
    val reasonCode: String,
    val resolvedUri: String? = null,
)
