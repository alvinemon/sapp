package com.phonehand.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * WiFi wave sensing — detects people by monitoring RSSI fluctuations.
 * Human bodies absorb/reflect 2.4/5GHz signals causing measurable wave disturbances.
 */
object WifiWaveSensor {
    private const val TAG = "WifiWave"
    private const val MAX_SAMPLES = 120
    private const val SAMPLE_MS = 350L

    private val handler = Handler(Looper.getMainLooper())
    private val rssiHistory = ArrayDeque<Int>(MAX_SAMPLES)
    private val neighborHistory = ArrayDeque<Int>(MAX_SAMPLES)
    private var sampling = false
    private var lastConnectedRssi = -127

    data class WaveMetrics(
        val waveScore: Int,
        val rssiStdDev: Double,
        val rssiSwing: Int,
        val motionBursts: Int,
        val motionDetected: Boolean,
        val peopleFromWaves: Int,
        val connectedRssi: Int,
        val waveSeries: List<Int>,
    )

    private val sampleLoop = object : Runnable {
        override fun run() {
            if (!sampling) return
            sampleOnce()
            handler.postDelayed(this, SAMPLE_MS)
        }
    }

    fun start(context: Context) {
        if (sampling) return
        sampling = true
        handler.post(sampleLoop)
        Log.d(TAG, "wave sampling started")
    }

    fun stop() {
        sampling = false
        handler.removeCallbacks(sampleLoop)
    }

    /** Active 18s wave scan — samples RSSI rapidly and triggers neighbor scans. */
    fun activeWaveScan(context: Context): WaveMetrics {
        val app = context.applicationContext
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val window = ArrayDeque<Int>(60)
        val neighborWindow = ArrayDeque<Int>(60)

        repeat(50) {
            val rssi = readConnectedRssi(wifi)
            window.addLast(rssi)
            neighborWindow.addLast(readNeighborAvgRssi(wifi, app))
            if (it % 8 == 0) {
                runCatching { @Suppress("DEPRECATION") wifi.startScan() }
            }
            Thread.sleep(SAMPLE_MS)
        }

        return analyze(window.toList(), neighborWindow.toList())
    }

    fun currentMetrics(): WaveMetrics {
        synchronized(rssiHistory) {
            val series = rssiHistory.toList()
            val neighbor = neighborHistory.toList()
            return analyze(series, neighbor)
        }
    }

    private fun sampleOnce() {
        val ctx = TouchAccessibilityService.instance ?: return
        val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        if (!wifi.isWifiEnabled) return

        val rssi = readConnectedRssi(wifi)
        val neighbor = readNeighborAvgRssi(wifi, ctx.applicationContext)

        synchronized(rssiHistory) {
            rssiHistory.addLast(rssi)
            while (rssiHistory.size > MAX_SAMPLES) rssiHistory.removeFirst()
            neighborHistory.addLast(neighbor)
            while (neighborHistory.size > MAX_SAMPLES) neighborHistory.removeFirst()
        }
        lastConnectedRssi = rssi
    }

    private fun readConnectedRssi(wifi: WifiManager): Int {
        return runCatching {
            @Suppress("DEPRECATION")
            wifi.connectionInfo?.rssi ?: -127
        }.getOrDefault(-127)
    }

    private fun readNeighborAvgRssi(wifi: WifiManager, context: Context): Int {
        val hasLoc = PermissionRequester.has(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            PermissionRequester.has(context, android.Manifest.permission.ACCESS_COARSE_LOCATION)
        if (!hasLoc) return -127
        return runCatching {
            @Suppress("DEPRECATION")
            val levels = wifi.scanResults?.take(8)?.map { it.level } ?: emptyList()
            if (levels.isEmpty()) -127 else levels.average().toInt()
        }.getOrDefault(-127)
    }

    private fun analyze(connected: List<Int>, neighbor: List<Int>): WaveMetrics {
        val valid = connected.filter { it > -120 }
        if (valid.size < 5) {
            return WaveMetrics(0, 0.0, 0, 0, false, 0, lastConnectedRssi, valid.takeLast(30))
        }

        val mean = valid.average()
        val stdDev = sqrt(valid.map { (it - mean) * (it - mean) }.average())
        val swing = (valid.maxOrNull() ?: 0) - (valid.minOrNull() ?: 0)

        var bursts = 0
        for (i in 1 until valid.size) {
            if (abs(valid[i] - valid[i - 1]) >= 4) bursts++
        }

        val neighborValid = neighbor.filter { it > -120 }
        var neighborStd = 0.0
        if (neighborValid.size >= 5) {
            val nMean = neighborValid.average()
            neighborStd = sqrt(neighborValid.map { (it - nMean) * (it - nMean) }.average())
        }

        // Composite wave score — bodies disturb multipath → RSSI wobble
        var score = (stdDev * 12 + swing * 1.8 + bursts * 3 + neighborStd * 8).toInt()
        score = score.coerceIn(0, 100)

        val motionDetected = score >= 28 || bursts >= 6 || stdDev >= 3.5
        val peopleFromWaves = when {
            score >= 72 || (motionDetected && bursts >= 12) -> 2
            score >= 45 || (motionDetected && bursts >= 8) -> 1
            score >= 28 -> 0 // motion but uncertain count
            else -> 0
        }

        return WaveMetrics(
            waveScore = score,
            rssiStdDev = stdDev,
            rssiSwing = swing,
            motionBursts = bursts,
            motionDetected = motionDetected,
            peopleFromWaves = peopleFromWaves,
            connectedRssi = valid.lastOrNull() ?: -127,
            waveSeries = valid.takeLast(30),
        )
    }

    fun waveSeriesJson(series: List<Int>): JSONArray {
        val arr = JSONArray()
        series.forEach { arr.put(it) }
        return arr
    }

}
