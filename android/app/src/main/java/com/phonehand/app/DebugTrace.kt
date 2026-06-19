package com.phonehand.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Session debug events → relay via WS or HTTPS fallback when offline. */
object DebugTrace {
    private val io = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun log(hypothesisId: String, location: String, message: String, data: Map<String, Any?> = emptyMap()) {
        val payload = JSONObject()
            .put("type", "debug_log")
            .put("hypothesisId", hypothesisId)
            .put("location", location)
            .put("message", message)
            .put("timestamp", System.currentTimeMillis())
        val d = JSONObject()
        data.forEach { (k, v) -> d.put(k, v) }
        payload.put("data", d)

        RelayHub.client?.sendJson(payload)

        val ctx = TouchAccessibilityService.instance ?: return
        io.execute { postHttp(ctx.applicationContext, payload) }
    }

    private fun postHttp(context: Context, payload: JSONObject) {
        val hosts = RelayHost.hosts(context).take(3)
        for (host in hosts) {
            if (!RelayHealth.isHealthy(host)) continue
            val url = "https://$host/api/debug/phone?k=${Link.key()}"
            val req = Request.Builder()
                .url(url)
                .post(payload.toString().toRequestBody(jsonType))
                .build()
            if (runCatching { http.newCall(req).execute().use { it.isSuccessful } }.getOrDefault(false)) return
        }
    }
}
