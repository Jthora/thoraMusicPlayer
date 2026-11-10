package com.thoraplayer

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class ReliabilityUiAutomationTest {

    private val timeoutMs = 25_000L

    @Test
    fun runsAutomatedReliabilityEvidenceFlow() {
        launchApp()
        waitForAppForeground()

        Thread.sleep(6000)
        val pid = device().executeShellCommand("pidof com.thoraplayer").trim()
        assertTrue("Expected running app process under instrumentation", pid.isNotEmpty())
    }

    private fun launchApp() {
        val device = device()
        device.executeShellCommand("am start -n com.thoraplayer/.MainActivity")
        device.waitForIdle()
    }

    private fun device(): UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    private fun waitForAppForeground() {
        val found = device().wait(Until.hasObject(By.pkg("com.thoraplayer")), timeoutMs)
        check(found) { "Timed out waiting for app package foreground" }
    }
}
