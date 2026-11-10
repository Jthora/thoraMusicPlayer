package com.thoraplayer

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Persistent, size-capped event log for problems that happen away from adb: crashes, ANRs,
 * low-memory kills, player errors and JS errors. Each line is a JSON object written to
 * Android/data/com.thoraplayer/files/diagnostics/events.jsonl (pullable with adb even from a
 * non-debuggable build) and mirrored to logcat under the "Thora" tag.
 */
object ThoraDiagnostics {
    private const val TAG = "Thora"
    private const val LOG_NAME = "events.jsonl"
    private const val MAX_LOG_BYTES = 512 * 1024L
    private const val MAX_TRACE_CHARS = 16_000
    private const val MAX_LOGCAT_CHARS = 1_000
    private const val PREFS = "thora_diagnostics"
    private const val KEY_LAST_EXIT_TS = "lastExitTimestamp"

    private val ABNORMAL_EXITS = setOf(
        ApplicationExitInfo.REASON_LOW_MEMORY,
        ApplicationExitInfo.REASON_CRASH,
        ApplicationExitInfo.REASON_CRASH_NATIVE,
        ApplicationExitInfo.REASON_ANR,
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE,
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
        ApplicationExitInfo.REASON_DEPENDENCY_DIED,
    )

    private val writer = Executors.newSingleThreadExecutor { task ->
        Thread(task, "thora-diagnostics").apply { isDaemon = true }
    }
    private val fileLock = Any()

    @Volatile
    private var logDir: File? = null

    /** Call once per process, first thing in Application.onCreate. */
    fun init(app: Application) {
        logDir = (app.getExternalFilesDir("diagnostics") ?: File(app.filesDir, "diagnostics")).apply { mkdirs() }
        installCrashHandler()
        val packageInfo = runCatching { app.packageManager.getPackageInfo(app.packageName, 0) }.getOrNull()
        log(
            "info", "process", "start",
            mapOf(
                "version" to packageInfo?.versionName,
                "versionCode" to packageInfo?.longVersionCode,
                "process" to Application.getProcessName(),
                "pid" to Process.myPid(),
                "sdk" to Build.VERSION.SDK_INT,
            ),
        )
        enqueue { recordExitReasons(app) }
    }

    fun log(level: String, tag: String, message: String, extra: Map<String, Any?> = emptyMap()) {
        val line = entry(level, tag, message, extra)
        Log.println(priorityOf(level), TAG, line.take(MAX_LOGCAT_CHARS))
        enqueue { writeLine(line) }
    }

    /** Up to [limit] of the newest lines, oldest first. */
    fun recent(limit: Int): List<String> = synchronized(fileLock) {
        val dir = logDir ?: return emptyList()
        val wanted = limit.coerceIn(1, 2_000)
        val current = File(dir, LOG_NAME).takeIf { it.exists() }?.readLines().orEmpty()
        if (current.size >= wanted) {
            return current.takeLast(wanted)
        }
        val rotated = File(dir, "$LOG_NAME.1").takeIf { it.exists() }?.readLines().orEmpty()
        (rotated + current).takeLast(wanted)
    }

