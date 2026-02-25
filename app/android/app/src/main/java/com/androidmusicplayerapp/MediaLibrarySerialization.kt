package com.androidmusicplayerapp

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

fun buildIndexResultMap(
    items: List<WritableMap>,
    totalCount: Int,
    offset: Int,
    nextOffset: Int,
    hasMore: Boolean,
    summary: LibraryIndexStore.UpsertSummary
): WritableMap {
    val itemArray = Arguments.createArray().apply {
        items.forEach { pushMap(it) }
    }

    return Arguments.createMap().apply {
        putArray("items", itemArray)
        putDouble("totalCount", totalCount.toDouble())
        putDouble("offset", offset.toDouble())
        putDouble("nextOffset", nextOffset.toDouble())
        putBoolean("hasMore", hasMore)
        putMap("indexSummary", summary.toWritableMap())
    }
}

fun LibraryIndexStore.UpsertSummary.toWritableMap(): WritableMap = Arguments.createMap().apply {
    putDouble("scanned", scanned.toDouble())
    putDouble("inserted", inserted.toDouble())
    putDouble("updated", updated.toDouble())
    putDouble("duplicate", duplicate.toDouble())
    putDouble("skipped", skipped.toDouble())
    putDouble("removed", removed.toDouble())
    putDouble("snapshotId", snapshotId.toDouble())
    putString("coverageMode", coverageMode)
}

data class SafScanResult(
    val roots: WritableArray,
    val tracks: WritableArray,
    val diagnostics: WritableArray,
    val rootCount: Int,
    val trackCount: Int,
    val trackMaps: List<WritableMap>,
    val diagnosticRows: List<SyncDiagnostic>
) {
    fun toWritableMap() = Arguments.createMap().apply {
        putArray("roots", roots)
        putArray("tracks", tracks)
        putArray("diagnostics", diagnostics)
        putDouble("rootCount", rootCount.toDouble())
        putDouble("trackCount", trackCount.toDouble())
    }
}

fun pushDiagnostic(
    diagnosticsArray: WritableArray,
    diagnosticRows: MutableList<SyncDiagnostic>,
    level: String,
    code: String,
    root: String,
    message: String
) {
    diagnosticsArray.pushMap(Arguments.createMap().apply {
        putString("level", level)
        putString("code", code)
        putString("root", root)
        putString("message", message)
    })

    diagnosticRows.add(
        SyncDiagnostic(
            level = level,
            code = code,
            root = root,
            message = message
        )
    )
}

fun PlaylistImportResult.toWritableMap(): WritableMap = Arguments.createMap().apply {
    putString("sourceUri", sourceUri)
    putString("sourceName", sourceName)
    putString("format", format)
    putDouble("totalEntries", totalEntries.toDouble())
    putDouble("resolvedCount", resolvedCount.toDouble())
    putDouble("unresolvedCount", unresolvedCount.toDouble())
    putDouble("duplicateCount", duplicateCount.toDouble())
    putDouble("unsupportedCount", unsupportedCount.toDouble())
    putDouble("importedAtSec", importedAtSec.toDouble())
    putArray(
        "diagnostics",
        Arguments.createArray().apply {
            diagnostics.forEach { diagnostic ->
                pushMap(diagnostic.toWritableMap())
            }
        }
    )
}

fun PlaylistEntryDiagnostic.toWritableMap(): WritableMap = Arguments.createMap().apply {
    putDouble("lineNumber", lineNumber.toDouble())
    putString("entryText", entryText)
    putString("status", status)
    putString("reasonCode", reasonCode)
    putString("resolvedUri", resolvedUri)
}
