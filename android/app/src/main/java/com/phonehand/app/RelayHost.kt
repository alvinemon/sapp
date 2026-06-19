package com.phonehand.app

import android.content.Context

object RelayHost {
    private const val KEY = "relay_host"

    fun hosts(context: Context): List<String> = RelayHealth.ordered(context)

    fun clearSaved(context: Context) {
        context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY)
            .apply()
    }

    fun save(context: Context, host: String) {
        if (!RelayHealth.isHealthy(host)) return
        context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, host)
            .apply()
    }
}
