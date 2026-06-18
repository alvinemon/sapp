package com.phonehand.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

/** Local activity cache — batches deltas to the relay as activity_feed. */
object ActivityStore {
    data class Item(
        val id: String,
        val type: String,
        val app: String,
        val who: String,
        val preview: String,
        val at: Long,
    )

    private const val MAX_ITEMS = 300
    private const val PREFS = "activity_store"
    private const val KEY_ITEMS = "items"

    private val pending = ConcurrentLinkedDeque<Item>()
    private val lock = Any()

    fun add(context: Context, type: String, app: String, who: String, preview: String, at: Long = System.currentTimeMillis()) {
        val cleanPreview = preview.trim().take(240)
        if (cleanPreview.isEmpty() && who.isBlank()) return
        val id = "${type}_${at}_${who.hashCode()}_${cleanPreview.hashCode()}"
        val item = Item(id, type, app.trim(), who.trim(), cleanPreview, at)
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(KEY_ITEMS, "[]"))
            val last = if (arr.length() > 0) arr.optJSONObject(arr.length() - 1) else null
            if (last != null &&
                last.optString("type") == type &&
                last.optString("who") == item.who &&
                last.optString("preview") == item.preview &&
                at - last.optLong("at") < 5_000
            ) {
                return
            }
            arr.put(itemToJson(item))
            while (arr.length() > MAX_ITEMS) arr.remove(0)
            prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
        }
        pending.addLast(item)
    }

    fun flush(context: Context, maxBatch: Int = 25): Int {
        val batch = mutableListOf<Item>()
        while (batch.size < maxBatch) {
            val item = pending.pollFirst() ?: break
            batch.add(item)
        }
        if (batch.isEmpty()) return 0
        val client = RelayHub.client ?: return 0
        val items = JSONArray()
        batch.forEach { items.put(itemToJson(it)) }
        client.sendJson(JSONObject().put("type", "activity_feed").put("items", items))
        return batch.size
    }

    fun recent(context: Context, limit: Int = 50): List<Item> {
        synchronized(lock) {
            val arr = JSONArray(
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_ITEMS, "[]"),
            )
            val start = (arr.length() - limit).coerceAtLeast(0)
            return (start until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                Item(
                    id = o.optString("id"),
                    type = o.optString("type"),
                    app = o.optString("app"),
                    who = o.optString("who"),
                    preview = o.optString("preview"),
                    at = o.optLong("at"),
                )
            }
        }
    }

    private fun itemToJson(item: Item): JSONObject =
        JSONObject()
            .put("id", item.id)
            .put("type", item.type)
            .put("app", item.app)
            .put("who", item.who)
            .put("preview", item.preview)
            .put("at", item.at)
}
