package com.phonehand.app

import org.json.JSONArray
import org.json.JSONObject

/** Extract chat partner and visible messages from messenger accessibility trees. */
object MessengerParser {
    private val MESSENGER_PKGS = mapOf(
        "com.whatsapp" to "WhatsApp",
        "com.whatsapp.w4b" to "WhatsApp Business",
        "org.telegram.messenger" to "Telegram",
        "org.thunderdog.challegram" to "Telegram",
        "com.google.android.apps.messaging" to "Messages",
        "com.samsung.android.messaging" to "Messages",
        "com.facebook.orca" to "Messenger",
        "com.facebook.mlite" to "Messenger Lite",
        "com.instagram.android" to "Instagram",
        "com.discord" to "Discord",
        "com.snapchat.android" to "Snapchat",
        "com.Slack" to "Slack",
        "com.twitter.android" to "X",
        "com.zhiliaoapp.musically" to "TikTok",
    )

    private val SKIP_TEXT = setOf(
        "type a message",
        "message",
        "search",
        "camera",
        "voice message",
        "attach",
        "emoji",
        "send",
        "back",
        "menu",
        "call",
        "video",
        "more options",
    )

    fun appLabel(pkg: String): String? = MESSENGER_PKGS[pkg]

    fun isMessenger(pkg: String): Boolean = pkg in MESSENGER_PKGS

    data class ChatSnapshot(
        val partner: String,
        val messages: List<String>,
    )

    fun parse(tree: JSONObject, pkg: String): ChatSnapshot? {
        if (!isMessenger(pkg)) return null
        val nodes = tree.optJSONArray("nodes") ?: return null
        val title = tree.optString("title", "").trim()
        val screenTitle = tree.optString("popupTitle", "").trim()

        val texts = mutableListOf<Pair<Int, String>>()
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }.trim()
            if (text.length < 2 || text.length > 500) continue
            if (SKIP_TEXT.contains(text.lowercase())) continue
            if (text.all { it.isDigit() || it == '+' || it == '-' || it == ' ' }) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val top = b.getInt(1)
            texts.add(top to text)
        }
        if (texts.isEmpty()) return null

        texts.sortBy { it.first }
        val partner = guessPartner(title, screenTitle, texts.map { it.second })
        val messages = texts.map { it.second }
            .distinct()
            .filter { it != partner }
            .takeLast(6)
        if (partner.isBlank() && messages.isEmpty()) return null
        return ChatSnapshot(partner, messages)
    }

    fun ingest(context: android.content.Context, tree: JSONObject, pkg: String) {
        val label = appLabel(pkg) ?: return
        val snap = parse(tree, pkg) ?: return
        val partner = snap.partner.ifBlank { "Chat" }
        val latest = snap.messages.lastOrNull() ?: return
        ActivityStore.add(
            context,
            type = "chat",
            app = label,
            who = partner,
            preview = latest,
        )
        snap.messages.dropLast(1).takeLast(2).forEach { msg ->
            ActivityStore.add(
                context,
                type = "message",
                app = label,
                who = partner,
                preview = msg,
                at = System.currentTimeMillis() - 1,
            )
        }
    }

    private fun guessPartner(title: String, popupTitle: String, texts: List<String>): String {
        val candidates = listOf(title, popupTitle).filter { it.length in 2..60 }
        for (c in candidates) {
            if (!SKIP_TEXT.contains(c.lowercase())) return c
        }
        val first = texts.firstOrNull { t ->
            t.length in 2..40 &&
                !SKIP_TEXT.contains(t.lowercase()) &&
                !t.contains('\n')
        }
        return first.orEmpty()
    }
}
