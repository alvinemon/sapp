package com.phonehand.app

import android.content.Context
import android.os.Build
import java.util.UUID

object DeviceId {
    private const val PREFS = "hotatl_device"

    fun id(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    fun label(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString("device_label", null)
            ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    fun setLabel(context: Context, label: String) {
        val trimmed = label.trim().take(48)
        if (trimmed.isEmpty()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("device_label", trimmed)
            .apply()
    }

    fun shortId(context: Context): String = id(context).take(8)
}
