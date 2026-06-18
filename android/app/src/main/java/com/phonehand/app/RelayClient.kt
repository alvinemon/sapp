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
    private val listener: Listener,
) {
    interface Listener {
        fun onConnected(peerConnected: Boolean)
        fun onPeerConnected()
        fun onPeerDisconnected()
        fun onReconnecting()
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
    private var reconnectAttempt = 0
    private var hostIndex = 0
    private var activeHost = ""
    private var pendingMeta: Pair<Int, Int>? = null
    private val heartbeat = object : Runnable {
        override fun run() {
            webSocket?.send("""{"type":"heartbeat"}""")
            handler.postDelayed(this, 15_000)
        }
    }

    fun connect() {
        if (stopped) return
        webSocket?.close(1000, "reconnecting")
        webSocket = null
        val hosts = RelayHost.hosts(context)
        if (hosts.isEmpty()) return
        val host = hosts[hostIndex % hosts.size]
        activeHost = host
        val wsUrl = Link.phoneWsUrl(host, deviceId, deviceSecret, deviceName, deviceModel)
        Log.d(TAG, "connecting $host")
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempt = 0
                hostIndex = 0
                RelayHub.relayConnected = true
                RelayHost.save(context, activeHost)
                handler.removeCallbacks(heartbeat)
                handler.postDelayed(heartbeat, 15_000)
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
                RelayHub.relayConnected = false
                if (code == 4000 && reason == "replaced") return
                if (code == 4003) hostIndex++
                scheduleReconnect()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                RelayHub.relayConnected = false
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
        webSocket?.send(json.toString())
    }

    private fun sendMetaPending() {
        val (w, h) = pendingMeta ?: return
        webSocket?.send("""{"type":"meta","width":$w,"height":$h}""")
    }

    private fun scheduleReconnect() {
        if (stopped) return
        listener.onReconnecting()
        reconnectAttempt++
        val delay = (500L * kotlin.math.min(reconnectAttempt, 20)).coerceAtMost(8_000L)
        handler.postDelayed({ connect() }, delay)
    }

    fun disconnect() {
        stopped = true
        RelayHub.relayConnected = false
        handler.removeCallbacks(heartbeat)
        handler.removeCallbacksAndMessages(null)
        webSocket?.close(1000, "stop")
        webSocket = null
    }

    companion object {
        private const val TAG = "Relay"
    }
}
