package com.androidmusicplayerapp

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PlaybackControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val PREFS_NAME = "playback_modes"
        private const val KEY_END_MODE = "end_mode"
        private const val KEY_RANDOM_ENABLED = "random_enabled"
        private const val END_MODE_STOP = "stop"
        private const val END_MODE_REPEAT_ALL = "repeat_all"
        private const val END_MODE_REPEAT_ONE = "repeat_one"
    }

    override fun getName(): String = "PlaybackControl"

    @ReactMethod
    fun startPlaybackService(promise: Promise) {
        val appContext = reactApplicationContext
        val intent = Intent(appContext, PlaybackService::class.java)

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }
        }.onSuccess {
            promise.resolve(true)
        }.onFailure { error ->
            promise.reject("START_SERVICE_ERROR", error)
        }
    }

    @ReactMethod
    fun stopPlaybackService(promise: Promise) {
        val appContext = reactApplicationContext
        val intent = Intent(appContext, PlaybackService::class.java)

        runCatching {
            appContext.stopService(intent)
        }.onSuccess { stopped ->
            promise.resolve(stopped)
        }.onFailure { error ->
            promise.reject("STOP_SERVICE_ERROR", error)
        }
    }

    @ReactMethod
    fun play(promise: Promise) {
        sendPlaybackAction(PlaybackService.ACTION_PLAY, "PLAY_ACTION_ERROR", promise)
    }

    @ReactMethod
    fun pause(promise: Promise) {
        sendPlaybackAction(PlaybackService.ACTION_PAUSE, "PAUSE_ACTION_ERROR", promise)
    }

    @ReactMethod
    fun next(promise: Promise) {
        sendPlaybackAction(PlaybackService.ACTION_NEXT, "NEXT_ACTION_ERROR", promise)
    }

    @ReactMethod
    fun previous(promise: Promise) {
        sendPlaybackAction(PlaybackService.ACTION_PREVIOUS, "PREVIOUS_ACTION_ERROR", promise)
    }

    @ReactMethod
    fun setQueueTracks(tracks: ReadableArray, promise: Promise) {
        runCatching {
            val entries = mutableListOf<PlaybackService.QueueEntry>()
            for (index in 0 until tracks.size()) {
                val row = tracks.getMap(index) ?: continue
                val uri = row.getString("uri").orEmpty().trim()
                if (uri.isBlank()) {
                    continue
                }

                entries.add(
                    PlaybackService.QueueEntry(
                        uri = uri,
                        title = row.getString("title").orEmpty(),
                        artist = row.getString("artist").orEmpty(),
                        album = row.getString("album").orEmpty(),
                        displayName = row.getString("displayName").orEmpty(),
                        durationMs = row.getDouble("durationMs").toLong().coerceAtLeast(0L)
                    )
                )
            }

            PlaybackService.syncRuntimeQueueEntries(entries)
            true
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("SET_QUEUE_TRACKS_ERROR", error)
        }
    }

    @ReactMethod
    fun setQueueState(queueLength: Int, queueIndex: Int, promise: Promise) {
        runCatching {
            PlaybackService.syncRuntimeQueueState(queueLength, queueIndex)
            true
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("SET_QUEUE_STATE_ERROR", error)
        }
    }

    @ReactMethod
    fun setPlaybackProgress(positionMs: Double, durationMs: Double, promise: Promise) {
        runCatching {
            val safePosition = if (positionMs.isFinite()) positionMs.toLong() else 0L
            val safeDuration = if (durationMs.isFinite()) durationMs.toLong() else 0L
            PlaybackService.syncRuntimePlaybackProgress(safePosition, safeDuration)
            true
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("SET_PLAYBACK_PROGRESS_ERROR", error)
        }
    }

    @ReactMethod
    fun getPlaybackState(promise: Promise) {
        runCatching {
            val snapshot = PlaybackService.getRuntimeSnapshot()
            Arguments.createMap().apply {
                putBoolean("isPlaying", snapshot.isPlaying)
                putString("lastReason", snapshot.lastReason)
                putDouble("updatedAtSec", snapshot.updatedAtSec.toDouble())
                putDouble("queueLength", snapshot.queueLength.toDouble())
                putDouble("queueIndex", snapshot.queueIndex.toDouble())
                putDouble("positionMs", snapshot.positionMs.toDouble())
                putDouble("durationMs", snapshot.durationMs.toDouble())
            }
        }.onSuccess { state ->
            promise.resolve(state)
        }.onFailure { error ->
            promise.reject("PLAYBACK_STATE_ERROR", error)
        }
    }

    @ReactMethod
    fun setPlaybackModes(endMode: String, randomEnabled: Boolean, promise: Promise) {
        runCatching {
            val normalizedEndMode = normalizeEndMode(endMode)
            val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)
            prefs.edit()
                .putString(KEY_END_MODE, normalizedEndMode)
                .putBoolean(KEY_RANDOM_ENABLED, randomEnabled)
                .commit()
        }.onSuccess { committed ->
            promise.resolve(committed)
        }.onFailure { error ->
            promise.reject("SET_PLAYBACK_MODES_ERROR", error)
        }
    }

    @ReactMethod
    fun getPlaybackModes(promise: Promise) {
        runCatching {
            val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)
            Arguments.createMap().apply {
                putString(KEY_END_MODE, normalizeEndMode(prefs.getString(KEY_END_MODE, END_MODE_STOP) ?: END_MODE_STOP))
                putBoolean(KEY_RANDOM_ENABLED, prefs.getBoolean(KEY_RANDOM_ENABLED, false))
            }
        }.onSuccess { modes ->
            promise.resolve(modes)
        }.onFailure { error ->
            promise.reject("GET_PLAYBACK_MODES_ERROR", error)
        }
    }

    private fun sendPlaybackAction(action: String, errorCode: String, promise: Promise) {
        val appContext = reactApplicationContext
        val intent = Intent(appContext, PlaybackService::class.java).apply {
            this.action = action
        }

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }
        }.onSuccess {
            promise.resolve(true)
        }.onFailure { error ->
            promise.reject(errorCode, error)
        }
    }

    private fun normalizeEndMode(raw: String): String {
        return when (raw.trim().lowercase()) {
            END_MODE_REPEAT_ALL -> END_MODE_REPEAT_ALL
            END_MODE_REPEAT_ONE -> END_MODE_REPEAT_ONE
            else -> END_MODE_STOP
        }
    }
}