    fun logPath(): String? = logDir?.let { File(it, LOG_NAME).absolutePath }

    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is ThoraCrashHandler) {
            return
        }
        Thread.setDefaultUncaughtExceptionHandler(ThoraCrashHandler(previous))
    }

    private class ThoraCrashHandler(private val previous: Thread.UncaughtExceptionHandler?) :
        Thread.UncaughtExceptionHandler {
        override fun uncaughtException(thread: Thread, error: Throwable) {
            // The process is about to die: write synchronously, never through the executor.
            runCatching {
                val line = entry(
                    "fatal", "crash", error.toString().take(2_000),
                    mapOf(
                        "thread" to thread.name,
                        "uptimeMs" to SystemClock.uptimeMillis(),
                        "stack" to Log.getStackTraceString(error).take(MAX_TRACE_CHARS),
                    ),
                )
                Log.e(TAG, line.take(MAX_LOGCAT_CHARS))
                writeLine(line)
            }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun recordExitReasons(context: Context) {
        val activityManager = context.getSystemService(ActivityManager::class.java) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lastSeen = prefs.getLong(KEY_LAST_EXIT_TS, 0L)
        val exits = activityManager.getHistoricalProcessExitReasons(null, 0, 16)
            .filter { it.timestamp > lastSeen }
            .sortedBy { it.timestamp }
        exits.forEach { exit ->
            val extra = mutableMapOf<String, Any?>(
                "at" to iso(exit.timestamp),
                "pid" to exit.pid,
                "process" to exit.processName,
                "status" to exit.status,
                "importance" to exit.importance,
                "pssKb" to exit.pss,
                "rssKb" to exit.rss,
                "description" to exit.description,
            )
            if (exit.reason == ApplicationExitInfo.REASON_ANR) {
                extra["trace"] = readTrace(exit)
            }
            val level = when {
                exit.reason in ABNORMAL_EXITS -> "error"
                exit.reason == ApplicationExitInfo.REASON_SIGNALED -> "warn"
                else -> "info"
            }
            writeLine(entry(level, "exit", reasonName(exit.reason), extra))
        }
        exits.maxOfOrNull { it.timestamp }?.let { prefs.edit().putLong(KEY_LAST_EXIT_TS, it).apply() }
    }

    private fun readTrace(exit: ApplicationExitInfo): String? = runCatching {
        exit.traceInputStream?.bufferedReader()?.use { reader ->
            val buffer = CharArray(MAX_TRACE_CHARS)
            val read = reader.read(buffer)
            if (read > 0) String(buffer, 0, read) else null
        }
    }.getOrNull()

    private fun enqueue(task: () -> Unit) {
        try {
            writer.execute { runCatching(task) }
        } catch (_: RejectedExecutionException) {
        }
    }

    private fun writeLine(line: String) {
        synchronized(fileLock) {
            val dir = logDir ?: return
            val file = File(dir, LOG_NAME)
            if (file.length() > MAX_LOG_BYTES) {
                val rotated = File(dir, "$LOG_NAME.1")
                rotated.delete()
                file.renameTo(rotated)
            }
            file.appendText(line + "\n")
        }
    }

    private fun entry(level: String, tag: String, message: String, extra: Map<String, Any?>): String =
        JSONObject().apply {
            put("ts", iso(System.currentTimeMillis()))
            put("level", level)
            put("tag", tag)
            put("msg", message)
            extra.forEach { (key, value) -> if (value != null) put(key, value) }
        }.toString()

    private fun iso(epochMs: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date(epochMs))

    private fun priorityOf(level: String): Int = when (level) {
        "fatal", "error" -> Log.ERROR
        "warn" -> Log.WARN
        "debug" -> Log.DEBUG
        else -> Log.INFO
    }

    private fun reasonName(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
        ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
        ApplicationExitInfo.REASON_CRASH -> "CRASH"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
        ApplicationExitInfo.REASON_ANR -> "ANR"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
        ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
        ApplicationExitInfo.REASON_OTHER -> "OTHER"
        ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
        ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
        ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
        else -> "UNKNOWN_$reason"
    }
}

/** JS access to [ThoraDiagnostics]: error reporting from JS, and reading the log for the debug UI. */
class DiagnosticsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var windowStartMs = 0L
    private var windowCount = 0
    private var dropped = 0

    override fun getName(): String = "ThoraDiagnostics"

    @ReactMethod
    fun log(level: String, tag: String, message: String, details: ReadableMap?) {
        val droppedBefore = admit() ?: return
        val extra = mutableMapOf<String, Any?>()
        details?.toHashMap()?.forEach { (key, value) -> extra[key.take(40)] = value?.toString()?.take(8_000) }
        if (droppedBefore > 0) {
            extra["droppedBefore"] = droppedBefore
        }
        ThoraDiagnostics.log(level.take(8), "js.${tag.take(40)}", message.take(4_000), extra)
    }

    @ReactMethod
    fun getRecentEvents(limit: Double, promise: Promise) {
        try {
            val lines = ThoraDiagnostics.recent(limit.toInt())
            promise.resolve(Arguments.createArray().apply { lines.forEach(::pushString) })
        } catch (error: Exception) {
            promise.reject("DIAGNOSTICS_READ_ERROR", error)
        }
    }

    @ReactMethod
    fun getLogPath(promise: Promise) {
        promise.resolve(ThoraDiagnostics.logPath())
    }

    /**
     * A JS error loop must not turn into a disk-write loop: at most 60 JS entries per minute.
     * Returns null to drop the entry, otherwise how many entries were dropped since the last one.
     */
    @Synchronized
    private fun admit(): Int? {
        val now = SystemClock.elapsedRealtime()
        if (now - windowStartMs > 60_000L) {
            windowStartMs = now
            windowCount = 0
        }
        windowCount += 1
        if (windowCount > 60) {
            dropped += 1
            return null
        }
        return dropped.also { dropped = 0 }
    }
}
