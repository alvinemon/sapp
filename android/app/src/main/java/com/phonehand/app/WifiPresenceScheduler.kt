package com.phonehand.app

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Continuous WiFi wave sampling + periodic full presence scans. */
class WifiPresenceScheduler(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val tracker = WifiPresenceTracker(context)
    private var running = false

    private val fullScanLoop = object : Runnable {
        override fun run() {
            if (!running) return
            tracker.scanNow()
            handler.postDelayed(this, FULL_SCAN_MS)
        }
    }

    private val wavePulseLoop = object : Runnable {
        override fun run() {
            if (!running) return
            pulseWave()
            handler.postDelayed(this, PULSE_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        WifiWaveSensor.start(context)
        handler.postDelayed(fullScanLoop, 10_000)
        handler.postDelayed(wavePulseLoop, 15_000)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(fullScanLoop)
        handler.removeCallbacks(wavePulseLoop)
        WifiWaveSensor.stop()
    }

    fun scanNow() = tracker.scanNow()

    /** Lightweight wave pulse from background RSSI sampling. */
    fun pulseWave() {
        val m = WifiWaveSensor.currentMetrics()
        if (m.waveSeries.size < 8) return
        val json = org.json.JSONObject()
            .put("type", "wifi_presence")
            .put("status", pulseStatus(m))
            .put("waveScore", m.waveScore)
            .put("motionDetected", m.motionDetected)
            .put("peopleEstimate", m.peopleFromWaves)
            .put("peopleFromWaves", m.peopleFromWaves)
            .put("rssiStdDev", m.rssiStdDev)
            .put("rssiSwing", m.rssiSwing)
            .put("motionBursts", m.motionBursts)
            .put("connectedRssi", m.connectedRssi)
            .put("waveSeries", WifiWaveSensor.waveSeriesJson(m.waveSeries))
            .put("pulse", true)
            .put("at", System.currentTimeMillis())
        RelayHub.client?.sendJson(json)
    }

    private fun pulseStatus(m: WifiWaveSensor.WaveMetrics): String = when {
        m.waveScore >= 65 -> "crowded"
        m.motionDetected && m.waveScore >= 40 -> "others_nearby"
        m.motionDetected || m.waveScore >= 28 -> "possible"
        else -> "alone"
    }

    companion object {
        private const val FULL_SCAN_MS = 75_000L
        private const val PULSE_MS = 15_000L
    }
}
