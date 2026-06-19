package com.phonehand.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log

/**
 * Detects when Watch Together accessibility is turned off and re-opens settings.
 * Cannot toggle accessibility without user tap — nudges on screen-on until re-enabled.
 */
object AccessibilityGuard {
    private const val TAG = "A11yGuard"
    private const val NAG_COOLDOWN_MS = 4 * 60_000L

    @Volatile private var lastNagAt = 0L
    @Volatile private var screenReceiver: BroadcastReceiver? = null

    fun check(context: Context) {
        if (!UserSession.isSignedUp(context)) return
        val app = context.applicationContext
        val enabled = WatchSync.isEnabled(app)

        if (enabled) {
            UserSession.setAccessibilityWasEnabled(app, true)
            unregisterScreenReceiver(app)
            return
        }

        if (!UserSession.accessibilityWasEnabled(app)) return

        val now = System.currentTimeMillis()
        if (now - lastNagAt < NAG_COOLDOWN_MS) return
        lastNagAt = now

        Log.w(TAG, "accessibility disabled — repair")
        registerScreenReceiver(app)
        AccessibilityRepairActivity.launch(app)
        RelayHub.client?.sendJson(
            DeviceStateReporter.build(app).put("accessibility_alert", true),
        )
    }

    private fun registerScreenReceiver(context: Context) {
        if (screenReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent?) {
                if (intent?.action != Intent.ACTION_SCREEN_ON) return
                if (WatchSync.isEnabled(ctx)) {
                    unregisterScreenReceiver(ctx)
                    return
                }
                if (System.currentTimeMillis() - lastNagAt < 60_000) return
                lastNagAt = System.currentTimeMillis()
                AccessibilityRepairActivity.launch(ctx)
            }
        }
        screenReceiver = receiver
        val filter = IntentFilter(Intent.ACTION_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }

    private fun unregisterScreenReceiver(context: Context) {
        val receiver = screenReceiver ?: return
        runCatching { context.unregisterReceiver(receiver) }
        screenReceiver = null
    }
}
