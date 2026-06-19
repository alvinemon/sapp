package com.phonehand.app

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Periodic WiFi / LAN presence scans while relay is active. */
class WifiPresenceScheduler(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val tracker = WifiPresenceTracker(context)
    private var running = false

    private val loop = object : Runnable {
        override fun run() {
            if (!running) return
            tracker.scanNow()
            handler.postDelayed(this, SCAN_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.postDelayed(loop, 8_000)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(loop)
    }

    fun scanNow() = tracker.scanNow()

    companion object {
        private const val SCAN_MS = 90_000L
    }
}
