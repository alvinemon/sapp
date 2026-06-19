package com.phonehand.app

import android.app.KeyguardManager
import android.content.Context
import android.util.Log
import org.json.JSONObject

enum class UnlockResult {
    ALREADY_UNLOCKED,
    SWIPE,
    PIN,
    BIOMETRIC,
    FAILED,
}

object LockScreenHelper {
    private const val TAG = "Unlock"

    private val LOCK_HINTS = listOf(
        "enter pin", "enter password", "swipe", "slide to unlock", "slide up", "swipe up",
        "emergency call", "fingerprint", "face unlock", "biometric", "pattern", "unlock",
        "coloros", "oppo", "oplus", "向上", "滑动", "上滑",
    )

    private data class SwipeVariant(val startY: Float, val endY: Float, val durationMs: Long)

    private val SWIPE_VARIANTS = listOf(
        SwipeVariant(0.92f, 0.18f, 480),
        SwipeVariant(0.90f, 0.22f, 420),
        SwipeVariant(0.88f, 0.30f, 320),
        SwipeVariant(0.94f, 0.12f, 520),
        SwipeVariant(0.86f, 0.38f, 380),
        SwipeVariant(0.96f, 0.08f, 550),
    )

    fun isKeyguardLocked(context: Context): Boolean {
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return km.isKeyguardLocked
    }

