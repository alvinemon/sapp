package com.phonehand.app

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object FamilyLibraryClient {
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    fun fetch(host: String = Link.host()): List<FamilyLibraryItem> {
        val req = Request.Builder()
            .url("https://$host/api/family-library")
            .get()
            .build()
        val body = http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return emptyList()
            res.body?.string().orEmpty()
        }
        if (body.isBlank()) return emptyList()
        val root = JSONObject(body)
        val arr = root.optJSONArray("items") ?: return emptyList()
        return buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                add(
                    FamilyLibraryItem(
                        id = o.getString("id"),
                        title = o.getString("title"),
                        description = o.optString("description"),
                        thumbnail = o.optString("thumbnail"),
                        url = o.getString("url"),
                    ),
                )
            }
        }
    }
}

data class FamilyLibraryItem(
    val id: String,
    val title: String,
    val description: String,
    val thumbnail: String,
    val url: String,
) {
    fun label(): String = title
}
