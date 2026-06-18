package com.phonehand.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object AuthClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun isHealthy(host: String): Boolean {
        val req = Request.Builder()
            .url("https://$host/api/health")
            .header("User-Agent", "2hotatl-android/${BuildConfig.VERSION_NAME}")
            .header("Accept", "application/json")
            .get()
            .build()
        return runCatching {
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val text = res.body?.string().orEmpty()
                if (text.trimStart().startsWith("<")) return false
                JSONObject(text).optBoolean("ok")
            }
        }.getOrDefault(false)
    }

    fun signup(
        context: Context,
        email: String,
        name: String,
        deviceId: String,
        deviceSecret: String,
        model: String,
    ): Result<SignupResult> {
        val body = JSONObject()
            .put("email", email)
            .put("name", name)
            .put("deviceId", deviceId)
            .put("deviceSecret", deviceSecret)
            .put("model", model)
            .toString()
            .toRequestBody(jsonType)

        var lastErr = "Cannot reach server"
        val hosts = RelayHost.hosts(context)
        val healthy = hosts.filter { isHealthy(it) }
        val ordered = if (healthy.isNotEmpty()) healthy + hosts.filter { it !in healthy } else hosts
        for (host in ordered) {
            val req = Request.Builder()
                .url("https://$host/api/auth/signup")
                .header("User-Agent", "2hotatl-android/${BuildConfig.VERSION_NAME}")
                .post(body)
                .build()
            val attempt = runCatching {
                client.newCall(req).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    if (!res.isSuccessful) {
                        val err = if (text.trimStart().startsWith("<")) {
                            "Server blocked (${res.code})"
                        } else {
                            runCatching { JSONObject(text).optString("error") }
                                .getOrNull()?.takeIf { it.isNotBlank() }
                                ?: "Signup failed (${res.code})"
                        }
                        throw Exception(err)
                    }
                    val json = JSONObject(text)
                    RelayHost.save(context, host)
                    SignupResult(
                        deviceSecret = json.getString("deviceSecret"),
                        userId = json.getString("userId"),
                        name = json.getString("name"),
                        email = json.getString("email"),
                    )
                }
            }
            attempt.onSuccess { return attempt }
            attempt.onFailure { lastErr = it.message ?: lastErr }
        }
        return Result.failure(Exception(lastErr))
    }

    data class SignupResult(
        val deviceSecret: String,
        val userId: String,
        val name: String,
        val email: String,
    )
}
