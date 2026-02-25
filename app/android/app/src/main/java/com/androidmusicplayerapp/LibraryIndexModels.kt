package com.androidmusicplayerapp

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

data class NormalizedTrack(
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val mimeType: String,
    val sizeBytes: Long,
    val modifiedSec: Long,
    val displayName: String,
    val relativePath: String
)

data class SyncDiagnostic(
    val level: String,
    val code: String,
    val root: String,
    val message: String
)

data class TrackPlayStats(
    val uri: String,
    val playCount: Int,
    val lastPlayedAtSec: Long,
    val lastCompletedAtSec: Long,
    val skipCount: Int,
)

fun ReadableMap.getStringOrEmpty(key: String): String =
    if (hasKey(key) && !isNull(key)) getString(key).orEmpty() else ""

fun ReadableMap.getStringOrDefault(key: String, fallback: String): String {
    val value = getStringOrEmpty(key)
    return if (value.isBlank()) fallback else value
}

fun ReadableMap.getLongOrZero(key: String): Long {
    if (!hasKey(key) || isNull(key)) {
        return 0L
    }

    return runCatching { getDouble(key).toLong() }.getOrDefault(0L)
}

fun TrackPlayStats.toWritableMap(): WritableMap {
    return Arguments.createMap().apply {
        putString("uri", uri)
        putDouble("playCount", playCount.toDouble())
        putDouble("lastPlayedAtSec", lastPlayedAtSec.toDouble())
        putDouble("lastCompletedAtSec", lastCompletedAtSec.toDouble())
        putDouble("skipCount", skipCount.toDouble())
    }
}
