package com.thoraplayer

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Owns playback: ExoPlayer + MediaSession. The queue, current index, repeat/shuffle and position
 * all live here; JS controls it through [PlaybackControlModule]'s MediaController and mirrors
 * state from events. System UI, the lock screen, Bluetooth and the notification talk to the same
 * session, so every control path drives the same player.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var queueStore: PlaybackQueueStore
    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var consecutiveErrors = 0
    private var erroredMediaId: String? = null
    private var startedKey: String? = null

    // Start latency: from a play request / track change until audio is actually playing.
    private var startRequestedAtMs = 0L
    private var startReason = ""

    private fun markStartRequested(reason: String) {
        startRequestedAtMs = SystemClock.elapsedRealtime()
        startReason = reason
    }

    private val periodicSave = object : Runnable {
        override fun run() {
            if (player.isPlaying) {
                savePosition()
            }
            mainHandler.postDelayed(this, POSITION_SAVE_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        queueStore = PlaybackQueueStore(this)
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus= */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
        player.addListener(playerListener)

        setMediaNotificationProvider(
            DefaultMediaNotificationProvider(this).apply { setSmallIcon(R.drawable.ic_music_note) }
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(buildSessionActivity())
            .setCallback(sessionCallback)
            .build()

        restoreQueue()
        mainHandler.postDelayed(periodicSave, POSITION_SAVE_INTERVAL_MS)
        ThoraDiagnostics.log("info", "playback", "service_create", mapOf("restoredTracks" to player.mediaItemCount))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away keeps music going; if nothing is playing, don't linger as a service.
        val ongoing = isPlaybackOngoing
        ThoraDiagnostics.log("info", "playback", "task_removed", mapOf("keepPlaying" to ongoing))
        if (!ongoing) {
            pauseAllPlayersAndStopSelf()
        }
    }

    override fun onDestroy() {
        ThoraDiagnostics.log("info", "playback", "service_destroy")
        mainHandler.removeCallbacks(periodicSave)
        if (this::player.isInitialized) {
            savePosition()
        }
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        io.shutdown()
        super.onDestroy()
    }

    private fun buildSessionActivity(): PendingIntent {
        val intent = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun restoreQueue() {
        val saved = queueStore.load()
        player.repeatMode = saved.repeatMode
        player.shuffleModeEnabled = saved.shuffle
        if (saved.tracks.isEmpty()) {
            return
        }
        val index = saved.index.coerceIn(0, saved.tracks.size - 1)
        player.setMediaItems(saved.tracks.map(QueueItems::toMediaItem), index, saved.positionMs)
        player.prepare() // reads headers only; playback starts when the user presses play
    }

    private fun savePosition() {
        if (player.mediaItemCount > 0) {
            queueStore.savePosition(player.currentMediaItemIndex, player.currentPosition)
        }
    }

    private fun saveQueue() {
        val startedAt = SystemClock.elapsedRealtime()
        val tracks = (0 until player.mediaItemCount).map { QueueItems.fromMediaItem(player.getMediaItemAt(it)) }
        runIo {
            queueStore.saveQueue(tracks)
            val elapsed = SystemClock.elapsedRealtime() - startedAt
            if (elapsed > SLOW_QUEUE_SAVE_MS) {
                ThoraDiagnostics.log("warn", "playback", "queue_save_slow", mapOf("tracks" to tracks.size, "ms" to elapsed))
            }
        }
        savePosition()
    }

    private fun runIo(task: () -> Unit) {
        if (io.isShutdown) {
            return
        }
        try {
            io.execute { runCatching(task) }
        } catch (_: RejectedExecutionException) {
        }
    }

    private fun record(item: MediaItem, eventType: String, positionMs: Long, durationMs: Long = QueueItems.durationOf(item)) {
        val uri = item.mediaId
        if (uri.isBlank()) {
            return
        }
        // Tracks not in the index (e.g. not synced yet) are rejected by the store; that's fine.
        runIo { LibraryIndexStore.get(applicationContext).recordPlaybackEvent(uri, eventType, positionMs, durationMs) }
    }

    private val playerListener = object : Player.Listener {
        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            val oldItem = oldPosition.mediaItem ?: return
            when (reason) {
                Player.DISCONTINUITY_REASON_AUTO_TRANSITION -> {
                    // Played to the end (including repeat-one loops).
                    val duration = QueueItems.durationOf(oldItem).takeIf { it > 0 } ?: COMPLETED_FALLBACK_MS
                    record(oldItem, "PLAY_COMPLETED", duration, duration)
                }

                Player.DISCONTINUITY_REASON_SEEK, Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT -> {
                    val changedTrack = oldPosition.mediaItemIndex != newPosition.mediaItemIndex
                    if (changedTrack && oldItem.mediaId != erroredMediaId) {
                        record(oldItem, "PLAY_SKIPPED", oldPosition.positionMs)
                    }
                }
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            startedKey = null
            if (player.playWhenReady && reason != Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
                reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
            ) {
                markStartRequested(if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) "new_queue" else "skip")
            }
            savePosition()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            when {
                !playWhenReady -> startRequestedAtMs = 0L // only time starts the user is waiting for
                !player.isPlaying && startRequestedAtMs == 0L -> markStartRequested("play")
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isPlaying) {
                savePosition()
                return
            }
            consecutiveErrors = 0
            erroredMediaId = null
            if (startRequestedAtMs > 0L) {
                ThoraDiagnostics.log(
                    "info", "playback", "start_latency",
                    mapOf("ms" to SystemClock.elapsedRealtime() - startRequestedAtMs, "reason" to startReason, "queue" to player.mediaItemCount),
                )
                startRequestedAtMs = 0L
            }
            val item = player.currentMediaItem ?: return
            val key = "${player.currentMediaItemIndex}:${item.mediaId}"
            if (startedKey != key) {
                startedKey = key
                record(item, "PLAY_STARTED", player.currentPosition)
            }
        }

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) {
                saveQueue()
            }
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            queueStore.saveModes(repeatMode, player.shuffleModeEnabled)
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            queueStore.saveModes(player.repeatMode, shuffleModeEnabled)
        }

        override fun onPlayerError(error: PlaybackException) {
            // One unreadable/unsupported file must not end the listening session: skip it.
            consecutiveErrors += 1
            erroredMediaId = player.currentMediaItem?.mediaId
            val limit = minOf(player.mediaItemCount, MAX_CONSECUTIVE_ERRORS)
            val skip = player.playWhenReady && consecutiveErrors < limit && player.hasNextMediaItem()
            ThoraDiagnostics.log(
                "warn", "playback", "player_error",
                mapOf(
                    "code" to error.errorCodeName,
                    "cause" to error.cause?.toString()?.take(300),
                    "uri" to erroredMediaId,
                    "consecutive" to consecutiveErrors,
                    "skipped" to skip,
                ),
            )
            if (skip) {
                player.seekToNextMediaItem()
                player.prepare()
            }
        }
    }

    private val sessionCallback = object : MediaSession.Callback {
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(mediaItems.map(QueueItems::resolve).toMutableList())

        @Deprecated("Superseded by the isForPlayback overload; kept for older callers.")
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = resumptionItems()

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = resumptionItems()
    }

    /** Bluetooth "play" / system resumption controls after the process was killed. */
    private fun resumptionItems(): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val saved = queueStore.load()
        ThoraDiagnostics.log("info", "playback", "resumption_request", mapOf("savedTracks" to saved.tracks.size))
        if (saved.tracks.isEmpty()) {
            return Futures.immediateFailedFuture(UnsupportedOperationException("Nothing to resume"))
        }
        val index = saved.index.coerceIn(0, saved.tracks.size - 1)
        return Futures.immediateFuture(
            MediaSession.MediaItemsWithStartPosition(saved.tracks.map(QueueItems::toMediaItem), index, saved.positionMs)
        )
    }

    private companion object {
        const val POSITION_SAVE_INTERVAL_MS = 10_000L
        const val MAX_CONSECUTIVE_ERRORS = 20
        const val COMPLETED_FALLBACK_MS = 30_000L
        const val SLOW_QUEUE_SAVE_MS = 50L
    }
}
