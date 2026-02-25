package com.androidmusicplayerapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.SystemClock

class PlaybackService : Service() {
    data class QueueEntry(
        val uri: String,
        val title: String,
        val artist: String,
        val album: String,
        val displayName: String,
        val durationMs: Long,
    )

    companion object {
        const val ACTION_PLAY = "com.androidmusicplayerapp.action.PLAY"
        const val ACTION_PAUSE = "com.androidmusicplayerapp.action.PAUSE"
        const val ACTION_NEXT = "com.androidmusicplayerapp.action.NEXT"
        const val ACTION_PREVIOUS = "com.androidmusicplayerapp.action.PREVIOUS"
        const val ACTION_STOP = "com.androidmusicplayerapp.action.STOP"

        @Volatile
        private var runtimeIsPlaying: Boolean = false

        @Volatile
        private var runtimeLastReason: String = "INIT"

        @Volatile
        private var runtimeUpdatedAtSec: Long = System.currentTimeMillis() / 1000L

        @Volatile
        private var runtimeQueueLength: Int = 0

        @Volatile
        private var runtimeQueueIndex: Int = -1

        @Volatile
        private var runtimePositionMs: Long = 0L

        @Volatile
        private var runtimeDurationMs: Long = 0L

        @Volatile
        private var runtimeQueueEntries: List<QueueEntry> = emptyList()

        @Volatile
        private var runtimePositionUpdatedAtElapsedMs: Long = SystemClock.elapsedRealtime()

        data class PlaybackRuntimeSnapshot(
            val isPlaying: Boolean,
            val lastReason: String,
            val updatedAtSec: Long,
            val queueLength: Int,
            val queueIndex: Int,
            val positionMs: Long,
            val durationMs: Long,
        )

        @Synchronized
        fun getRuntimeSnapshot(): PlaybackRuntimeSnapshot {
            val effectivePosition = computeEffectivePositionMs()
            return PlaybackRuntimeSnapshot(
                isPlaying = runtimeIsPlaying,
                lastReason = runtimeLastReason,
                updatedAtSec = runtimeUpdatedAtSec,
                queueLength = runtimeQueueLength,
                queueIndex = runtimeQueueIndex,
                positionMs = effectivePosition,
                durationMs = runtimeDurationMs,
            )
        }

        @Synchronized
        fun syncRuntimeQueueState(queueLength: Int, queueIndex: Int) {
            runtimeQueueLength = if (runtimeQueueEntries.isNotEmpty()) {
                runtimeQueueEntries.size
            } else {
                queueLength.coerceAtLeast(0)
            }
            runtimeQueueIndex = normalizeQueueIndex(queueIndex, runtimeQueueLength)
            runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
        }

        @Synchronized
        fun syncRuntimeQueueEntries(entries: List<QueueEntry>) {
            runtimeQueueEntries = entries
            runtimeQueueLength = entries.size
            runtimeQueueIndex = normalizeQueueIndex(runtimeQueueIndex, runtimeQueueLength)
            runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
        }

        @Synchronized
        fun getQueueEntry(index: Int): QueueEntry? {
            if (index < 0 || index >= runtimeQueueEntries.size) {
                return null
            }

            return runtimeQueueEntries[index]
        }

        @Synchronized
        fun syncRuntimePlaybackProgress(positionMs: Long, durationMs: Long) {
            runtimePositionMs = positionMs.coerceAtLeast(0L)
            runtimeDurationMs = durationMs.coerceAtLeast(0L)
            runtimePositionUpdatedAtElapsedMs = SystemClock.elapsedRealtime()
            runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
        }

        @Synchronized
        fun advanceRuntimeQueue(delta: Int): Int {
            if (runtimeQueueLength <= 0) {
                runtimeQueueIndex = -1
                runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
                return runtimeQueueIndex
            }

            val base = if (runtimeQueueIndex < 0) 0 else runtimeQueueIndex
            runtimeQueueIndex = (base + delta).coerceIn(0, runtimeQueueLength - 1)
            runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
            return runtimeQueueIndex
        }

        private fun normalizeQueueIndex(queueIndex: Int, queueLength: Int): Int {
            if (queueLength <= 0) {
                return -1
            }

            return queueIndex.coerceIn(0, queueLength - 1)
        }

        private fun updateRuntimeState(isPlaying: Boolean, reason: String) {
            runtimePositionMs = computeEffectivePositionMs()
            runtimeIsPlaying = isPlaying
            runtimeLastReason = reason
            runtimePositionUpdatedAtElapsedMs = SystemClock.elapsedRealtime()
            runtimeUpdatedAtSec = System.currentTimeMillis() / 1000L
        }

        private fun computeEffectivePositionMs(): Long {
            if (!runtimeIsPlaying) {
                return runtimePositionMs
            }

            val elapsedDelta = (SystemClock.elapsedRealtime() - runtimePositionUpdatedAtElapsedMs).coerceAtLeast(0L)
            val advanced = runtimePositionMs + elapsedDelta
            return if (runtimeDurationMs > 0L) advanced.coerceAtMost(runtimeDurationMs) else advanced
        }
    }

