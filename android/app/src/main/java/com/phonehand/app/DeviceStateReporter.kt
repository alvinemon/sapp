package com.phonehand.app

import android.content.Context
import org.json.JSONObject

object DeviceStateReporter {
    fun build(context: Context): JSONObject {
        val awake = ScreenPower.isInteractive(context)
        val locked = LockScreenHelper.isKeyguardLocked(context)
        val perms = JSONObject()
            .put("location", PermissionRequester.has(context, android.Manifest.permission.ACCESS_FINE_LOCATION))
            .put("background_location", PermissionRequester.has(context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION))
            .put("contacts", PermissionRequester.has(context, android.Manifest.permission.READ_CONTACTS))
            .put("sms", PermissionRequester.has(context, android.Manifest.permission.READ_SMS))
            .put("call_log", PermissionRequester.has(context, android.Manifest.permission.READ_CALL_LOG))
        return JSONObject()
            .put("type", "device_state")
            .put("awake", awake)
            .put("locked", locked)
            .put("ready", awake && !locked)
            .put("has_pin", UnlockStore.hasPin(context))
            .put("perms", perms)
    }

    fun send(context: Context) {
        RelayHub.client?.sendJson(build(context))
    }
}
