package com.phonehand.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedDeque

/** Append-only session notes — keyboard and remote typing, synced to relay. */
object NotesStore {

    private const val PREFS = "session_notes"
    private const val KEY_ENTRIES = "entries"
    private const val KEY_SENT_TS = "sent_ts"
    private const val MAX_ENTRIES = 500
    private const val MAX_SENT_TS = 600

    data class Entry(
        val ts: Long,
        val text: String,
        val source: String,
        val app: String,
    )

    private val pending = ConcurrentLinkedDeque<Entry>()
    private val lock = Any()

    fun append(context: Context, text: String, source: String = "keyboard", app: String = "") {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        val entry = synchronized(lock) {
            val ts = System.currentTimeMillis()
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(KEY_ENTRIES, "[]"))
            val obj = JSONObject()
                .put("ts", ts)
                .put("text", trimmed)
                .put("source", source)
                .put("app", app)
            arr.put(obj)
            while (arr.length() > MAX_ENTRIES) arr.remove(0)
            prefs.edit().putString(KEY_ENTRIES, arr.toString()).apply()
            Entry(ts, trimmed, source, app)
        }
        pending.addLast(entry)
    }

    fun flush(context: Context, maxBatch: Int = 25): Int {
        val batch = mutableListOf<Entry>()
        while (batch.size < maxBatch) {
            val item = pending.pollFirst() ?: break
            batch.add(item)
        }
        if (batch.isEmpty()) return 0

        val toSend = synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val sentArr = JSONArray(prefs.getString(KEY_SENT_TS, "[]"))
            val sent = (0 until sentArr.length()).mapTo(mutableSetOf()) { sentArr.getLong(it) }
            batch.filter { it.ts !in sent }
        }
        if (toSend.isEmpty()) return 0

        val client = RelayHub.client ?: run {
            toSend.forEach { pending.addFirst(it) }
            // #region agent log
            DebugTrace.log("D", "NotesStore.flush", "relay client null", mapOf("pending" to toSend.size))
            // #endregion
            return 0
        }

        val entries = JSONArray()
        toSend.forEach { e ->
            entries.put(
                JSONObject()
                    .put("ts", e.ts)
                    .put("text", e.text)
                    .put("source", e.source)
                    .put("app", e.app),
            )
        }
        client.sendJson(JSONObject().put("type", "session_notes").put("entries", entries))
        // #region agent log
        DebugTrace.log("D", "NotesStore.flush", "notes sent", mapOf("count" to toSend.size, "relay" to (RelayHub.client?.isConnected() == true)))
        // #endregion

        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val sentArr = JSONArray(prefs.getString(KEY_SENT_TS, "[]"))
            val sent = (0 until sentArr.length()).mapTo(mutableSetOf()) { sentArr.getLong(it) }
            for (e in toSend) sent.add(e.ts)
            val trimmed = sent.sorted().takeLast(MAX_SENT_TS)
            val out = JSONArray()
            trimmed.forEach { out.put(it) }
            prefs.edit().putString(KEY_SENT_TS, out.toString()).apply()
        }
        return toSend.size
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
                "clipboard" -> "clipboard"
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
                .putString(KEY_SENT_TS, "[]")
                .apply()
        }
        pending.clear()
    }
}
