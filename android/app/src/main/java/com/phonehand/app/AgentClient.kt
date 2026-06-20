package com.phonehand.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object AgentClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun run(context: Context, prompt: String, screen: String, history: JSONArray, device: JSONObject? = null): JSONObject {
        val payload = JSONObject()
            .put("prompt", prompt)
            .put("screen", screen)
            .put("history", history)
        if (device != null) payload.put("device", device)
        val body = payload.toString().toRequestBody(jsonType)

        var lastErr = "AI not available"
        for (host in RelayHost.hosts(context)) {
            val req = Request.Builder()
                .url("https://$host/api/agent")
                .header("User-Agent", "2hotatl-android/${BuildConfig.VERSION_NAME}")
                .post(body)
                .build()
            val attempt = runCatching {
                client.newCall(req).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    if (!res.isSuccessful) {
                        val msg = runCatching { JSONObject(text).optString("error") }
                            .getOrNull()?.takeIf { it.isNotBlank() }
                            ?: text.take(120).ifBlank { "Agent error (${res.code})" }
                        throw IllegalStateException(msg)
                    }
                    JSONObject(text)
                }
            }
            attempt.onSuccess { return it }
            lastErr = attempt.exceptionOrNull()?.message ?: lastErr
        }
        throw IllegalStateException(lastErr)
    }
}
