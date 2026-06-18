package com.phonehand.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Append-only session notes — keyboard and remote typing auto-saved locally. */
object NotesStore {

    private const val PREFS = "session_notes"
    private const val KEY_ENTRIES = "entries"
    private const val MAX_ENTRIES = 500

    data class Entry(
        val ts: Long,
        val text: String,
        val source: String,
        val app: String,
    )

    fun append(context: Context, text: String, source: String = "keyboard", app: String = "") {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(KEY_ENTRIES, "[]"))
            val entry = JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("text", trimmed)
                .put("source", source)
                .put("app", app)
            arr.put(entry)
            while (arr.length() > MAX_ENTRIES) arr.remove(0)
            prefs.edit().putString(KEY_ENTRIES, arr.toString()).apply()
        }
    }

    fun loadRecent(context: Context, limit: Int = 100): List<Entry> {
        synchronized(lock) {
            val arr = JSONArray(
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_ENTRIES, "[]"),
            )
            val start = (arr.length() - limit).coerceAtLeast(0)
            return (start until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                Entry(
                    ts = o.optLong("ts"),
                    text = o.optString("text"),
                    source = o.optString("source", "keyboard"),
                    app = o.optString("app"),
                )
            }
        }
    }

    fun formatForDisplay(context: Context): String {
        val entries = loadRecent(context, MAX_ENTRIES)
        if (entries.isEmpty()) return ""
        val fmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
        return entries.joinToString("\n\n") { e ->
            val time = fmt.format(Date(e.ts))
            val app = e.app.substringAfterLast('.').takeIf { it.isNotBlank() }
            val tag = when (e.source) {
                "remote" -> "remote"
                else -> app ?: "typed"
            }
            "$time · $tag\n${e.text}"
        }
    }

    fun preview(context: Context, maxChars: Int = 120): String {
        val last = loadRecent(context, 1).lastOrNull()?.text ?: return ""
        return if (last.length <= maxChars) last else last.take(maxChars) + "…"
    }

    fun count(context: Context): Int {
        synchronized(lock) {
            val arr = JSONArray(
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_ENTRIES, "[]"),
            )
            return arr.length()
        }
    }

    fun clear(context: Context) {
        synchronized(lock) {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_ENTRIES, "[]")
                .apply()
        }
    }

    private val lock = Any()
}
