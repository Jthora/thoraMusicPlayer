package com.androidmusicplayerapp

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import org.json.JSONArray
import org.json.JSONObject

class OemSetupModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val PREFS_NAME = "reliability_events"
        private const val KEY_EVENTS = "events"
        private const val KEY_SETUP_SNAPSHOTS = "setup_snapshots"
        private const val KEY_IDLE_TESTS = "idle_test_sessions"
        private const val CHECKLIST_PREFS_NAME = "reliability_checklist"
        private const val CHECKLIST_KEY_PREFIX_PASS = "pass_"
        private const val CHECKLIST_KEY_PREFIX_NOTES = "notes_"
        private const val CHECKLIST_KEY_PREFIX_UPDATED = "updated_"
        private val CHECKLIST_KEYS = listOf(
            "idle_transition",
            "interruption_recovery",
            "post_fix_retest",
        )
        private const val MAX_EVENTS = 100
        private const val MAX_SNAPSHOTS = 40
        private const val MAX_IDLE_TESTS = 40
    }

    private val reliabilityPrefs by lazy {
        reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)
    }
    private val persistenceLock = Any()

    override fun getName(): String = "OemSetup"

    @ReactMethod
    fun getDeviceSetupStatus(promise: Promise) {
        runCatching {
            buildSetupStatusMap()
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("OEM_SETUP_STATUS_ERROR", error)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        val packageName = reactApplicationContext.packageName

        val intents = listOf(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )

        openFirstAvailableIntent(intents, "OPEN_BATTERY_SETTINGS_ERROR", promise)
    }

    @ReactMethod
    fun openAutostartSettings(promise: Promise) {
        val packageName = reactApplicationContext.packageName

        val intents = listOf(
            Intent().apply {
                component = android.content.ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent().apply {
                component = android.content.ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.appmanager.ApplicationsDetailsActivity"
                )
                putExtra("package_name", packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )

        openFirstAvailableIntent(intents, "OPEN_AUTOSTART_SETTINGS_ERROR", promise)
    }

    @ReactMethod
    fun recordReliabilityEvent(eventCode: String, message: String?, promise: Promise) {
        runCatching {
            val normalizedCode = eventCode.trim().ifBlank { "EVENT" }
            val normalizedMessage = message?.trim().orEmpty()
            val row = Arguments.createMap().apply {
                putDouble("timestampSec", (System.currentTimeMillis() / 1000L).toDouble())
                putString("eventCode", normalizedCode)
                putString("message", normalizedMessage)
            }

            val events = getEventsMutable()
            events.add(0, row)
            if (events.size > MAX_EVENTS) {
                events.subList(MAX_EVENTS, events.size).clear()
            }
            saveEvents(events)
            row
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("RELIABILITY_EVENT_RECORD_ERROR", error)
        }
    }

    @ReactMethod
    fun getReliabilityEvents(limit: Int, promise: Promise) {
        runCatching {
            val safeLimit = if (limit <= 0) 25 else limit
            val rows = getEventsMutable().take(safeLimit)
            Arguments.createArray().apply {
                rows.forEach { pushMap(it) }
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("RELIABILITY_EVENT_LIST_ERROR", error)
        }
    }

    @ReactMethod
    fun captureSetupValidationSnapshot(label: String, promise: Promise) {
        runCatching {
            val snapshot = buildSetupStatusMap().let { status ->
                Arguments.createMap().apply {
                    putDouble("timestampSec", (System.currentTimeMillis() / 1000L).toDouble())
                    putString("label", label.trim().ifBlank { "snapshot" })
                    putBoolean("batteryOptimized", status.getBoolean("batteryOptimized"))
                    putBoolean("autostartSettingsAvailable", status.getBoolean("autostartSettingsAvailable"))
                }
            }

            val snapshots = getSnapshotsMutable()
            snapshots.add(0, snapshot)
            if (snapshots.size > MAX_SNAPSHOTS) {
                snapshots.subList(MAX_SNAPSHOTS, snapshots.size).clear()
            }
            saveSnapshots(snapshots)
            snapshot
        }.onSuccess { snapshot ->
            promise.resolve(snapshot)
        }.onFailure { error ->
            promise.reject("SETUP_SNAPSHOT_CAPTURE_ERROR", error)
        }
    }

    @ReactMethod
    fun getSetupValidationSnapshots(limit: Int, promise: Promise) {
        runCatching {
            val safeLimit = if (limit <= 0) 20 else limit
            val rows = getSnapshotsMutable().take(safeLimit)
            Arguments.createArray().apply {
                rows.forEach { pushMap(it) }
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("SETUP_SNAPSHOT_LIST_ERROR", error)
        }
    }

    @ReactMethod
    fun getSetupValidationReport(promise: Promise) {
        runCatching {
            val status = buildSetupStatusMap()
            val snapshots = getSnapshotsMutable().take(20)
            val events = getEventsMutable().take(40)
            val idleTests = getIdleTestsMutable().take(20)
            val checklistItems = getChecklistReportItems()
            val generatedAtSec = System.currentTimeMillis() / 1000L

            val reportText = buildSetupValidationReportText(
                generatedAtSec = generatedAtSec,
                status = status,
                snapshots = snapshots,
                events = events,
                idleTests = idleTests,
                checklistItems = checklistItems,
            )

            Arguments.createMap().apply {
                putDouble("generatedAtSec", generatedAtSec.toDouble())
                putString("reportText", reportText)
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("SETUP_REPORT_ERROR", error)
        }
    }

    @ReactMethod
    fun startIdleTestSession(label: String, expectedMinutes: Int, promise: Promise) {
        runCatching {
            val nowSec = System.currentTimeMillis() / 1000L
            val safeLabel = label.trim().ifBlank { "idle_test" }
            val safeMinutes = expectedMinutes.coerceIn(1, 180)
            val sessionId = "idle_${nowSec}_${(1000..9999).random()}"

            val session = Arguments.createMap().apply {
                putString("sessionId", sessionId)
                putString("label", safeLabel)
                putDouble("expectedMinutes", safeMinutes.toDouble())
                putDouble("startedAtSec", nowSec.toDouble())
                putDouble("completedAtSec", 0.0)
                putString("status", "RUNNING")
                putString("notes", "")
            }

            val sessions = getIdleTestsMutable()
            sessions.add(0, session)
            if (sessions.size > MAX_IDLE_TESTS) {
                sessions.subList(MAX_IDLE_TESTS, sessions.size).clear()
            }
            saveIdleTests(sessions)
            session
        }.onSuccess { session ->
            promise.resolve(session)
        }.onFailure { error ->
            promise.reject("IDLE_TEST_START_ERROR", error)
        }
    }

    @ReactMethod
    fun completeIdleTestSession(sessionId: String, outcome: String, notes: String?, promise: Promise) {
        runCatching {
            val normalizedId = sessionId.trim()
            require(normalizedId.isNotBlank()) { "IDLE_TEST_SESSION_ID_REQUIRED" }
            val normalizedOutcome = outcome.trim().uppercase().ifBlank { "COMPLETED" }
            val normalizedNotes = notes?.trim().orEmpty()
            val nowSec = System.currentTimeMillis() / 1000L

            val sessions = getIdleTestsMutable()
            val target = sessions.firstOrNull { it.getString("sessionId") == normalizedId }
                ?: throw IllegalArgumentException("IDLE_TEST_SESSION_NOT_FOUND")

            target.putString("status", normalizedOutcome)
            target.putDouble("completedAtSec", nowSec.toDouble())
            target.putString("notes", normalizedNotes)
            saveIdleTests(sessions)
            target
        }.onSuccess { session ->
            promise.resolve(session)
        }.onFailure { error ->
            promise.reject("IDLE_TEST_COMPLETE_ERROR", error)
        }
    }

    @ReactMethod
    fun getIdleTestSessions(limit: Int, promise: Promise) {
        runCatching {
            val safeLimit = if (limit <= 0) 20 else limit
            val rows = getIdleTestsMutable().take(safeLimit)
            Arguments.createArray().apply {
                rows.forEach { pushMap(it) }
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("IDLE_TEST_LIST_ERROR", error)
        }
    }

    private fun openFirstAvailableIntent(intents: List<Intent>, errorCode: String, promise: Promise) {
        val pm = reactApplicationContext.packageManager

        intents.firstOrNull { intent -> intent.resolveActivity(pm) != null }?.let { intent ->
            runCatching {
                reactApplicationContext.startActivity(intent)
            }.onSuccess {
                promise.resolve(true)
            }.onFailure { error ->
                promise.reject(errorCode, error)
            }
            return
        }

        promise.reject(errorCode, "No compatible settings activity available")
    }

    private fun isXiaomiFamily(): Boolean {
        val value = (Build.MANUFACTURER + " " + Build.BRAND).lowercase()
        return value.contains("xiaomi") || value.contains("redmi") || value.contains("poco")
    }

    private fun buildSetupStatusMap() = Arguments.createMap().apply {
        val packageName = reactApplicationContext.packageName
        val powerManager = reactApplicationContext.getSystemService(PowerManager::class.java)
        val batteryOptimized =
            if (powerManager == null) {
                true
            } else {
                !powerManager.isIgnoringBatteryOptimizations(packageName)
            }

        putString("manufacturer", Build.MANUFACTURER)
        putString("model", Build.MODEL)
        putBoolean("batteryOptimized", batteryOptimized)
        putBoolean("isXiaomiFamily", isXiaomiFamily())
        putBoolean("autostartSettingsAvailable", isAutostartSettingsAvailable())
    }

    private fun isAutostartSettingsAvailable(): Boolean {
        val pm = reactApplicationContext.packageManager
        val packageName = reactApplicationContext.packageName

        val intents = listOf(
            Intent().apply {
                component = android.content.ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
            },
            Intent().apply {
                component = android.content.ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.appmanager.ApplicationsDetailsActivity"
                )
                putExtra("package_name", packageName)
            },
        )

        return intents.any { it.resolveActivity(pm) != null }
    }

    private fun getEventsMutable(): MutableList<com.facebook.react.bridge.WritableMap> {
        synchronized(persistenceLock) {
            val serializedRows = readSerializedRows(KEY_EVENTS)
            val rows = serializedRows.mapNotNull { serialized ->
                val parts = serialized.split('|', limit = 3)
                if (parts.size < 2) {
                    return@mapNotNull null
                }

                val timestamp = parts[0].toLongOrNull() ?: return@mapNotNull null
                val code = parts[1]
                val message = if (parts.size >= 3) parts[2] else ""
                Arguments.createMap().apply {
                    putDouble("timestampSec", timestamp.toDouble())
                    putString("eventCode", code)
                    putString("message", message)
                }
            }.toMutableList()

            val legacy = reliabilityPrefs.getStringSet(KEY_EVENTS, null)
            if (legacy != null) {
                saveEvents(rows)
            }

            return rows
        }
    }

    private fun saveEvents(events: List<com.facebook.react.bridge.WritableMap>) {
        val serialized = events.map {
            val timestamp = it.getDouble("timestampSec").toLong()
            val code = it.getString("eventCode").orEmpty().replace('|', '/')
            val message = it.getString("message").orEmpty().replace('|', '/')
            "$timestamp|$code|$message"
        }

        synchronized(persistenceLock) {
            writeSerializedRows(KEY_EVENTS, serialized)
        }
    }

    private fun getSnapshotsMutable(): MutableList<com.facebook.react.bridge.WritableMap> {
        synchronized(persistenceLock) {
            val serializedRows = readSerializedRows(KEY_SETUP_SNAPSHOTS)
            val rows = serializedRows.mapNotNull { serialized ->
                val parts = serialized.split('|', limit = 4)
                if (parts.size < 4) {
                    return@mapNotNull null
                }

                val timestamp = parts[0].toLongOrNull() ?: return@mapNotNull null
                val label = parts[1]
                val batteryOptimized = parts[2] == "1"
                val autostartAvailable = parts[3] == "1"
                Arguments.createMap().apply {
                    putDouble("timestampSec", timestamp.toDouble())
                    putString("label", label)
                    putBoolean("batteryOptimized", batteryOptimized)
                    putBoolean("autostartSettingsAvailable", autostartAvailable)
                }
            }.toMutableList()

            val legacy = reliabilityPrefs.getStringSet(KEY_SETUP_SNAPSHOTS, null)
            if (legacy != null) {
                saveSnapshots(rows)
            }

            return rows
        }
    }

    private fun saveSnapshots(snapshots: List<com.facebook.react.bridge.WritableMap>) {
        val serialized = snapshots.map {
            val timestamp = it.getDouble("timestampSec").toLong()
            val label = it.getString("label").orEmpty().replace('|', '/')
            val batteryOptimized = if (it.getBoolean("batteryOptimized")) "1" else "0"
            val autostartAvailable = if (it.getBoolean("autostartSettingsAvailable")) "1" else "0"
            "$timestamp|$label|$batteryOptimized|$autostartAvailable"
        }

        synchronized(persistenceLock) {
            writeSerializedRows(KEY_SETUP_SNAPSHOTS, serialized)
        }
    }

    private fun getIdleTestsMutable(): MutableList<com.facebook.react.bridge.WritableMap> {
        synchronized(persistenceLock) {
            val serializedRows = readSerializedRows(KEY_IDLE_TESTS)
            val rows = serializedRows.mapNotNull { serialized ->
                val parts = serialized.split('|', limit = 7)
                if (parts.size < 7) {
                    return@mapNotNull null
                }

                val sessionId = parts[0]
                val label = parts[1]
                val expectedMinutes = parts[2].toIntOrNull() ?: 0
                val startedAt = parts[3].toLongOrNull() ?: return@mapNotNull null
                val completedAt = parts[4].toLongOrNull() ?: 0L
                val statusValue = parts[5]
                val notes = parts[6]

                Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putString("label", label)
                    putDouble("expectedMinutes", expectedMinutes.toDouble())
                    putDouble("startedAtSec", startedAt.toDouble())
                    putDouble("completedAtSec", completedAt.toDouble())
                    putString("status", statusValue)
                    putString("notes", notes)
                }
            }.toMutableList()

            val legacy = reliabilityPrefs.getStringSet(KEY_IDLE_TESTS, null)
            if (legacy != null) {
                saveIdleTests(rows)
            }

            return rows
        }
    }

    private fun saveIdleTests(sessions: List<com.facebook.react.bridge.WritableMap>) {
        val serialized = sessions.map {
            val sessionId = it.getString("sessionId").orEmpty().replace('|', '/')
            val label = it.getString("label").orEmpty().replace('|', '/')
            val expectedMinutes = it.getDouble("expectedMinutes").toInt()
            val startedAt = it.getDouble("startedAtSec").toLong()
            val completedAt = it.getDouble("completedAtSec").toLong()
            val statusValue = it.getString("status").orEmpty().replace('|', '/')
            val notes = it.getString("notes").orEmpty().replace('|', '/')
            "$sessionId|$label|$expectedMinutes|$startedAt|$completedAt|$statusValue|$notes"
        }

        synchronized(persistenceLock) {
            writeSerializedRows(KEY_IDLE_TESTS, serialized)
        }
    }

    private fun readSerializedRows(key: String): List<String> {
        val jsonRaw = reliabilityPrefs.getString(key, null)
        if (!jsonRaw.isNullOrBlank()) {
            val jsonRows = runCatching { JSONArray(jsonRaw) }.getOrElse { JSONArray() }
            val rows = mutableListOf<String>()
            for (index in 0 until jsonRows.length()) {
                val value = jsonRows.optString(index, "")
                if (value.isNotBlank()) {
                    rows.add(value)
                }
            }
            return rows
        }

        val legacy = reliabilityPrefs.getStringSet(key, emptySet()) ?: emptySet()
        return legacy
            .mapNotNull { parseLegacyRow(key, it) }
            .sortedByDescending { it.timestampSec }
            .map { it.row }
    }

    private fun writeSerializedRows(key: String, rows: List<String>) {
        val jsonArray = JSONArray().apply {
            rows.forEach { put(it) }
        }

        val commitOk = reliabilityPrefs
            .edit()
            .putString(key, jsonArray.toString())
            .removeLegacyStringSet(key)
            .commit()

        if (!commitOk) {
            throw IllegalStateException("RELIABILITY_PERSISTENCE_WRITE_FAILED")
        }
    }

    private fun parseLegacyRow(key: String, row: String): TimestampedRow? {
        return when (key) {
            KEY_EVENTS -> {
                val parts = row.split('|', limit = 3)
                val timestampSec = parts.getOrNull(0)?.toLongOrNull() ?: return null
                TimestampedRow(timestampSec = timestampSec, row = row)
            }

            KEY_SETUP_SNAPSHOTS -> {
                val parts = row.split('|', limit = 4)
                val timestampSec = parts.getOrNull(0)?.toLongOrNull() ?: return null
                TimestampedRow(timestampSec = timestampSec, row = row)
            }

            KEY_IDLE_TESTS -> {
                val parts = row.split('|', limit = 7)
                val startedAt = parts.getOrNull(3)?.toLongOrNull() ?: return null
                TimestampedRow(timestampSec = startedAt, row = row)
            }

            else -> null
        }
    }

    private fun android.content.SharedPreferences.Editor.removeLegacyStringSet(key: String): android.content.SharedPreferences.Editor {
        return putStringSet(key, null)
    }

    private data class TimestampedRow(
        val timestampSec: Long,
        val row: String,
    )

    private fun getChecklistReportItems(): List<ChecklistReportItem> {
        val prefs = reactApplicationContext.getSharedPreferences(CHECKLIST_PREFS_NAME, 0)
        return CHECKLIST_KEYS.map { key ->
            ChecklistReportItem(
                key = key,
                passed = prefs.getBoolean("$CHECKLIST_KEY_PREFIX_PASS$key", false),
                notes = prefs.getString("$CHECKLIST_KEY_PREFIX_NOTES$key", "").orEmpty(),
                updatedAtSec = prefs.getLong("$CHECKLIST_KEY_PREFIX_UPDATED$key", 0L),
            )
        }
    }
}
