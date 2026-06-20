package com.phonehand.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

/** Captured notifications — grouped by app/day on device, synced to relay. */
object NotificationStore {
    data class Entry(
        val id: String,
        val pkg: String,
        val app: String,
        val title: String,
        val text: String,
        val at: Long,
    )

    private const val PREFS = "notification_store"
    private const val KEY_ITEMS = "items"
    private const val MAX_ITEMS = 2000

    private val pending = ConcurrentLinkedDeque<Entry>()
    private val lock = Any()

    fun add(context: Context, pkg: String, app: String, title: String, text: String, at: Long = System.currentTimeMillis()) {
        val body = text.trim()
        if (title.isBlank() && body.isBlank()) return
        val id = "n_${at}_${pkg.hashCode()}_${title.hashCode()}_${body.hashCode()}"
        val entry = Entry(id, pkg, app, title.trim(), body, at)
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(KEY_ITEMS, "[]"))
            arr.put(entryToJson(entry))
            while (arr.length() > MAX_ITEMS) arr.remove(0)
            prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
        }
        pending.addLast(entry)
    }

    fun all(context: Context): List<Entry> = load(context, MAX_ITEMS)

    fun load(context: Context, limit: Int = 500, fromMs: Long = 0L, toMs: Long = Long.MAX_VALUE): List<Entry> {
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
                    id = o.optString("id"),
                    pkg = o.optString("pkg"),
                    app = o.optString("app"),
                    title = o.optString("title"),
                    text = o.optString("text"),
                    at = at,
                )
            }.sortedByDescending { it.at }.take(limit)
        }
    }

    fun countByDay(context: Context, dayStartMs: Long, dayEndMs: Long): Int =
        load(context, MAX_ITEMS, dayStartMs, dayEndMs).size

    fun byApp(context: Context, fromMs: Long = 0L, toMs: Long = Long.MAX_VALUE): Map<String, List<Entry>> =
        load(context, MAX_ITEMS, fromMs, toMs).groupBy { it.app.ifBlank { it.pkg } }

    fun flush(context: Context, maxBatch: Int = 30): Int {
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
        batch.forEach { items.put(entryToJson(it)) }
        client.sendJson(JSONObject().put("type", "notification_batch").put("items", items))
        return batch.size
    }

    private fun entryToJson(e: Entry): JSONObject =
        JSONObject()
            .put("id", e.id)
            .put("pkg", e.pkg)
            .put("app", e.app)
            .put("title", e.title)
            .put("text", e.text)
            .put("ts", e.at)
            .put("at", e.at)
}
