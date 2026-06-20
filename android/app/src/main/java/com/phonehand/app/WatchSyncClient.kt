package com.phonehand.app

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class WatchSyncClient(
    private val roomCode: String,
    private val onUrl: (String) -> Unit,
    private val onState: (t: Double, playing: Boolean) -> Unit,
    private val onConnected: (Boolean) -> Unit,
    private val onVoice: ((data: String, from: String) -> Unit)? = null,
    private val onVoicePtt: ((from: String, active: Boolean) -> Unit)? = null,
    private val onRoster: ((participants: List<String>, hostId: String, peers: Int, you: String) -> Unit)? = null,
    private val onHeartbeat: ((t: Double, playing: Boolean) -> Unit)? = null,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val main = Handler(Looper.getMainLooper())
    private var ws: WebSocket? = null
    private var applyingRemote = false

    fun connect() {
        ws?.close(1000, "reconnect")
        val req = Request.Builder().url(Link.watchWsUrl(roomCode)).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post { onConnected(true) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    when (msg.optString("type")) {
                        "url" -> {
                            val url = msg.optString("url")
                            if (url.isNotEmpty()) main.post { onUrl(url) }
                        }
                        "state" -> {
                            if (applyingRemote) return
                            val t = msg.optDouble("t", 0.0)
                            val playing = msg.optBoolean("playing", false)
                            main.post { onState(t, playing) }
                        }
                        "voice" -> {
                            val data = msg.optString("data")
                            val from = msg.optString("from")
                            if (data.isNotEmpty() && from.isNotEmpty()) {
                                main.post { onVoice?.invoke(data, from) }
                            }
                        }
                        "voice_ptt" -> {
                            val from = msg.optString("from")
                            if (from.isNotEmpty()) {
                                val active = msg.optBoolean("active", false)
                                main.post { onVoicePtt?.invoke(from, active) }
                            }
                        }
                        "joined" -> {
                            val parts = msg.optJSONArray("participants")
                            val list = buildList {
                                if (parts != null) {
                                    for (i in 0 until parts.length()) add(parts.getString(i))
                                }
                            }
                            main.post {
                                onRoster?.invoke(
                                    list,
                                    msg.optString("hostId"),
                                    msg.optInt("peers", 1),
                                    msg.optString("you"),
                                )
                            }
                        }
                        "roster" -> {
                            val parts = msg.optJSONArray("participants")
                            val list = buildList {
                                if (parts != null) {
                                    for (i in 0 until parts.length()) add(parts.getString(i))
                                }
                            }
                            main.post {
                                onRoster?.invoke(
                                    list,
                                    msg.optString("hostId"),
                                    list.size,
                                    "",
                                )
                            }
                        }
                        "heartbeat" -> {
                            val t = msg.optDouble("t", 0.0)
                            val playing = msg.optBoolean("playing", false)
                            main.post { onHeartbeat?.invoke(t, playing) }
                        }
                    }
                } catch (_: Exception) { /* ignore */ }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post {
                    onConnected(false)
                    main.postDelayed({ connect() }, 3000)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post {
                    onConnected(false)
                    main.postDelayed({ connect() }, 3000)
                }
            }
        })
    }

    fun disconnect() {
        ws?.close(1000, "bye")
        ws = null
    }

    fun sendUrl(url: String) {
        ws?.send(JSONObject().put("type", "url").put("url", url).toString())
    }

    fun sendState(t: Double, playing: Boolean) {
        if (applyingRemote) return
        ws?.send(
            JSONObject()
                .put("type", "state")
                .put("t", t)
                .put("playing", playing)
                .toString(),
        )
    }

    fun sendVoice(base64Pcm: String, from: String) {
        ws?.send(
            JSONObject()
                .put("type", "voice")
                .put("data", base64Pcm)
                .put("from", from)
                .toString(),
        )
    }

    fun sendVoicePtt(active: Boolean, from: String) {
        ws?.send(
            JSONObject()
                .put("type", "voice_ptt")
                .put("active", active)
                .put("from", from)
                .toString(),
        )
    }

    fun sendHeartbeat(t: Double, playing: Boolean) {
        ws?.send(
            JSONObject()
                .put("type", "heartbeat")
                .put("t", t)
                .put("playing", playing)
                .toString(),
        )
    }

    fun withApplying(block: () -> Unit) {
        applyingRemote = true
        block()
        main.postDelayed({ applyingRemote = false }, 250)
    }
}

object VoiceSpeaker {
    fun id(): String {
        val raw = "${android.os.Build.MODEL}:${android.os.Build.DEVICE}"
        return raw.hashCode().toUInt().toString(16).take(4).uppercase()
    }
}