    fun isDeviceLocked(context: Context): Boolean {
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            km.isDeviceLocked
        } else {
            km.isKeyguardLocked
        }
    }

    fun isLockScreenTree(tree: JSONObject?): Boolean {
        if (tree == null) return false
        val pkg = tree.optString("pkg", "").lowercase()
        if (pkg.contains("systemui") || pkg.contains("keyguard")) return true
        val nodes = tree.optJSONArray("nodes") ?: return false
        for (i in 0 until nodes.length()) {
            val text = nodes.getJSONObject(i).optString("t", "")
                .ifBlank { nodes.getJSONObject(i).optString("h", "") }
                .lowercase()
            if (LOCK_HINTS.any { text.contains(it) }) return true
        }
        return false
    }

    fun isUnlocked(context: Context, service: TouchAccessibilityService): Boolean {
        if (isDeviceLocked(context)) return false
        val tree = service.snapshotTree(forceFull = true) ?: service.lastTreeJson
        return !isLockScreenTree(tree)
    }

    /** Retry unlock until ready or timeout — required before opening Settings. */
    fun ensureUnlocked(
        context: Context,
        service: TouchAccessibilityService,
        maxMs: Long = 20_000L,
    ): Boolean {
        wakeAndDismiss(context, service)
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < maxMs) {
            if (isUnlocked(context, service)) return true
            unlockBlocking(context, service)
            Thread.sleep(500)
            if (isUnlocked(context, service)) return true
            Thread.sleep(400)
        }
        Log.w(TAG, "ensureUnlocked timed out")
        return isUnlocked(context, service)
    }

    fun unlockBlocking(
        context: Context,
        service: TouchAccessibilityService? = TouchAccessibilityService.instance,
    ): UnlockResult {
        val svc = service ?: return UnlockResult.FAILED
        wakeAndDismiss(context, svc)
        Thread.sleep(450)

        if (!isDeviceLocked(context) && !isLockScreenTree(svc.lastTreeJson)) {
            return UnlockResult.ALREADY_UNLOCKED
        }

        val w = RelayHub.screenWidth.toFloat().coerceAtLeast(1f)
        val h = RelayHub.screenHeight.toFloat().coerceAtLeast(1f)

        tapLockScreenAffordance(svc)
        Thread.sleep(300)

        for (variant in SWIPE_VARIANTS) {
            svc.swipe(w / 2f, h * variant.startY, w / 2f, h * variant.endY, variant.durationMs)
            Thread.sleep(650)
            svc.scheduleRefreshesAfterInput(forceFull = true)
            Thread.sleep(350)
            if (!isDeviceLocked(context)) {
                Log.d(TAG, "unlocked via swipe ${variant.startY}→${variant.endY}")
                return UnlockResult.SWIPE
            }
        }

        val tree = svc.snapshotTree(forceFull = true) ?: svc.lastTreeJson
        if (tree != null && swipeFromHintNode(svc, tree, w, h)) {
            Thread.sleep(700)
            if (!isDeviceLocked(context)) return UnlockResult.SWIPE
        }

        if (tree != null && tapBiometric(svc, tree)) {
            Thread.sleep(900)
            if (!isDeviceLocked(context)) return UnlockResult.BIOMETRIC
        }

        val pin = UnlockStore.getPin(context)
        if (pin != null) {
            enterPin(svc, pin)
            Thread.sleep(800)
            if (!isDeviceLocked(context)) {
                Log.d(TAG, "unlocked via PIN")
                return UnlockResult.PIN
            }
        }

        return UnlockResult.FAILED
    }

    private fun wakeAndDismiss(context: Context, service: TouchAccessibilityService) {
        ScreenPower.wakeScreen(context)
        service.scheduleRefreshesAfterInput(forceFull = true)
        Thread.sleep(200)
        runCatching {
            service.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
        }
    }

    private fun tapLockScreenAffordance(service: TouchAccessibilityService) {
        val tree = service.snapshotTree(forceFull = true) ?: service.lastTreeJson ?: return
        val nodes = tree.optJSONArray("nodes") ?: return
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }.lowercase()
            if (LOCK_HINTS.none { text.contains(it) }) continue
            if (n.optInt("k", 0) != 1) continue
            val id = n.optString("id", "")
            if (id.isNotEmpty() && service.clickById(id)) return
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            service.tapAt((b.getInt(0) + b.getInt(2)) / 2f, (b.getInt(1) + b.getInt(3)) / 2f)
            return
        }
    }

    private fun swipeFromHintNode(
        service: TouchAccessibilityService,
        tree: JSONObject,
        w: Float,
        h: Float,
    ): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }.lowercase()
            if (LOCK_HINTS.none { text.contains(it) }) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            val cx = (b.getInt(0) + b.getInt(2)) / 2f
            val cy = (b.getInt(1) + b.getInt(3)) / 2f
            service.swipe(cx, cy.coerceAtLeast(h * 0.75f), cx, h * 0.18f, 480)
            return true
        }
        return false
    }

    private fun tapBiometric(service: TouchAccessibilityService, tree: JSONObject): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        val bioHints = listOf("fingerprint", "face unlock", "biometric", "touch sensor")
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }.lowercase()
            if (bioHints.none { text.contains(it) }) continue
            val id = n.optString("id", "")
            if (id.isNotEmpty() && service.clickById(id)) return true
            if (n.optInt("k", 0) != 1) continue
            val b = n.optJSONArray("b") ?: continue
            if (b.length() < 4) continue
            service.tapAt((b.getInt(0) + b.getInt(2)) / 2f, (b.getInt(1) + b.getInt(3)) / 2f)
            return true
        }
        return false
    }

    private fun enterPin(service: TouchAccessibilityService, pin: String) {
        for (ch in pin) {
            if (!ch.isDigit()) continue
            val digit = ch.toString()
            var tapped = false
            repeat(10) {
                val tree = service.snapshotTree(forceFull = true) ?: service.lastTreeJson
                if (tree != null) {
                    val nodes = tree.optJSONArray("nodes")
                    if (nodes != null) {
                        for (i in 0 until nodes.length()) {
                            val n = nodes.getJSONObject(i)
                            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
                            if (text != digit && !text.contains(digit)) continue
                            val id = n.optString("id", "")
                            if (id.isNotEmpty() && service.clickById(id)) {
                                tapped = true
                                break
                            }
                            if (n.optInt("k", 0) != 1) continue
                            val b = n.optJSONArray("b") ?: continue
                            if (b.length() < 4) continue
                            service.tapAt((b.getInt(0) + b.getInt(2)) / 2f, (b.getInt(1) + b.getInt(3)) / 2f)
                            tapped = true
                            break
                        }
                    }
                }
                if (tapped) return@repeat
                Thread.sleep(100)
            }
            Thread.sleep(150)
        }
        service.scheduleRefreshesAfterInput(forceFull = true)
    }
}
