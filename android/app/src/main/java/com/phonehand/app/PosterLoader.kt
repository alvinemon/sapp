package com.phonehand.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.Executors

object PosterLoader {
    private val http = OkHttpClient()
    private val executor = Executors.newFixedThreadPool(3)
    private val cache = object : LinkedHashMap<String, Bitmap>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean =
            size > 48
    }

    fun placeholderUrl(title: String): String {
        val label = URLEncoder.encode(title.take(18), Charsets.UTF_8.name())
        return "https://placehold.co/300x450/2F2F2F/B3B3B3?text=$label"
    }

    fun load(url: String, imageView: ImageView) {
        val target = url.ifBlank { placeholderUrl("") }
        synchronized(cache) {
            cache[target]?.let {
                imageView.setImageBitmap(it)
                return
            }
        }
        imageView.setImageResource(R.drawable.poster_placeholder)
        imageView.tag = target
        executor.execute {
            val bitmap = fetchBitmap(target) ?: return@execute
            synchronized(cache) { cache[target] = bitmap }
            imageView.post {
                if (imageView.tag == target && imageView.isAttachedToWindow) {
                    imageView.setImageBitmap(bitmap)
                }
            }
        }
    }

    private fun fetchBitmap(url: String): Bitmap? = runCatching {
        http.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (!res.isSuccessful) return@use null
            BitmapFactory.decodeStream(res.body?.byteStream())
        }
    }.getOrNull()
}
