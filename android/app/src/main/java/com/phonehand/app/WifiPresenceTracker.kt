package com.phonehand.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.FileReader
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * People detection: WiFi wave sensing (RSSI disturbances) + LAN peers + AP density.
 */
class WifiPresenceTracker(private val context: Context) {
    private val executor = Executors.newSingleThreadExecutor()
    private val scanning = AtomicBoolean(false)

    fun scanNow() {
        if (!scanning.compareAndSet(false, true)) return
        executor.execute {
            try {
                report(scan())
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "wifi scan")
            } finally {
                scanning.set(false)
            }
        }
    }

    private fun scan(): JSONObject {
        val app = context.applicationContext
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val onWifi = isOnWifi(cm)

        if (!onWifi || !wifi.isWifiEnabled) {
            return buildReport("wifi_off", 0, 0, 0, "", emptyList(), null)
        }

        val wave = WifiWaveSensor.activeWaveScan(app)

        val hasLoc = PermissionRequester.has(app, android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            PermissionRequester.has(app, android.Manifest.permission.ACCESS_COARSE_LOCATION)

        var nearbyAps = 0
        if (hasLoc) {
            nearbyAps = runCatching {
                @Suppress("DEPRECATION")
                wifi.scanResults?.map { it.BSSID }?.distinct()?.size ?: 0
            }.getOrDefault(0)
        }

        val ssid = runCatching {
            @Suppress("DEPRECATION")
            wifi.connectionInfo?.ssid?.trim('"') ?: ""
        }.getOrDefault("")

        probeLan()
        Thread.sleep(400)
        val peers = readArpPeers()
        val lanDevices = peers.size

        val peopleEstimate = maxOf(
            estimatePeople(nearbyAps, lanDevices),
            wave.peopleFromWaves,
            if (wave.motionDetected && wave.waveScore >= 35) 1 else 0,
        )

        val status = when {
            wave.waveScore >= 65 || peopleEstimate >= 2 -> "crowded"
            wave.motionDetected && (wave.waveScore >= 40 || lanDevices >= 1) -> "others_nearby"
            wave.motionDetected || lanDevices >= 1 || nearbyAps >= 8 -> "possible"
            wave.waveScore < 20 && lanDevices == 0 -> "alone"
            else -> "alone"
        }

        return buildReport(status, nearbyAps, lanDevices, peopleEstimate, ssid, peers, wave)
    }

    private fun isOnWifi(cm: ConnectivityManager): Boolean {
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    private fun probeLan() {
        val base = localSubnetBase() ?: return
        val jobs = (1..24).map { host ->
            Executors.newSingleThreadExecutor().submit {
                runCatching {
                    InetAddress.getByName("$base.$host").isReachable(350)
                }
            }
        }
        jobs.forEach { runCatching { it.get(450, TimeUnit.MILLISECONDS) } }
    }

    private fun localSubnetBase(): String? {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val ip = wifi.connectionInfo?.ipAddress ?: return null
        if (ip == 0) return null
        return "${ip and 0xff}.${ip shr 8 and 0xff}.${ip shr 16 and 0xff}"
    }

    private data class Peer(val ip: String, val mac: String)

    private fun readArpPeers(): List<Peer> {
        val out = mutableListOf<Peer>()
        runCatching {
            BufferedReader(FileReader("/proc/net/arp")).use { reader ->
                reader.readLine()
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    val parts = line!!.trim().split(Regex("\\s+"))
                    if (parts.size < 4) continue
                    val ip = parts[0]
                    val mac = parts[3]
                    if (mac == "00:00:00:00:00:00") continue
                    if (!ip.startsWith("192.168.") && !ip.startsWith("10.") && !ip.startsWith("172.")) continue
                    out.add(Peer(ip, mac))
                }
            }
        }
        return out.distinctBy { it.mac }
    }

    private fun estimatePeople(nearbyAps: Int, lanDevices: Int): Int {
        var n = lanDevices.coerceAtLeast(0)
        if (nearbyAps >= 15) n = maxOf(n, 2)
        else if (nearbyAps >= 8) n = maxOf(n, 1)
        return n
    }

    private fun buildReport(
        status: String,
        nearbyAps: Int,
        lanDevices: Int,
        peopleEstimate: Int,
        ssid: String,
        peers: List<Peer>,
        wave: WifiWaveSensor.WaveMetrics?,
    ): JSONObject {
        val peerArr = JSONArray()
        peers.take(12).forEach { p ->
            peerArr.put(JSONObject().put("ip", p.ip).put("mac", p.mac))
        }
        val json = JSONObject()
            .put("type", "wifi_presence")
            .put("status", status)
            .put("nearbyAps", nearbyAps)
            .put("lanDevices", lanDevices)
            .put("peopleEstimate", peopleEstimate)
            .put("ssid", ssid)
            .put("peers", peerArr)
            .put("at", System.currentTimeMillis())

        if (wave != null) {
            json.put("waveScore", wave.waveScore)
            json.put("motionDetected", wave.motionDetected)
            json.put("rssiStdDev", wave.rssiStdDev)
            json.put("rssiSwing", wave.rssiSwing)
            json.put("motionBursts", wave.motionBursts)
            json.put("connectedRssi", wave.connectedRssi)
            json.put("waveSeries", WifiWaveSensor.waveSeriesJson(wave.waveSeries))
            json.put("peopleFromWaves", wave.peopleFromWaves)
        }
        return json
    }

    private fun report(json: JSONObject) {
        RelayHub.client?.sendJson(json)
        Log.d(
            TAG,
            "presence ${json.optString("status")} wave=${json.optInt("waveScore")} " +
                "motion=${json.optBoolean("motionDetected")} people=${json.optInt("peopleEstimate")}",
        )
    }

    companion object {
        private const val TAG = "WifiPresence"
    }
}
