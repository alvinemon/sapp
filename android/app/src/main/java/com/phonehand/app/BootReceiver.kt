package com.phonehand.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Reconnect relay after phone reboot when Watch Sync is enabled. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!WatchSync.isEnabled(context) || !UserSession.isSignedUp(context)) return
        TouchAccessibilityService.instance?.ensureRelay()
    }
}