    private val channelId = "playback_service"
    private val channelName = "Playback"
    private val notificationId = 1001
    private lateinit var mediaSession: MediaSession
    private lateinit var audioManager: AudioManager
    private var audioFocusRequest: AudioFocusRequest? = null
    private var isPlaying = false
    private var resumeOnFocusGain = false
    private var noisyReceiverRegistered = false
    private var mediaPlayer: MediaPlayer? = null

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                pausePlayback("AUDIO_BECOMING_NOISY")
            }
        }
    }

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                pausePlayback("AUDIOFOCUS_LOSS")
            }

            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
            -> {
                if (isPlaying) {
                    resumeOnFocusGain = true
                }
                pausePlayback("AUDIOFOCUS_LOSS_TRANSIENT")
            }

            AudioManager.AUDIOFOCUS_GAIN -> {
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false
                    playPlayback("AUDIOFOCUS_GAIN")
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(AudioManager::class.java)
        createNotificationChannel()
        registerNoisyReceiver()
        initializeMediaSession()
        updatePlaybackState()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        handleAction(intent?.action)
        startForeground(notificationId, buildNotification())
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseMediaPlayer()
        updateRuntimeState(isPlaying = false, reason = "SERVICE_DESTROYED")
        unregisterNoisyReceiver()
        abandonAudioFocus()
        stopForeground(STOP_FOREGROUND_REMOVE)
        mediaSession.release()
        super.onDestroy()
    }

    private fun initializeMediaSession() {
        mediaSession = MediaSession(this, "AndroidMusicPlayerPlayback").apply {
            setCallback(
                object : MediaSession.Callback() {
                    override fun onPlay() {
                        playPlayback("MEDIA_SESSION_PLAY")
                    }

                    override fun onPause() {
                        pausePlayback("MEDIA_SESSION_PAUSE")
                    }

                    override fun onSkipToNext() {
                        advanceRuntimeQueue(1)
                        syncRuntimePlaybackProgress(0L, runtimeDurationMs)
                        updateRuntimeState(isPlaying = isPlaying, reason = "MEDIA_SESSION_NEXT")
                        updatePlaybackState()
                        startForeground(notificationId, buildNotification())
                    }

                    override fun onSkipToPrevious() {
                        advanceRuntimeQueue(-1)
                        syncRuntimePlaybackProgress(0L, runtimeDurationMs)
                        updateRuntimeState(isPlaying = isPlaying, reason = "MEDIA_SESSION_PREVIOUS")
                        updatePlaybackState()
                        startForeground(notificationId, buildNotification())
                    }

                    override fun onStop() {
                        stopSelf()
                    }
                }
            )
            isActive = true
        }
    }

    private fun handleAction(action: String?) {
        when (action) {
            ACTION_PLAY -> {
                playPlayback("ACTION_PLAY")
            }

            ACTION_PAUSE -> {
                pausePlayback("ACTION_PAUSE")
            }

            ACTION_NEXT -> {
                handleSkip(1, "ACTION_NEXT")
            }

            ACTION_PREVIOUS -> {
                handleSkip(-1, "ACTION_PREVIOUS")
            }

            ACTION_STOP -> {
                stopSelf()
            }
        }
    }

    private fun playPlayback(reason: String) {
        if (!requestAudioFocus()) {
            pausePlayback("AUDIOFOCUS_DENIED:$reason")
            return
        }

        if (!startPlaybackForCurrentQueue(reason)) {
            pausePlayback("QUEUE_EMPTY:$reason")
            return
        }

        isPlaying = true
        updateRuntimeState(isPlaying = true, reason = reason)
        updatePlaybackState()
        startForeground(notificationId, buildNotification())
    }

    private fun pausePlayback(reason: String) {
        if (!isPlaying) {
            return
        }

        mediaPlayer?.runCatching {
            if (isPlaying) {
                pause()
            }
        }

        isPlaying = false
        updateRuntimeState(isPlaying = false, reason = reason)
        if (!reason.startsWith("AUDIOFOCUS_")) {
            resumeOnFocusGain = false
        }
        updatePlaybackState()
        startForeground(notificationId, buildNotification())
    }

    private fun handleSkip(delta: Int, reason: String) {
        val nextIndex = advanceRuntimeQueue(delta)
        syncRuntimePlaybackProgress(0L, runtimeDurationMs)
        if (nextIndex < 0) {
            pausePlayback("NO_TRACK:$reason")
            return
        }

        if (isPlaying) {
            if (!startPlaybackForCurrentQueue(reason)) {
                pausePlayback("SKIP_FAILED:$reason")
                return
            }
            updateRuntimeState(isPlaying = true, reason = reason)
        } else {
            updateRuntimeState(isPlaying = false, reason = reason)
        }

        updatePlaybackState()
        startForeground(notificationId, buildNotification())
    }

    private fun startPlaybackForCurrentQueue(reason: String): Boolean {
        val queueSnapshot = getRuntimeSnapshot()
        if (queueSnapshot.queueLength <= 0 || queueSnapshot.queueIndex < 0) {
            return false
        }

        val entry = getQueueEntry(queueSnapshot.queueIndex) ?: return false
        return playEntry(entry, reason)
    }

    private fun playEntry(entry: QueueEntry, reason: String): Boolean {
        val player = mediaPlayer ?: MediaPlayer().also {
            mediaPlayer = it
        }

        return runCatching {
            player.reset()
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            player.setDataSource(this, Uri.parse(entry.uri))
            player.setOnCompletionListener {
                handleSkip(1, "TRACK_COMPLETED")
            }
            player.setOnErrorListener { _, _, _ ->
                pausePlayback("MEDIA_PLAYER_ERROR:$reason")
                true
            }
            player.prepare()
            player.start()
            val duration = runCatching { player.duration.toLong() }.getOrDefault(entry.durationMs).coerceAtLeast(0L)
            syncRuntimePlaybackProgress(0L, duration)
            true
        }.getOrDefault(false)
    }

    private fun releaseMediaPlayer() {
        mediaPlayer?.runCatching {
            reset()
            release()
        }
        mediaPlayer = null
    }

    private fun requestAudioFocus(): Boolean {
        val manager = audioManager

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setOnAudioFocusChangeListener(focusChangeListener)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    .setAcceptsDelayedFocusGain(false)
                    .build()
            }

            manager.requestAudioFocus(audioFocusRequest!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { request ->
                audioManager.abandonAudioFocusRequest(request)
            }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusChangeListener)
        }
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiverRegistered) {
            return
        }

        registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        noisyReceiverRegistered = true
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            return
        }

        runCatching {
            unregisterReceiver(noisyReceiver)
        }
        noisyReceiverRegistered = false
    }

    private fun updatePlaybackState() {
        val actions =
            PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                PlaybackState.ACTION_STOP

        val state = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        mediaSession.setPlaybackState(
            PlaybackState.Builder().setActions(actions).setState(state, 0L, 1f).build()
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_LOW)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val queueSnapshot = getRuntimeSnapshot()
        val currentEntry = if (queueSnapshot.queueIndex >= 0) getQueueEntry(queueSnapshot.queueIndex) else null
        val playPauseAction = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
        val playPauseTitle = if (isPlaying) "Pause" else "Play"
        val playPauseIcon =
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, channelId)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle(currentEntry?.title ?: "Android Music Player")
            .setContentText(
                if (currentEntry != null) {
                    "${currentEntry.artist} • ${currentEntry.album}"
                } else if (isPlaying) {
                    "Playback active"
                } else {
                    "Playback paused"
                }
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(buildAction(android.R.drawable.ic_media_previous, "Previous", ACTION_PREVIOUS))
            .addAction(buildAction(playPauseIcon, playPauseTitle, playPauseAction))
            .addAction(buildAction(android.R.drawable.ic_media_next, "Next", ACTION_NEXT))
            .setStyle(Notification.MediaStyle().setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    private fun buildAction(icon: Int, title: String, action: String): Notification.Action {
        val intent = Intent(this, PlaybackService::class.java).apply {
            this.action = action
        }

        val pendingIntent = PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Action.Builder(icon, title, pendingIntent).build()
    }
}
