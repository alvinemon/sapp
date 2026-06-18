package com.phonehand.app

import android.content.Context
import android.provider.Settings

object DeviceSecret {
    /** Stable per-device secret — Android ID, with install UUID fallback. */
    fun value(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if (!androidId.isNullOrBlank() && androidId != "9774d56d682e549c") {
            return androidId
        }
        return DeviceId.id(context)
    }
}
