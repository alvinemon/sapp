package com.phonehand.app

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

object ScreenSummarizer {
    private const val MAX_ACTIONS = 20
    private const val MAX_CHARS = 2200

    fun targetCoords(tree: JSONObject, num: Int): Pair<Float, Float>? =
        buildTargetMap(tree)[num]

    fun buildTargetMap(tree: JSONObject): Map<Int, Pair<Float, Float>> {
        val map = linkedMapOf<Int, Pair<Float, Float>>()
        val nodes = tree.optJSONArray("nodes") ?: return map
        var n = 0
        for (i in 0 until nodes.length()) {
            val node = nodes.getJSONObject(i)
            if (node.optInt("d", 0) == 1) continue
            val k = node.optInt("k", 0) == 1
            val e = node.optInt("e", 0) == 1
            val s = node.optInt("s", 0) == 1
            if (!k && !e && !s) continue
            val b = node.getJSONArray("b")
            val cx = ((b.getInt(0) + b.getInt(2)) / 2f)
            val cy = ((b.getInt(1) + b.getInt(3)) / 2f)
            n++
            map[n] = cx to cy
        }
        return map
    }

    fun compact(tree: JSONObject): String {
        val lines = mutableListOf<String>()
        val pkg = tree.optString("pkg", "")
        if (pkg.isNotEmpty()) lines.add("App: $pkg")
        val title = tree.optString("title", tree.optString("popupTitle", ""))
        if (title.isNotEmpty()) lines.add("Screen: $title")
        else if (pkg.isNotEmpty()) lines.add("Screen: ${pkg.substringAfterLast('.')}")

        if (tree.optInt("popup", 0) == 1) {
            lines.add("⚠ POPUP OPEN — tap popup targets first")
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

        val sorted = (0 until nodes.length()).map { nodes.getJSONObject(it) }
            .filter { it.optInt("d", 0) != 1 }
            .filter {
                it.optInt("k", 0) == 1 || it.optInt("e", 0) == 1 || it.optInt("s", 0) == 1
            }
            .sortedWith(compareByDescending<JSONObject> { it.optInt("pop", 0) }
                .thenBy { it.getJSONArray("b").getInt(1) }
                .thenBy { it.getJSONArray("b").getInt(0) })

        for (n in sorted) {
            val k = n.optInt("k", 0) == 1
            val e = n.optInt("e", 0) == 1
            val s = n.optInt("s", 0) == 1
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
            lines.add("Visible text: " + reading.take(8).joinToString(" | "))
        }
        for ((_, line, _) in actions.take(MAX_ACTIONS)) lines.add(line)
        if (actions.isEmpty()) lines.add("(No targets — try back/home/swipe/unlock)")

        val out = lines.joinToString("\n")
        return if (out.length > MAX_CHARS) out.take(MAX_CHARS) + "…" else out
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
