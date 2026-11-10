package com.thoraplayer

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.google.common.util.concurrent.ListenableFuture

/**
 * JS bridge to [PlaybackService]. Holds a MediaController (main looper only), forwards commands,
 * and emits player state to JS:
 *  - ThoraPlaybackState: snapshot on any relevant player change (JS projects position from it)
 *  - ThoraQueueChanged:  the queue's contents changed; JS refetches with getQueue()
 *  - ThoraPlayerError:   an item failed (the service skips to the next one)
 */
@OptIn(UnstableApi::class)
class PlaybackControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val EVENT_STATE = "ThoraPlaybackState"
        const val EVENT_QUEUE = "ThoraQueueChanged"
        const val EVENT_ERROR = "ThoraPlayerError"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val mainExecutor = ContextCompat.getMainExecutor(reactContext)
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var queueRevision = 0

    override fun getName(): String = "PlaybackControl"

    override fun invalidate() {
        mainHandler.post {
            controllerFuture?.let { MediaController.releaseFuture(it) }
            controllerFuture = null
        }
        super.invalidate()
    }

    // ---- controller plumbing (main thread) --------------------------------------------------

    private fun connect(): ListenableFuture<MediaController> {
        controllerFuture?.let { return it }
        val token = SessionToken(reactApplicationContext, ComponentName(reactApplicationContext, PlaybackService::class.java))
        val future = MediaController.Builder(reactApplicationContext, token)
            .setApplicationLooper(Looper.getMainLooper())
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    controllerFuture = null // reconnect (and restart the service) on next use
                }
            })
            .buildAsync()
        controllerFuture = future
        future.addListener({
            runCatching { future.get() }
                .onSuccess { controller ->
                    controller.addListener(playerListener)
                    emit(EVENT_STATE, snapshot(controller))
                }
                .onFailure { if (controllerFuture === future) controllerFuture = null }
        }, mainExecutor)
        return future
    }

    private fun withController(promise: Promise, errorCode: String, block: (MediaController) -> Any?) {
        mainHandler.post { runWithController(promise, errorCode, block, retried = false) }
    }

    private fun runWithController(promise: Promise, errorCode: String, block: (MediaController) -> Any?, retried: Boolean) {
        val future = connect()
        future.addListener({
            try {
                val controller = future.get()
                if (!controller.isConnected && !retried) {
                    controllerFuture = null
                    runWithController(promise, errorCode, block, retried = true)
                    return@addListener
                }
                promise.resolve(block(controller))
            } catch (error: Exception) {
                if (controllerFuture === future) controllerFuture = null
                promise.reject(errorCode, error.cause ?: error)
            }
        }, mainExecutor)
    }

    private fun startPlayback(player: Player) {
        when (player.playbackState) {
            Player.STATE_IDLE -> player.prepare()
            Player.STATE_ENDED -> {
                // Whole queue finished (repeat off): start over from the first track in play order.
                val first = player.currentTimeline.getFirstWindowIndex(player.shuffleModeEnabled)
                if (first != C.INDEX_UNSET) player.seekToDefaultPosition(first)
            }
        }
        player.play()
    }

    // ---- commands ---------------------------------------------------------------------------

    @ReactMethod
    fun startPlaybackService(promise: Promise) {
        withController(promise, "START_SERVICE_ERROR") { true }
    }

    @ReactMethod
    fun stopPlaybackService(promise: Promise) {
        withController(promise, "STOP_SERVICE_ERROR") { controller ->
            controller.pause()
            true
        }
    }

    @ReactMethod
    fun play(promise: Promise) {
        withController(promise, "PLAY_ACTION_ERROR") { controller ->
            startPlayback(controller)
            true
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        withController(promise, "PAUSE_ACTION_ERROR") { controller ->
            controller.pause()
            true
        }
    }

    @ReactMethod
    fun togglePlayPause(promise: Promise) {
        withController(promise, "TOGGLE_ACTION_ERROR") { controller ->
            if (controller.playWhenReady && controller.playbackState != Player.STATE_ENDED) {
                controller.pause()
            } else {
                startPlayback(controller)
            }
            true
        }
    }

    @ReactMethod
    fun next(promise: Promise) {
        withController(promise, "NEXT_ACTION_ERROR") { controller ->
            controller.seekToNext()
            true
        }
    }

    @ReactMethod
    fun previous(promise: Promise) {
        // Standard behavior: restart the current track if more than ~3 s in, otherwise go back one.
        withController(promise, "PREVIOUS_ACTION_ERROR") { controller ->
            controller.seekToPrevious()
            true
        }
    }

    @ReactMethod
    fun seekTo(positionMs: Double, promise: Promise) {
        withController(promise, "SEEK_ERROR") { controller ->
            controller.seekTo(positionMs.toLongSafe())
            true
        }
    }

    @ReactMethod
    fun skipTo(index: Double, promise: Promise) {
        withController(promise, "SKIP_TO_ERROR") { controller ->
            val target = index.toInt()
            if (target in 0 until controller.mediaItemCount) {
                controller.seekTo(target, 0L)
                startPlayback(controller)
                true
            } else {
                false
            }
        }
    }

    @ReactMethod
    fun setQueue(tracks: ReadableArray, startIndex: Double, startPositionMs: Double, playWhenReady: Boolean, promise: Promise) {
        val items = parseTracks(tracks)
        withController(promise, "SET_QUEUE_ERROR") { controller ->
            if (items.isEmpty()) {
                controller.clearMediaItems()
                controller.stop()
                return@withController true
            }
            val index = startIndex.toInt().coerceIn(0, items.size - 1)
            controller.setMediaItems(items, index, startPositionMs.toLongSafe())
            controller.prepare()
            if (playWhenReady) controller.play() else controller.pause()
            true
        }
    }

    @ReactMethod
    fun insertQueueItems(index: Double, tracks: ReadableArray, promise: Promise) {
        val items = parseTracks(tracks)
        withController(promise, "INSERT_QUEUE_ERROR") { controller ->
            val at = index.toInt()
            if (at < 0 || at > controller.mediaItemCount) {
                controller.addMediaItems(items)
            } else {
                controller.addMediaItems(at, items)
            }
            true
        }
    }

    @ReactMethod
    fun moveQueueItem(fromIndex: Double, toIndex: Double, promise: Promise) {
        withController(promise, "MOVE_QUEUE_ERROR") { controller ->
            val from = fromIndex.toInt()
            val to = toIndex.toInt()
            val count = controller.mediaItemCount
            if (from in 0 until count && to in 0 until count && from != to) {
                controller.moveMediaItem(from, to)
                true
            } else {
                false
            }
        }
    }

    @ReactMethod
    fun removeQueueItem(index: Double, promise: Promise) {
        withController(promise, "REMOVE_QUEUE_ERROR") { controller ->
            val at = index.toInt()
            if (at in 0 until controller.mediaItemCount) {
                controller.removeMediaItem(at)
                true
            } else {
                false
            }
        }
    }

    @ReactMethod
    fun clearQueue(promise: Promise) {
        withController(promise, "CLEAR_QUEUE_ERROR") { controller ->
            controller.clearMediaItems()
            controller.stop()
            true
        }
    }

    @ReactMethod
    fun setRepeatMode(mode: String, promise: Promise) {
        withController(promise, "SET_REPEAT_ERROR") { controller ->
            controller.repeatMode = parseRepeatMode(mode)
            true
        }
    }

    @ReactMethod
    fun setShuffle(enabled: Boolean, promise: Promise) {
        withController(promise, "SET_SHUFFLE_ERROR") { controller ->
            controller.shuffleModeEnabled = enabled
            true
        }
    }

    /** Compatibility with the pre-Media3 JS API: endMode = stop | repeat_all | repeat_one. */
    @ReactMethod
    fun setPlaybackModes(endMode: String, randomEnabled: Boolean, promise: Promise) {
        withController(promise, "SET_PLAYBACK_MODES_ERROR") { controller ->
            controller.repeatMode = parseRepeatMode(endMode)
            controller.shuffleModeEnabled = randomEnabled
            true
        }
    }

    @ReactMethod
    fun getPlaybackModes(promise: Promise) {
        withController(promise, "GET_PLAYBACK_MODES_ERROR") { controller ->
            Arguments.createMap().apply {
                putString("endMode", when (controller.repeatMode) {
                    Player.REPEAT_MODE_ALL -> "repeat_all"
                    Player.REPEAT_MODE_ONE -> "repeat_one"
                    else -> "stop"
                })
                putBoolean("randomEnabled", controller.shuffleModeEnabled)
            }
        }
    }

    @ReactMethod
    fun getPlaybackState(promise: Promise) {
        withController(promise, "PLAYBACK_STATE_ERROR") { controller -> snapshot(controller) }
    }

    @ReactMethod
    fun getQueue(promise: Promise) {
        withController(promise, "GET_QUEUE_ERROR") { controller ->
            Arguments.createArray().apply {
                for (index in 0 until controller.mediaItemCount) {
                    pushMap(trackMap(controller.getMediaItemAt(index)))
                }
            }
        }
    }

    /** Required by NativeEventEmitter. Subscribing also connects, so events start flowing. */
    @ReactMethod
    fun addListener(eventName: String) {
        mainHandler.post { connect() }
    }

    @ReactMethod
    fun removeListeners(count: Double) {
    }

    // ---- events -----------------------------------------------------------------------------

    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_PLAY_WHEN_READY_CHANGED,
                    Player.EVENT_PLAYBACK_STATE_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_POSITION_DISCONTINUITY,
                    Player.EVENT_REPEAT_MODE_CHANGED,
                    Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                    Player.EVENT_TIMELINE_CHANGED,
                    Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
                    Player.EVENT_PLAYER_ERROR,
                )
            ) {
                emit(EVENT_STATE, snapshot(player))
            }
            if (events.contains(Player.EVENT_PLAYER_ERROR)) {
                val error = player.playerError
                emit(EVENT_ERROR, Arguments.createMap().apply {
                    putString("code", error?.errorCodeName ?: "UNKNOWN")
                    putString("message", error?.message ?: "Playback error")
                    putString("uri", player.currentMediaItem?.mediaId)
                    putDouble("queueIndex", player.currentMediaItemIndex.toDouble())
                })
            }
        }

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) {
                queueRevision += 1
                emit(EVENT_QUEUE, Arguments.createMap().apply {
                    putDouble("revision", queueRevision.toDouble())
                    putDouble("queueLength", timeline.windowCount.toDouble())
                })
            }
        }
    }

    private fun emit(name: String, payload: WritableMap) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext.emitDeviceEvent(name, payload)
        }
    }

    // ---- mapping ----------------------------------------------------------------------------

    private fun snapshot(player: Player): WritableMap = Arguments.createMap().apply {
        val count = player.mediaItemCount
        putBoolean("isPlaying", player.isPlaying)
        putBoolean("playWhenReady", player.playWhenReady)
        putString("playbackState", when (player.playbackState) {
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> "ready"
            Player.STATE_ENDED -> "ended"
            else -> "idle"
        })
        putDouble("positionMs", player.currentPosition.coerceAtLeast(0L).toDouble())
        putDouble("durationMs", player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.toDouble() ?: 0.0)
        putDouble("capturedAtEpochMs", System.currentTimeMillis().toDouble())
        putDouble("queueIndex", if (count == 0) -1.0 else player.currentMediaItemIndex.toDouble())
        putDouble("queueLength", count.toDouble())
        putString("currentUri", player.currentMediaItem?.mediaId)
        putString("repeatMode", when (player.repeatMode) {
            Player.REPEAT_MODE_ALL -> "all"
            Player.REPEAT_MODE_ONE -> "one"
            else -> "off"
        })
        putBoolean("shuffle", player.shuffleModeEnabled)
        putDouble("speed", player.playbackParameters.speed.toDouble())
        putString("error", player.playerError?.errorCodeName)
    }

    private fun trackMap(item: MediaItem): WritableMap {
        val track = QueueItems.fromMediaItem(item)
        return Arguments.createMap().apply {
            putString("uri", track.uri)
            putString("title", track.title)
            putString("artist", track.artist)
            putString("album", track.album)
            putDouble("durationMs", track.durationMs.toDouble())
            putString("mimeType", track.mimeType)
            putDouble("sizeBytes", track.sizeBytes.toDouble())
            putDouble("dateModifiedEpochSeconds", track.dateModifiedEpochSeconds.toDouble())
            putString("displayName", track.displayName)
            putString("relativePath", track.relativePath)
        }
    }

    private fun parseTracks(tracks: ReadableArray): List<MediaItem> =
        (0 until tracks.size()).mapNotNull { index ->
            val row = tracks.getMap(index) ?: return@mapNotNull null
            val uri = row.stringOrEmpty("uri").trim()
            if (uri.isBlank()) return@mapNotNull null
            QueueItems.toMediaItem(
                QueueTrack(
                    uri = uri,
                    title = row.stringOrEmpty("title"),
                    artist = row.stringOrEmpty("artist"),
                    album = row.stringOrEmpty("album"),
                    displayName = row.stringOrEmpty("displayName"),
                    durationMs = row.longOrZero("durationMs"),
                    mimeType = row.stringOrEmpty("mimeType"),
                    sizeBytes = row.longOrZero("sizeBytes"),
                    dateModifiedEpochSeconds = row.longOrZero("dateModifiedEpochSeconds"),
                    relativePath = row.stringOrEmpty("relativePath"),
                )
            )
        }

    private fun parseRepeatMode(raw: String): Int = when (raw.trim().lowercase()) {
        "all", "repeat_all" -> Player.REPEAT_MODE_ALL
        "one", "repeat_one" -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    private fun ReadableMap.stringOrEmpty(key: String): String =
        if (hasKey(key) && getType(key) == ReadableType.String) getString(key).orEmpty() else ""

    private fun ReadableMap.longOrZero(key: String): Long =
        if (hasKey(key) && getType(key) == ReadableType.Number) getDouble(key).toLongSafe() else 0L

    private fun Double.toLongSafe(): Long = if (isFinite()) toLong().coerceAtLeast(0L) else 0L
}
