package com.phonehand.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log

/** Re-starts keep-alive + relay if the OS kills the process during deep sleep. */
object PersistenceWatchdog {
    private const val TAG = "Watchdog"
    private const val REQUEST_CODE = 8802
    private const val INTERVAL_MS = 15 * 60 * 1000L

    fun schedule(context: Context) {
        if (!UserSession.isSignedUp(context)) return
        val app = context.applicationContext
        val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(app, WatchdogReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            app,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val trigger = SystemClock.elapsedRealtime() + INTERVAL_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
            } else {
                am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "exact alarm denied — using inexact")
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
        }
    }
}
