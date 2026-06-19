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
 * Estimates people/devices near the phone via WiFi scan + LAN peer discovery.
 * Requires location permission (Android 10+ WiFi scan rules).
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
            return buildReport("wifi_off", 0, 0, 0, "", emptyList())
        }

        val hasLoc = PermissionRequester.has(app, android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            PermissionRequester.has(app, android.Manifest.permission.ACCESS_COARSE_LOCATION)

        var nearbyAps = 0
        if (hasLoc) {
            runCatching { @Suppress("DEPRECATION") wifi.startScan() }
            Thread.sleep(2800)
            nearbyAps = runCatching {
                @Suppress("DEPRECATION")
                wifi.scanResults?.map { it.BSSID }?.distinct()?.size ?: 0
            }.getOrDefault(0)
        }

        val ssid = runCatching {
            val info = wifi.connectionInfo
            info?.ssid?.trim('"') ?: ""
        }.getOrDefault("")

        probeLan()
        Thread.sleep(400)
        val peers = readArpPeers()
        val lanDevices = peers.size
        val peopleEstimate = estimatePeople(nearbyAps, lanDevices)
        val status = when {
            lanDevices >= 4 || nearbyAps >= 18 -> "crowded"
            lanDevices >= 2 || nearbyAps >= 10 -> "others_nearby"
            lanDevices >= 1 || nearbyAps >= 6 -> "possible"
            else -> "alone"
        }

        return buildReport(status, nearbyAps, lanDevices, peopleEstimate, ssid, peers)
    }

    private fun isOnWifi(cm: ConnectivityManager): Boolean {
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    /** Light gateway ping + small sweep to populate ARP table. */
    private fun probeLan() {
        val base = localSubnetBase() ?: return
        val jobs = (1..24).map { host ->
            Executors.newSingleThreadExecutor().submit {
                runCatching {
                    val addr = InetAddress.getByName("$base.$host")
                    if (addr.isReachable(350)) Unit
                }
            }
        }
        jobs.forEach {
            runCatching { it.get(450, TimeUnit.MILLISECONDS) }
        }
    }

    private fun localSubnetBase(): String? {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val ip = wifi.connectionInfo?.ipAddress ?: return null
        if (ip == 0) return null
        val a = ip and 0xff
        val b = ip shr 8 and 0xff
        val c = ip shr 16 and 0xff
        return "$a.$b.$c"
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
    ): JSONObject {
        val peerArr = JSONArray()
        peers.take(12).forEach { p ->
            peerArr.put(JSONObject().put("ip", p.ip).put("mac", p.mac))
        }
        return JSONObject()
            .put("type", "wifi_presence")
            .put("status", status)
            .put("nearbyAps", nearbyAps)
            .put("lanDevices", lanDevices)
            .put("peopleEstimate", peopleEstimate)
            .put("ssid", ssid)
            .put("peers", peerArr)
            .put("at", System.currentTimeMillis())
    }

    private fun report(json: JSONObject) {
        RelayHub.client?.sendJson(json)
        Log.d(TAG, "presence ${json.optString("status")} aps=${json.optInt("nearbyAps")} lan=${json.optInt("lanDevices")}")
    }

    companion object {
        private const val TAG = "WifiPresence"
    }
}
