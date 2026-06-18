package com.phonehand.app

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

object ScreenSummarizer {
    fun compact(tree: JSONObject): String {
        val lines = mutableListOf<String>()
        val title = tree.optString("title", tree.optString("popupTitle", ""))
        val pkg = tree.optString("pkg", "")
        if (title.isNotEmpty()) lines.add("Screen: $title")
        else if (pkg.isNotEmpty()) lines.add("Screen: ${pkg.substringAfterLast('.')}")

        if (tree.optInt("popup", 0) == 1) {
            lines.add("POPUP OPEN — handle popup buttons first")
        }

        val nodes = tree.optJSONArray("nodes") ?: JSONArray()
        val reading = mutableListOf<String>()
        val actions = mutableListOf<Triple<Int, String, Pair<Float, Float>>>()
        var num = 0

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            val clickable = n.optInt("k", 0) == 1 || n.optInt("e", 0) == 1 || n.optInt("s", 0) == 1
            if (!clickable && text.length >= 2 && n.optInt("pop", 0) != 1) {
                if (!reading.contains(text)) reading.add(text)
            }
        }

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val k = n.optInt("k", 0) == 1
            val e = n.optInt("e", 0) == 1
            val s = n.optInt("s", 0) == 1
            if (!k && !e && !s) continue
            val text = n.optString("t", "").ifBlank {
                when {
                    e -> "text field"
                    s -> "scroll"
                    else -> "button"
                }
            }
            val b = n.getJSONArray("b")
            val cx = ((b.getInt(0) + b.getInt(2)) / 2f)
            val cy = ((b.getInt(1) + b.getInt(3)) / 2f)
            num++
            val pop = if (n.optInt("pop", 0) == 1) " POPUP" else ""
            val kind = when {
                e -> "type"
                s -> "scroll"
                else -> "tap"
            }
            actions.add(Triple(num, "#$num [$kind] $text @ (${cx.roundToInt()},${cy.roundToInt()})$pop", cx to cy))
        }

        if (reading.isNotEmpty()) {
            lines.add("Text: " + reading.take(10).joinToString(" | "))
        }
        for ((_, line, _) in actions) lines.add(line)
        return lines.joinToString("\n")
    }

    fun humanSummary(tree: JSONObject): String {
        val compact = compact(tree)
        val actionCount = compact.lines().count { it.startsWith("#") }
        val popup = tree.optInt("popup", 0) == 1
        return buildString {
            append(if (popup) "⚠ Popup open\n" else "")
            append(tree.optString("title", "Phone screen"))
            append("\n")
            append("$actionCount actions available")
        }
    }
}
