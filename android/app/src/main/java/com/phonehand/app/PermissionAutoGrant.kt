package com.phonehand.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Lightning-fast rule-based permission handler — dialogs, settings toggles, scroll.
 */
object PermissionAutoGrant {
    private const val TAG = "PermAutoGrant"
    private const val MAX_DURATION_MS = 45_000L
    private const val MAX_TAPS = 60
    private const val TAP_INTERVAL_MS = 50L
    private const val SCAN_INTERVAL_MS = 70L
    private const val STUCK_THRESHOLD = 3

    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private val lastTaps = AtomicInteger(0)

    private val ALLOW_KEYWORDS = listOf(
        "allow", "while using", "while in use", "during use", "all the time",
        "only this time", "just once", "always", "ok", "continue", "accept",
        "got it", "turn on", "yes", "grant", "permit", "enable", "agree",
        "precise", "approximate", "nearby", "notifications", "allow all",
    )

    private val DENY_KEYWORDS = listOf(
        "don't allow", "dont allow", "deny", "cancel", "no thanks", "not now",
        "decline", "reject", "skip",
    )

    private val DENIED_ROW_KEYWORDS = listOf(
        "not allowed", "denied", "don't allow", "dont allow", "ask every time",
        "while using the app", "only while using", "no access",
    )

    private val NAV_KEYWORDS = listOf("permissions", "app permissions", "permission manager")

    enum class Mode { DIALOG, SETTINGS }

    interface Callback {
        fun onLog(line: String)
        fun onDone(taps: Int)
        fun onError(message: String)
    }

    data class TapTarget(val cx: Float, val cy: Float, val label: String, val score: Int)

    fun isRunning(): Boolean = running.get()

    fun lastTapCount(): Int = lastTaps.get()

    fun runLightning(context: Context) {
        runSilent(context)
        executor.execute {
            Thread.sleep(1800)
            if (!running.get()) runSilentBlocking(context, 20_000)
            Thread.sleep(2500)
            if (!running.get()) runSilentBlocking(context, 15_000)
        }
    }

    fun runSettingsPass(context: Context, label: String, maxMs: Long) {
        runBlocking(context, Mode.SETTINGS, maxMs, object : Callback {
            override fun onLog(line: String) {
                Log.d(TAG, "$label: $line")
                SetupReporter.progress(line)
            }
            override fun onDone(taps: Int) { lastTaps.addAndGet(taps) }
            override fun onError(message: String) { Log.w(TAG, message) }
        })
    }

    fun runSilentBlocking(context: Context, maxMs: Long = MAX_DURATION_MS) {
        runBlocking(context, Mode.DIALOG, maxMs, silentCallback())
    }

