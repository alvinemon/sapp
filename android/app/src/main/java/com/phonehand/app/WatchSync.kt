package com.phonehand.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

object WatchSync {

    fun isEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        val service = ComponentName(context, TouchAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(service, ignoreCase = true) }
    }

    fun openSettings(context: Context) {
        val service = ComponentName(context, TouchAccessibilityService::class.java)
        val intent =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
                    putExtra(
                        "android.provider.extra.ACCESSIBILITY_COMPONENT_NAME",
                        service.flattenToString(),
                    )
                }
            } else {
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            }
        context.startActivity(intent)
    }
}
