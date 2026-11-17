package com.thoraplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.hermes.instrumentation.HermesSamplingProfiler
import java.io.File

/**
 * Starts and stops the Hermes sampling profiler on the JS thread, for finding what keeps it busy
 * on the device (release builds have no dev tools). Only adb can send this: the receiver requires
 * android.permission.DUMP, which the shell has and ordinary apps cannot get.
 *
 *   adb shell am broadcast -a com.thoraplayer.PROFILE --es cmd start -n com.thoraplayer/.ProfilerReceiver
 *   adb shell am broadcast -a com.thoraplayer.PROFILE --es cmd stop  -n com.thoraplayer/.ProfilerReceiver
 *
 * The trace (Chrome trace-event JSON) lands in <external files>/diagnostics/js-profile.json.
 */
class ProfilerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            when (intent.getStringExtra("cmd")) {
                "start" -> {
                    HermesSamplingProfiler.enable()
                    Log.i(TAG, "sampling started")
                }
                "stop" -> {
                    val dir = File(context.getExternalFilesDir(null), "diagnostics").apply { mkdirs() }
                    val out = File(dir, "js-profile.json")
                    HermesSamplingProfiler.dumpSampledTraceToFile(out.absolutePath)
                    HermesSamplingProfiler.disable()
                    Log.i(TAG, "sampling stopped: ${out.absolutePath} (${out.length()} bytes)")
                }
                else -> Log.w(TAG, "unknown cmd")
            }
        } catch (error: Throwable) {
            Log.e(TAG, "profiler failed", error)
        }
    }

    private companion object {
        const val TAG = "ThoraProfiler"
    }
}
