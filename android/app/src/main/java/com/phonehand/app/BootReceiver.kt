package com.phonehand.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Reconnect relay + keep-alive after reboot or package update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val bootActions = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
        if (action !in bootActions) return
        if (!UserSession.isSignedUp(context)) return

        PersistenceWatchdog.schedule(context)
        if (WatchSync.isEnabled(context)) {
            try {
                KeepAliveService.start(context)
            } catch (e: Exception) {
                Log.w("BootReceiver", "KeepAlive start failed: ${e.message}")
            }
            TouchAccessibilityService.instance?.ensureRelay()
        }
    }
}
