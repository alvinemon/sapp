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

    fun isKeyguardLocked(context: Context): Boolean {
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return km.isKeyguardLocked
    }

    fun isLockScreenTree(tree: JSONObject?): Boolean {
        if (tree == null) return false
        val nodes = tree.optJSONArray("nodes") ?: return false
        val hints = listOf(
            "enter pin", "enter password", "swipe", "emergency call",
            "fingerprint", "face unlock", "pattern", "unlock",
        )
        for (i in 0 until nodes.length()) {
            val text = nodes.getJSONObject(i).optString("t", "")
                .ifBlank { nodes.getJSONObject(i).optString("h", "") }
                .lowercase()
            if (hints.any { text.contains(it) }) return true
        }
        return false
    }

    fun unlockBlocking(context: Context, service: TouchAccessibilityService? = TouchAccessibilityService.instance): UnlockResult {
        val svc = service ?: return UnlockResult.FAILED
        ScreenPower.wakeScreen(context)
        Thread.sleep(400)
        if (!isKeyguardLocked(context) && !isLockScreenTree(svc.lastTreeJson)) {
            return UnlockResult.ALREADY_UNLOCKED
        }

        val w = RelayHub.screenWidth.toFloat()
        val h = RelayHub.screenHeight.toFloat()
        svc.swipe(w / 2f, h * 0.88f, w / 2f, h * 0.32f, 280)
        Thread.sleep(650)
        svc.scheduleRefreshesAfterInput(forceFull = true)
        Thread.sleep(300)
        if (!isKeyguardLocked(context)) {
            Log.d(TAG, "unlocked via swipe")
            return UnlockResult.SWIPE
        }

        val tree = svc.snapshotTree(forceFull = true) ?: svc.lastTreeJson
        if (tree != null && tapBiometric(svc, tree)) {
            Thread.sleep(800)
            if (!isKeyguardLocked(context)) return UnlockResult.BIOMETRIC
        }

        val pin = UnlockStore.getPin(context)
        if (pin != null) {
            enterPin(svc, pin)
            Thread.sleep(700)
            if (!isKeyguardLocked(context)) {
                Log.d(TAG, "unlocked via PIN")
                return UnlockResult.PIN
            }
        }

        return UnlockResult.FAILED
    }

    private fun tapBiometric(service: TouchAccessibilityService, tree: JSONObject): Boolean {
        val nodes = tree.optJSONArray("nodes") ?: return false
        val bioHints = listOf("fingerprint", "face unlock", "biometric", "touch sensor")
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val text = n.optString("t", "").ifBlank { n.optString("h", "") }.lowercase()
            if (bioHints.none { text.contains(it) }) continue
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
            repeat(8) {
                val tree = service.snapshotTree() ?: service.lastTreeJson
                if (tree != null) {
                    val nodes = tree.optJSONArray("nodes")
                    if (nodes != null) {
                        for (i in 0 until nodes.length()) {
                            val n = nodes.getJSONObject(i)
                            val text = n.optString("t", "").ifBlank { n.optString("h", "") }
                            if (text != digit && !text.contains(digit)) continue
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
                Thread.sleep(80)
            }
            Thread.sleep(120)
        }
        service.scheduleRefreshesAfterInput(forceFull = true)
    }
}
