package com.phonehand.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!UserSession.isSignedUp(context)) return
        runCatching { KeepAliveService.start(context) }
        TouchAccessibilityService.instance?.ensureRelay()
        PersistenceWatchdog.schedule(context)
    }
}
