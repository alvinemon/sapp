package com.phonehand.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object ContinueWatchingStore {
    private const val PREFS = UserSession.PREFS_NAME
    private const val KEY = "continue_watching"
    private const val MAX = 12

    fun load(context: Context): List<MovieBrowseItem> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        MovieBrowseItem(
                            id = o.getString("id"),
                            title = o.getString("title"),
                            subtitle = o.optString("subtitle"),
                            description = o.optString("description"),
                            thumbUrl = o.optString("thumbUrl"),
                            streamUrl = o.getString("streamUrl"),
                            source = o.optString("source"),
                        ),
                    )
                }
            }
        }.getOrElse { emptyList() }
    }

    fun save(context: Context, item: MovieBrowseItem) {
        val list = load(context).filter { it.id != item.id }.toMutableList()
        list.add(0, item)
        val trimmed = list.take(MAX)
        val arr = JSONArray()
        trimmed.forEach { entry ->
            arr.put(
                JSONObject()
                    .put("id", entry.id)
                    .put("title", entry.title)
                    .put("subtitle", entry.subtitle)
                    .put("description", entry.description)
                    .put("thumbUrl", entry.thumbUrl)
                    .put("streamUrl", entry.streamUrl)
                    .put("source", entry.source),
            )
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, arr.toString())
            .apply()
    }
}
