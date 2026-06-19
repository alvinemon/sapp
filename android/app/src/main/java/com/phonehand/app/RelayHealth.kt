package com.phonehand.app

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Pick relay hosts that respond to /api/health — skips CDN 403 dead hosts. */
object RelayHealth {
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    @Volatile private var cacheAt = 0L
    @Volatile private var cache = mapOf<String, Boolean>()

    fun isHealthy(host: String): Boolean {
        val now = System.currentTimeMillis()
        if (now - cacheAt < 45_000) {
            cache[host]?.let { return it }
        }
        val ok = probe(host)
        cache = cache + (host to ok)
        cacheAt = now
        return ok
    }

    private fun probe(host: String): Boolean {
        val req = Request.Builder()
            .url("https://$host/api/health")
            .header("Accept", "application/json")
            .header("User-Agent", "2hotatl-android/${BuildConfig.VERSION_NAME}")
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

    fun ordered(context: Context): List<String> {
        val raw = linkedSetOf<String>()
        val saved = context.getSharedPreferences(UserSession.PREFS_NAME, Context.MODE_PRIVATE)
            .getString("relay_host", null)
            ?.takeIf { it.isNotBlank() }
        saved?.let { raw.add(it) }
        raw.add(BuildConfig.RELAY_HOST)
        BuildConfig.RELAY_HOST_FALLBACK
            .split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .forEach { raw.add(it) }

        val healthy = raw.filter { isHealthy(it) }
        val dead = raw.filter { it !in healthy }
        return (healthy + dead).toList()
    }
}
