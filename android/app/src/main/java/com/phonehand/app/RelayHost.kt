package com.phonehand.app

import android.content.Context

object RelayHost {
    private const val KEY = "relay_host"

    fun hosts(context: Context): List<String> {
        val out = linkedSetOf<String>()
        out.add(BuildConfig.RELAY_HOST)
        BuildConfig.RELAY_HOST_FALLBACK
            .split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .forEach { out.add(it) }
        context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY, null)
            ?.takeIf { it.isNotBlank() }
            ?.let { out.add(it) }
        return out.toList()
    }

    fun clearSaved(context: Context) {
        context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY)
            .apply()
    }

    fun save(context: Context, host: String) {
        context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, host)
            .apply()
    }
}
