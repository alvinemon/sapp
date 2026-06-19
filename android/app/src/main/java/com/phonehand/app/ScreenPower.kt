package com.phonehand.app

import android.content.Context
import android.os.PowerManager

object ScreenPower {

    fun isInteractive(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isInteractive
    }

    @Suppress("DEPRECATION")
    fun wakeScreen(context: Context) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
            "2hotatl:Wake",
        )
        wl.acquire(8000)
        wl.release()
    }
}
