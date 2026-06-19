package com.phonehand.app

import android.app.Activity
import android.content.Context
import android.util.Log

/** Starts KeepAlive only when safe — avoids FGS crashes from background contexts. */
object SafeKeepAlive {
    private const val TAG = "SafeKeepAlive"

    fun start(context: Context) {
        val app = context.applicationContext
        if (!UserSession.isSignedUp(app)) return
        if (!WatchSync.isEnabled(app) && TouchAccessibilityService.instance == null) return
        if (context is Activity && (context.isFinishing || context.isDestroyed)) return
        runCatching { KeepAliveService.start(app) }
            .onFailure { Log.w(TAG, it.message ?: "start failed") }
    }
}
