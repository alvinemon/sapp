package com.phonehand.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils

object NotificationAccess {
    fun isEnabled(context: Context): Boolean {
        val flat = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        val cn = ComponentName(context, NotificationCaptureService::class.java)
        return flat.split(":").any { part ->
            TextUtils.equals(cn.flattenToString(), ComponentName.unflattenFromString(part)?.flattenToString())
        }
    }

    fun openSettings(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }
}
