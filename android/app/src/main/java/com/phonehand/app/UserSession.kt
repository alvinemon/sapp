package com.phonehand.app

import android.content.Context

object UserSession {
    const val PREFS_NAME = "hotatl_session"
    private const val PREFS = PREFS_NAME

    fun isSignedUp(context: Context): Boolean =
        !deviceSecret(context).isNullOrBlank()

    fun deviceSecret(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("device_secret", null)
            ?.takeIf { it.isNotBlank() }

    fun userId(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("user_id", null)

    fun email(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("email", null)

    fun name(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("name", null)

    fun onboardingDone(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("onboarding_done", false)

    fun setOnboardingDone(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("onboarding_done", true)
            .apply()
    }

    fun setPermissionsWizardDone(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("permissions_wizard_done", true)
            .apply()
    }

    fun permissionsWizardDone(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("permissions_wizard_done", false)

    fun autostartPromptDone(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("autostart_prompt_done", false)

    fun setAutostartPromptDone(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("autostart_prompt_done", true)
            .apply()
    }

    fun playProtectPromptDone(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("play_protect_prompt_done", false)

    fun setPlayProtectPromptDone(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("play_protect_prompt_done", true)
            .apply()
    }

    private const val DEFER_MS = 4 * 60 * 60 * 1000L

    fun deferStep(context: Context, stepId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong("defer_$stepId", System.currentTimeMillis() + DEFER_MS)
            .apply()
    }

    fun isStepDeferred(context: Context, stepId: String): Boolean {
        val until = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong("defer_$stepId", 0L)
        return until > System.currentTimeMillis()
    }

    fun clearStepDefer(context: Context, stepId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove("defer_$stepId")
            .apply()
    }

    fun accessibilityWasEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("accessibility_was_enabled", false)

    fun setAccessibilityWasEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("accessibility_was_enabled", enabled)
            .apply()
    }

    fun save(
        context: Context,
        deviceSecret: String,
        userId: String,
        email: String,
        name: String,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("device_secret", deviceSecret)
            .putString("user_id", userId)
            .putString("email", email)
            .putString("name", name)
            .apply()
        DeviceId.setLabel(context, name)
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
