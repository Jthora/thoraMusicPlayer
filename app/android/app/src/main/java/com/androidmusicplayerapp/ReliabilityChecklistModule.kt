package com.androidmusicplayerapp

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ReliabilityChecklistModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val PREFS_NAME = "reliability_checklist"
        private const val KEY_PREFIX_PASS = "pass_"
        private const val KEY_PREFIX_NOTES = "notes_"
        private const val KEY_PREFIX_UPDATED = "updated_"
        private val CHECKLIST_KEYS = listOf(
            "idle_transition",
            "interruption_recovery",
            "post_fix_retest",
        )
    }

    override fun getName(): String = "ReliabilityChecklist"

    @ReactMethod
    fun getChecklist(promise: Promise) {
        runCatching {
            val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)
            Arguments.createArray().apply {
                CHECKLIST_KEYS.forEach { key ->
                    pushMap(
                        Arguments.createMap().apply {
                            putString("key", key)
                            putBoolean("passed", prefs.getBoolean("$KEY_PREFIX_PASS$key", false))
                            putString("notes", prefs.getString("$KEY_PREFIX_NOTES$key", "").orEmpty())
                            putDouble("updatedAtSec", prefs.getLong("$KEY_PREFIX_UPDATED$key", 0L).toDouble())
                        }
                    )
                }
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("CHECKLIST_GET_ERROR", error)
        }
    }

    @ReactMethod
    fun setChecklistItem(key: String, passed: Boolean, notes: String?, promise: Promise) {
        runCatching {
            val normalizedKey = key.trim()
            require(CHECKLIST_KEYS.contains(normalizedKey)) { "CHECKLIST_KEY_INVALID" }

            val normalizedNotes = notes?.trim().orEmpty()
            val nowSec = System.currentTimeMillis() / 1000L

            val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)
            prefs.edit()
                .putBoolean("$KEY_PREFIX_PASS$normalizedKey", passed)
                .putString("$KEY_PREFIX_NOTES$normalizedKey", normalizedNotes)
                .putLong("$KEY_PREFIX_UPDATED$normalizedKey", nowSec)
                .apply()

            Arguments.createMap().apply {
                putString("key", normalizedKey)
                putBoolean("passed", passed)
                putString("notes", normalizedNotes)
                putDouble("updatedAtSec", nowSec.toDouble())
            }
        }.onSuccess { result ->
            promise.resolve(result)
        }.onFailure { error ->
            promise.reject("CHECKLIST_SET_ERROR", error)
        }
    }
}