    fun run(context: Context, cb: Callback) {
        if (!running.compareAndSet(false, true)) {
            cb.onError("Already running")
            return
        }
        executor.execute {
            try {
                runLoop(context, cb, Mode.DIALOG, MAX_DURATION_MS)
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "grant")
                cb.onError(e.message ?: "Failed")
            } finally {
                running.set(false)
            }
        }
    }

    private fun runBlocking(context: Context, mode: Mode, maxMs: Long, cb: Callback) {
        if (!running.compareAndSet(false, true)) return
        try {
            runLoop(context, cb, mode, maxMs)
        } catch (e: Exception) {
            cb.onError(e.message ?: "Failed")
        } finally {
            running.set(false)
        }
    }

    fun runSilent(context: Context) {
        run(context, silentCallback())
    }

    private fun silentCallback() = object : Callback {
        override fun onLog(line: String) {
            Log.d(TAG, line)
            SetupReporter.progress(line)
        }
        override fun onDone(taps: Int) {
            lastTaps.set(taps)
            Log.d(TAG, "setup_takeover done — $taps action(s)")
        }
        override fun onError(message: String) {
            Log.w(TAG, "setup_takeover: $message")
            SetupReporter.error(message)
        }
    }

    fun cancel() { running.set(false) }

    fun findNavigationTarget(tree: JSONObject, keywords: List<String>): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        var best: TapTarget? = null
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank()) continue
            val lower = text.lowercase()
            if (keywords.none { lower.contains(it) }) continue
            if (n.optInt("k", 0) != 1) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f
            val score = 30 + if (lower.contains("permission")) 20 else 0
            val target = TapTarget(cx, cy, text.take(40), score)
            if (best == null || target.score > best.score) best = target
        }
        return best
    }

    private fun runLoop(context: Context, cb: Callback, mode: Mode, maxDurationMs: Long) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            cb.onError("Watch Together is off — enable in Accessibility")
            return
        }

        val start = System.currentTimeMillis()
        var taps = 0
        var consecutiveMisses = 0
        var agentFallbacks = 0
        var scrollAttempts = 0

        while (running.get()) {
            val elapsed = System.currentTimeMillis() - start
            if (elapsed >= maxDurationMs || taps >= MAX_TAPS) break

            val tree = service.snapshotTree() ?: service.lastTreeJson
            if (tree == null) {
                Thread.sleep(SCAN_INTERVAL_MS)
                continue
            }

            val target = if (mode == Mode.SETTINGS) findSettingsTarget(tree) else findBestTarget(tree)
            if (target != null) {
                consecutiveMisses = 0
                scrollAttempts = 0
                cb.onLog("Allow → ${target.label}")
                service.tapAt(target.cx, target.cy)
                taps++
                Thread.sleep(TAP_INTERVAL_MS)
                service.scheduleRefreshesAfterInput()
                Thread.sleep(SCAN_INTERVAL_MS)
            } else {
                consecutiveMisses++
                if (mode == Mode.SETTINGS && consecutiveMisses >= 2 && scrollAttempts < 8) {
                    scrollAttempts++
                    consecutiveMisses = 0
                    val w = RelayHub.screenWidth.toFloat()
                    val h = RelayHub.screenHeight.toFloat()
                    service.swipe(w / 2f, h * 0.75f, w / 2f, h * 0.25f, 250)
                    Thread.sleep(400)
                    continue
                }
                if (consecutiveMisses >= STUCK_THRESHOLD && agentFallbacks < 2) {
                    agentFallbacks++
                    consecutiveMisses = 0
                    cb.onLog("AI reading screen…")
                    if (tryAgentFallback(context, tree, cb, mode)) {
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

    private fun findSettingsTarget(tree: JSONObject): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        var bestDenied: TapTarget? = null
        var bestAllow: TapTarget? = null

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank()) continue
            val lower = text.lowercase()
            val clickable = n.optInt("k", 0) == 1
            val checkable = n.optInt("x", -1) >= 0
            val checked = n.optInt("x", 0) == 1
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f

            if (checkable && !checked && matchesAllow(text) && !matchesDeny(text)) {
                val t = TapTarget(cx, cy, text.take(40), 80)
                if (bestAllow == null || t.score > bestAllow.score) bestAllow = t
            }
            if (clickable && DENIED_ROW_KEYWORDS.any { lower.contains(it) }) {
                val t = TapTarget(cx, cy, text.take(40), 70)
                if (bestDenied == null || t.score > bestDenied.score) bestDenied = t
            }
            if (clickable && matchesAllow(text) && !matchesDeny(text)) {
                val t = TapTarget(cx, cy, text.take(40), scoreTarget(text, false, n.optString("r", ""), false))
                if (bestAllow == null || t.score > bestAllow.score) bestAllow = t
            }
        }
        return bestDenied ?: bestAllow ?: findBestTarget(tree)
    }

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
                    val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, true))
                    if (best == null || target.score > best.score) best = target
                }
                continue
            }
            if (!clickable || text.isBlank()) continue
            if (matchesDeny(text)) continue
            if (!matchesAllow(text)) continue
            val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, false))
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

    private fun matchesAllow(text: String): Boolean =
        ALLOW_KEYWORDS.any { text.lowercase().contains(it) }

    private fun matchesDeny(text: String): Boolean =
        DENY_KEYWORDS.any { text.lowercase().contains(it) }

    private fun tryAgentFallback(context: Context, tree: JSONObject, cb: Callback, mode: Mode): Boolean {
        val service = TouchAccessibilityService.instance ?: return false
        val screen = ScreenSummarizer.compact(tree)
        val prompt = if (mode == Mode.SETTINGS) {
            "In app permission settings, tap any Not allowed row then Allow or All the time. Or tap Allow switches. Never Deny."
        } else {
            "Tap Allow, While using the app, All the time, OK, Continue. One tap. Never Deny or Cancel."
        }
        var tapped = false
        val latch = java.util.concurrent.CountDownLatch(1)
        LocalAgent.run(context, prompt, screen, object : LocalAgent.Callback {
            override fun onLog(line: String) { cb.onLog("AI: $line") }
            override fun onDone() { tapped = true; latch.countDown() }
            override fun onError(message: String) { cb.onLog("AI: $message"); latch.countDown() }
        })
        latch.await(8, java.util.concurrent.TimeUnit.SECONDS)
        service.scheduleRefreshesAfterInput()
        return tapped
    }
}
