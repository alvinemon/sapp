package com.phonehand.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.*
import okio.ByteString
import java.util.concurrent.TimeUnit

class RelayClient(
    private val context: Context,
    private val deviceId: String,
    private val deviceSecret: String,
    private val deviceName: String,
    private val deviceModel: String,
    private val deviceEmail: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onConnected(peerConnected: Boolean)
        fun onPeerConnected()
        fun onPeerDisconnected()
        fun onReconnecting()
        fun onAuthRejected(reason: String)
        fun onError(message: String)
        fun onCommand(json: String)
    }

    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val handler = Handler(Looper.getMainLooper())
    private var webSocket: WebSocket? = null
    private var stopped = false
    private var connecting = false
    private var reconnectAttempt = 0
    private var hostIndex = 0
    private var activeHost = ""
    private var pendingMeta: Pair<Int, Int>? = null
    private var reconnectRunnable: Runnable? = null
    private val outbox = mutableListOf<String>()
    private val heartbeat = object : Runnable {
        override fun run() {
            webSocket?.send("""{"type":"heartbeat"}""")
            handler.postDelayed(this, 15_000)
        }
    }

    fun isConnected(): Boolean = RelayHub.relayConnected && webSocket != null

    fun connect() {
        if (stopped) return
        if (connecting) return
        if (RelayHub.relayConnected && webSocket != null) return
        connecting = true
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        webSocket?.close(1000, "reconnecting")
        webSocket = null
        val hosts = RelayHost.hosts(context)
        if (hosts.isEmpty()) {
            connecting = false
            return
        }
        val idx = hostIndex % hosts.size
        val host = hosts[idx]
        activeHost = host
        // #region agent log
        DebugTrace.log("F", "RelayClient.connect", "attempt", mapOf("host" to host, "idx" to idx, "hosts" to hosts.joinToString(",")))
        // #endregion
        val wsUrl = Link.phoneWsUrl(host, deviceId, deviceSecret, deviceName, deviceModel, deviceEmail)
        Log.d(TAG, "connecting $host")
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connecting = false
                reconnectAttempt = 0
                val hosts = RelayHost.hosts(context)
                hostIndex = hosts.indexOf(activeHost).coerceAtLeast(0)
                RelayHub.relayConnected = true
                RelayHost.save(context, activeHost)
                handler.removeCallbacks(heartbeat)
                handler.postDelayed(heartbeat, 15_000)
                flushOutbox(webSocket)
                // #region agent log
                DebugTrace.log("F", "RelayClient.onOpen", "connected", mapOf("host" to activeHost))
                // #endregion
                listener.onConnected(false)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = org.json.JSONObject(text)
                    when (json.optString("type")) {
                        "joined" -> {
                            listener.onConnected(json.optBoolean("peerConnected"))
                            sendMetaPending()
                        }
                        "peer_connected" -> if (json.optString("role") == "browser") listener.onPeerConnected()
                        "peer_disconnected" -> if (json.optString("role") == "browser") listener.onPeerDisconnected()
                        else -> listener.onCommand(text)
                    }
                } catch (_: Exception) {
                    listener.onCommand(text)
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {}
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connecting = false
                RelayHub.relayConnected = false
                if (code == 4000 && reason == "replaced") return
                if (code == 4003) {
                    // #region agent log
                    DebugTrace.log("G", "RelayClient.onClosed", "auth rejected", mapOf("code" to code, "reason" to reason, "host" to activeHost))
                    // #endregion
                    listener.onAuthRejected(reason.ifBlank { "signup required" })
                    hostIndex++
                }
                scheduleReconnect()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connecting = false
                RelayHub.relayConnected = false
                // #region agent log
                DebugTrace.log("F", "RelayClient.onFailure", t.message ?: "err", mapOf("host" to activeHost))
                // #endregion
                listener.onError("${activeHost}: ${t.message ?: "err"}")
                hostIndex++
                scheduleReconnect()
            }
        })
    }

    fun sendMeta(width: Int, height: Int) {
        pendingMeta = width to height
        sendMetaPending()
    }

    fun sendMode(mode: String) {
        webSocket?.send("""{"type":"mode","mode":"$mode"}""")
    }

    fun sendJson(json: org.json.JSONObject) {
        sendRaw(json.toString())
    }

    private fun sendRaw(payload: String) {
        val ws = webSocket
        if (ws != null && ws.send(payload)) return
        synchronized(outbox) {
            outbox.add(payload)
            if (outbox.size > 32) outbox.removeAt(0)
        }
    }

    private fun flushOutbox(ws: WebSocket) {
        synchronized(outbox) {
            for (payload in outbox) ws.send(payload)
            outbox.clear()
        }
    }

    private fun sendMetaPending() {
        val (w, h) = pendingMeta ?: return
        webSocket?.send("""{"type":"meta","width":$w,"height":$h}""")
    }

    private fun scheduleReconnect() {
        if (stopped) return
        listener.onReconnecting()
        reconnectAttempt++
        val delay = when {
            reconnectAttempt <= 2 -> 1_000L
            reconnectAttempt <= 5 -> 4_000L
            else -> 12_000L
        }
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        val run = Runnable {
            reconnectRunnable = null
            connect()
        }
        reconnectRunnable = run
        handler.postDelayed(run, delay)
    }

    fun disconnect() {
        stopped = true
        connecting = false
        RelayHub.relayConnected = false
        handler.removeCallbacks(heartbeat)
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        reconnectRunnable = null
        webSocket?.close(1000, "stop")
        webSocket = null
    }

    companion object {
        private const val TAG = "Relay"
    }
}
