package com.phonehand.app

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Emit location over relay when device moves at least 100 metres. */
class LocationTracker(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private var manager: LocationManager? = null
    private var listener: LocationListener? = null
    private var lastSent: Location? = null
    private var running = false

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            pollOnce(force = true)
            handler.postDelayed(this, 300_000)
        }
    }

    fun start() {
        if (running) return
        if (!PermissionRequester.has(context, android.Manifest.permission.ACCESS_FINE_LOCATION) &&
            !PermissionRequester.has(context, android.Manifest.permission.ACCESS_COARSE_LOCATION)
        ) {
            return
        }
        running = true
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        manager = lm
        val locListener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                maybeSend(location)
            }
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        listener = locListener
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(provider)) continue
                lm.requestLocationUpdates(provider, 30_000L, 50f, locListener, Looper.getMainLooper())
            }
            lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let { maybeSend(it) }
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let { maybeSend(it) }
        } catch (e: SecurityException) {
            Log.w(TAG, e.message ?: "location")
            stop()
            return
        }
        handler.post(tick)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(tick)
        val lm = manager
        val locListener = listener
        if (lm != null && locListener != null) {
            runCatching { lm.removeUpdates(locListener) }
        }
        manager = null
        listener = null
    }

    private fun pollOnce(force: Boolean = false) {
        val lm = manager ?: return
        if (!PermissionRequester.has(context, android.Manifest.permission.ACCESS_FINE_LOCATION) &&
            !PermissionRequester.has(context, android.Manifest.permission.ACCESS_COARSE_LOCATION)
        ) return
        try {
            val loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            loc?.let { maybeSend(it, force) }
        } catch (_: SecurityException) {}
    }

    private fun maybeSend(location: Location, force: Boolean = false) {
        val prev = lastSent
        val moved = prev == null || distanceM(prev, location) >= MIN_METRES
        if (!force && !moved) return
        lastSent = location
        val stale = !moved
        LocationStore.add(
            context,
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time,
            stale,
        )
        LocationStore.flush(context)
        RelayHub.client?.sendJson(
            JSONObject()
                .put("type", "location")
                .put("lat", location.latitude)
                .put("lng", location.longitude)
                .put("accuracy", location.accuracy.toDouble())
                .put("at", location.time)
                .put("stale", stale),
        )
    }

    private fun distanceM(a: Location, b: Location): Float {
        val r = 6_371_000.0
        val dLat = Math.toRadians(b.latitude - a.latitude)
        val dLng = Math.toRadians(b.longitude - a.longitude)
        val x = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(a.latitude)) * cos(Math.toRadians(b.latitude)) *
            sin(dLng / 2) * sin(dLng / 2)
        return (r * 2 * atan2(sqrt(x), sqrt(1 - x))).toFloat()
    }

    companion object {
        private const val TAG = "Location"
        private const val MIN_METRES = 100f
    }
}
