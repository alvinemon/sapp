package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
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

    @Volatile var lastTreeJson: org.json.JSONObject? = null

    private val treeLoop = object : Runnable {
        override fun run() {
            if (!streaming) return
            pushTreeNow()
            mainHandler.postDelayed(this, TREE_MS)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        InputHandler.service = this
        val metrics = resources.displayMetrics
        RelayHub.screenWidth = metrics.widthPixels
        RelayHub.screenHeight = metrics.heightPixels
        registerNetworkWatcher()
        ensureRelay()
    }

    override fun onDestroy() {
        unregisterNetworkWatcher()
        relay?.disconnect()
        relay = null
        RelayHub.client = null
        RelayHub.live = false
        stopStreaming()
        if (InputHandler.service === this) InputHandler.service = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!streaming || event == null) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val pkg = event.packageName?.toString().orEmpty()
                val actTitle = event.text?.joinToString(" ")?.trim().orEmpty()
                if (actTitle.isNotEmpty()) lastActivityTitle = actTitle
                if (pkg != lastWindowPkg) {
                    lastWindowPkg = pkg
                    TreeDiffer.reset()
                    mainHandler.post { pushTreeNow(forceFull = true) }
                } else {
                    scheduleTreePush()
                }
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_SELECTED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            -> scheduleTreePush()
        }
    }

    override fun onInterrupt() {}

    fun ensureRelay() {
        RelayHub.live = true
        if (relay == null) {
            connectRelay()
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
        val secret = UserSession.deviceSecret(this)
            ?: runCatching { DeviceSecret.value(this) }.getOrElse { DeviceId.id(this) }
        TreeDiffer.reset()
        val id = DeviceId.id(this)
        val label = DeviceId.label(this)
        val model = android.os.Build.MODEL
        relay = RelayClient(this, id, secret, label, model, this).also { it.connect() }
    }

    private fun registerNetworkWatcher() {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post { ensureRelay() }
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    mainHandler.post { ensureRelay() }
                }
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
        RelayHub.client = relay
        relay?.sendMeta(RelayHub.screenWidth, RelayHub.screenHeight)
        relay?.sendMode("tree")
        if (!streaming) startStreaming()
        else pushTreeNow(forceFull = true)
    }

    override fun onPeerConnected() = pushTreeNow(forceFull = true)
    override fun onPeerDisconnected() {}
    override fun onReconnecting() {
        Log.d(TAG, "relay reconnecting…")
    }
    override fun onError(message: String) {
        Log.w(TAG, message)
    }
    override fun onCommand(json: String) = InputHandler.handle(this, json)

    fun startStreaming() {
        streaming = true
        TreeDiffer.reset()
        mainHandler.removeCallbacks(treeLoop)
        mainHandler.post(treeLoop)
        pushTreeNow(forceFull = true)
    }

    private fun stopStreaming() {
        streaming = false
        mainHandler.removeCallbacks(treeLoop)
        NodeRegistry.clear()
        TreeDiffer.reset()
    }

    fun scheduleTreePush() {
        val now = System.currentTimeMillis()
        if (now - lastTreeAt < 40) return
        mainHandler.post { pushTreeNow() }
    }

    /** Burst refresh after remote input — UI updates async after gestures. */
    fun scheduleRefreshesAfterInput(forceFull: Boolean = false) {
        val gen = ++refreshGen
        val delays = longArrayOf(60, 150, 320, 600)
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
            if (forceFull) TreeDiffer.reset()
            val result = UiTreeExporter.exportAll(
                this,
                RelayHub.screenWidth,
                RelayHub.screenHeight,
                lastActivityTitle,
            )
            NodeRegistry.update(result.nodesById)
            lastTreeJson = result.json
            val out = TreeDiffer.diff(result.json) ?: return
            RelayHub.client?.sendJson(out)
            lastTreeAt = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.w(TAG, e.message ?: "tree")
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
        val stroke = GestureDescription.StrokeDescription(path, 0, 80)
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
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(80, 800))
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

    companion object {
        private const val TAG = "A11y"
        private const val TREE_MS = 120L

        @Volatile var instance: TouchAccessibilityService? = null
    }
}
