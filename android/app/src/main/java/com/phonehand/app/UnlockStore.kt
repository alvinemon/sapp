package com.phonehand.app

import android.content.Context
import android.util.Base64

/** Local-only unlock PIN — never sent to server. */
object UnlockStore {
    private const val PREFS = "unlock_store"
    private const val KEY_PIN = "pin"

    fun setPin(context: Context, pin: String) {
        val encoded = Base64.encodeToString(pin.toByteArray(), Base64.NO_WRAP)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PIN, encoded)
            .apply()
    }

    fun getPin(context: Context): String? {
        val encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PIN, null) ?: return null
        return runCatching {
            String(Base64.decode(encoded, Base64.NO_WRAP))
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    fun hasPin(context: Context): Boolean = getPin(context) != null

    fun clearPin(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PIN)
            .apply()
    }
}
