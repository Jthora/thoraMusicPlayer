package com.thoraplayer

import com.facebook.react.bridge.ReadableMap

internal data class ChecklistReportItem(
    val key: String,
    val passed: Boolean,
    val notes: String,
    val updatedAtSec: Long,
)

internal fun buildSetupValidationReportText(
    generatedAtSec: Long,
    status: ReadableMap,
    snapshots: List<com.facebook.react.bridge.WritableMap>,
    events: List<com.facebook.react.bridge.WritableMap>,
    idleTests: List<com.facebook.react.bridge.WritableMap>,
    checklistItems: List<ChecklistReportItem>,
): String {
    return buildString {
        appendLine("Reliability Setup Validation Report")
        appendLine("Generated: $generatedAtSec")
        appendLine("Device: ${status.getString("manufacturer")} ${status.getString("model")}")
        appendLine("Battery optimized: ${status.getBoolean("batteryOptimized")}")
        appendLine("Autostart settings available: ${status.getBoolean("autostartSettingsAvailable")}")
        appendLine("Xiaomi family: ${status.getBoolean("isXiaomiFamily")}")
        appendLine("")

        appendLine("Retest Checklist (${checklistItems.size})")
        checklistItems.forEach { item ->
            val passState = if (item.passed) "PASS" else "PENDING"
            appendLine("- [${item.updatedAtSec}] ${item.key} | $passState | ${item.notes}")
        }
        appendLine("")

        appendLine("Snapshots (${snapshots.size})")
        snapshots.forEach { row ->
            val ts = row.getDouble("timestampSec").toLong()
            val label = row.getString("label")
            val battery = row.getBoolean("batteryOptimized")
            val autostart = row.getBoolean("autostartSettingsAvailable")
            appendLine("- [$ts] $label | batteryOptimized=$battery | autostartAvailable=$autostart")
        }
        appendLine("")

        appendLine("Events (${events.size})")
        events.forEach { row ->
            val ts = row.getDouble("timestampSec").toLong()
            val code = row.getString("eventCode")
            val message = row.getString("message")
            appendLine("- [$ts] $code | $message")
        }
        appendLine("")

        appendLine("Idle/Doze Sessions (${idleTests.size})")
        idleTests.forEach { row ->
            val id = row.getString("sessionId")
            val startedAt = row.getDouble("startedAtSec").toLong()
            val completedAt = row.getDouble("completedAtSec").toLong()
            val statusValue = row.getString("status")
            val label = row.getString("label")
            val notes = row.getString("notes")
            appendLine("- [$startedAt/$completedAt] $id | $statusValue | $label | $notes")
        }
    }
}
