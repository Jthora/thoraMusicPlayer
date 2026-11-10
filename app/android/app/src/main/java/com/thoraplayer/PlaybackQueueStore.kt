package com.thoraplayer

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.AtomicFile
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A queue entry: the MediaStoreTrack fields JS knows about, carried in MediaItem metadata extras. */
data class QueueTrack(
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val displayName: String,
    val durationMs: Long,
    val mimeType: String,
    val sizeBytes: Long,
    val dateModifiedEpochSeconds: Long,
    val relativePath: String,
)

object QueueItems {
    const val EXTRA_DURATION_MS = "thora.durationMs"
    private const val EXTRA_DISPLAY_NAME = "thora.displayName"
    private const val EXTRA_MIME_TYPE = "thora.mimeType"
    private const val EXTRA_SIZE_BYTES = "thora.sizeBytes"
    private const val EXTRA_MODIFIED_SEC = "thora.dateModifiedEpochSeconds"
    private const val EXTRA_RELATIVE_PATH = "thora.relativePath"

    fun toMediaItem(track: QueueTrack): MediaItem {
        val extras = Bundle().apply {
            putLong(EXTRA_DURATION_MS, track.durationMs)
            putString(EXTRA_DISPLAY_NAME, track.displayName)
            putString(EXTRA_MIME_TYPE, track.mimeType)
            putLong(EXTRA_SIZE_BYTES, track.sizeBytes)
            putLong(EXTRA_MODIFIED_SEC, track.dateModifiedEpochSeconds)
            putString(EXTRA_RELATIVE_PATH, track.relativePath)
        }
        val title = track.title.ifBlank { track.displayName.ifBlank { "Unknown title" } }
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(track.artist.ifBlank { null })
            .setAlbumTitle(track.album.ifBlank { null })
            .setIsPlayable(true)
            .setIsBrowsable(false)
            .setExtras(extras)
            .build()
        return MediaItem.Builder()
            .setMediaId(track.uri)
            .setUri(Uri.parse(track.uri))
            .setMediaMetadata(metadata)
            .build()
    }

    fun fromMediaItem(item: MediaItem): QueueTrack {
        val metadata = item.mediaMetadata
        val extras = metadata.extras
        return QueueTrack(
            uri = item.mediaId,
            title = metadata.title?.toString().orEmpty(),
            artist = metadata.artist?.toString().orEmpty(),
            album = metadata.albumTitle?.toString().orEmpty(),
            displayName = extras?.getString(EXTRA_DISPLAY_NAME).orEmpty(),
            durationMs = extras?.getLong(EXTRA_DURATION_MS) ?: 0L,
            mimeType = extras?.getString(EXTRA_MIME_TYPE).orEmpty(),
            sizeBytes = extras?.getLong(EXTRA_SIZE_BYTES) ?: 0L,
            dateModifiedEpochSeconds = extras?.getLong(EXTRA_MODIFIED_SEC) ?: 0L,
            relativePath = extras?.getString(EXTRA_RELATIVE_PATH).orEmpty(),
        )
    }

    fun durationOf(item: MediaItem): Long = item.mediaMetadata.extras?.getLong(EXTRA_DURATION_MS) ?: 0L

    /** Items from controllers (system UI, Bluetooth) may arrive without a URI; the mediaId is the content URI. */
    fun resolve(item: MediaItem): MediaItem =
        if (item.localConfiguration != null || item.mediaId.isBlank()) item
        else item.buildUpon().setUri(Uri.parse(item.mediaId)).build()
}

/**
 * Persists the playback queue so it survives process death and powers playback resumption.
 * The track list lives in an atomically written JSON file (rewritten only when the queue changes);
 * index, position and modes live in SharedPreferences (cheap, written often).
 */
class PlaybackQueueStore(context: Context) {
    data class Saved(
        val tracks: List<QueueTrack>,
        val index: Int,
        val positionMs: Long,
        val repeatMode: Int,
        val shuffle: Boolean,
    )

    private val appContext = context.applicationContext
    private val queueFile = AtomicFile(File(appContext.filesDir, "playback_queue.json"))
    private val prefs = appContext.getSharedPreferences("playback_state", Context.MODE_PRIVATE)

    fun saveQueue(tracks: List<QueueTrack>) {
        val json = JSONArray()
        tracks.forEach { track ->
            json.put(
                JSONObject()
                    .put("u", track.uri)
                    .put("t", track.title)
                    .put("a", track.artist)
                    .put("al", track.album)
                    .put("n", track.displayName)
                    .put("d", track.durationMs)
                    .put("m", track.mimeType)
                    .put("s", track.sizeBytes)
                    .put("mod", track.dateModifiedEpochSeconds)
                    .put("p", track.relativePath)
            )
        }
        val stream = queueFile.startWrite()
        try {
            stream.write(json.toString().toByteArray(Charsets.UTF_8))
            queueFile.finishWrite(stream)
        } catch (error: Exception) {
            queueFile.failWrite(stream)
            throw error
        }
    }

    fun savePosition(index: Int, positionMs: Long) {
        prefs.edit().putInt(KEY_INDEX, index).putLong(KEY_POSITION, positionMs.coerceAtLeast(0L)).apply()
    }

    fun saveModes(repeatMode: Int, shuffle: Boolean) {
        prefs.edit().putInt(KEY_REPEAT, repeatMode).putBoolean(KEY_SHUFFLE, shuffle).apply()
    }

    fun load(): Saved {
        val tracks = runCatching { parseTracks(String(queueFile.readFully(), Charsets.UTF_8)) }.getOrDefault(emptyList())
        val (repeat, shuffle) = loadModes()
        return Saved(
            tracks = tracks,
            index = prefs.getInt(KEY_INDEX, 0),
            positionMs = prefs.getLong(KEY_POSITION, 0L),
            repeatMode = repeat,
            shuffle = shuffle,
        )
    }

    private fun loadModes(): Pair<Int, Boolean> {
        if (prefs.contains(KEY_REPEAT)) {
            return prefs.getInt(KEY_REPEAT, Player.REPEAT_MODE_OFF) to prefs.getBoolean(KEY_SHUFFLE, false)
        }
        // One-time migration from the pre-Media3 "playback_modes" preferences.
        val legacy = appContext.getSharedPreferences("playback_modes", Context.MODE_PRIVATE)
        val repeat = when (legacy.getString("end_mode", "stop")) {
            "repeat_all" -> Player.REPEAT_MODE_ALL
            "repeat_one" -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
        return repeat to legacy.getBoolean("random_enabled", false)
    }

    private fun parseTracks(raw: String): List<QueueTrack> {
        val json = JSONArray(raw)
        return (0 until json.length()).mapNotNull { index ->
            val row = json.optJSONObject(index) ?: return@mapNotNull null
            val uri = row.optString("u")
            if (uri.isBlank()) return@mapNotNull null
            QueueTrack(
                uri = uri,
                title = row.optString("t"),
                artist = row.optString("a"),
                album = row.optString("al"),
                displayName = row.optString("n"),
                durationMs = row.optLong("d"),
                mimeType = row.optString("m"),
                sizeBytes = row.optLong("s"),
                dateModifiedEpochSeconds = row.optLong("mod"),
                relativePath = row.optString("p"),
            )
        }
    }

    private companion object {
        const val KEY_INDEX = "index"
        const val KEY_POSITION = "positionMs"
        const val KEY_REPEAT = "repeatMode"
        const val KEY_SHUFFLE = "shuffle"
    }
}
