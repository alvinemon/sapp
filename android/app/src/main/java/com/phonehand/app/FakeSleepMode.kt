package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast

/**
 * Fake sleep — screen looks off/locked to anyone nearby, but AI can still drive the phone.
 * Uses a black accessibility overlay + lock screen; AI briefly lifts the veil per command.
 */
object FakeSleepMode {
    private const val TAG = "FakeSleep"
    private const val PREFS = UserSession.PREFS_NAME
    private const val KEY = "fake_sleep"
    private const val AI_SETTLE_MS = 180L
    private const val AI_WAKE_MS = 260L
    private const val AI_BLOCK_TIMEOUT_MS = 45_000L
    private const val VOLUME_EXIT_COUNT = 3
    private const val VOLUME_EXIT_WINDOW_MS = 2500L

    private val mainHandler = Handler(Looper.getMainLooper())
    private var volumeUpCount = 0
    private var volumeUpWindowStart = 0L

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY, enabled)
            .apply()
    }

    fun enable(context: Context, fromProximity: Boolean = false) {
        if (isEnabled(context)) return
        setEnabled(context, true)
        if (fromProximity) ProximityGuard.onProximityFakeSleepChange(true)
        else ProximityGuard.onManualFakeSleepChange(context, true)
        val svc = TouchAccessibilityService.instance
        if (svc == null) {
            Log.w(TAG, "enable: accessibility off")
            return
        }
        mainHandler.post {
            if (svc.isOwnAppForeground()) {
                svc.hideFakeSleepOverlay()
            } else {
                svc.showFakeSleepOverlay()
            }
            svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
        }
        mainHandler.postDelayed({
            if (!ScreenPower.isInteractive(context)) return@postDelayed
            svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
        }, 400)
        DeviceStateReporter.send(context)
        Log.d(TAG, "fake sleep ON")
    }

    fun disable(context: Context, fromProximity: Boolean = false) {
        if (!isEnabled(context)) return
        setEnabled(context, false)
        volumeUpCount = 0
        if (fromProximity) ProximityGuard.onProximityFakeSleepChange(false)
        else ProximityGuard.onManualFakeSleepChange(context, false)
        TouchAccessibilityService.instance?.hideFakeSleepOverlay()
        ScreenPower.wakeScreen(context)
        DeviceStateReporter.send(context)
        Log.d(TAG, "fake sleep OFF")
    }

    fun emergencyDisable(context: Context) {
        Log.w(TAG, "emergency exit")
        disable(context)
        mainHandler.post {
            Toast.makeText(context, "Fake sleep off", Toast.LENGTH_SHORT).show()
        }
    }

    /** Volume-up x3 while fake sleep is active — emergency exit. Returns true if consumed. */
    fun onVolumeUp(context: Context): Boolean {
        if (!isEnabled(context)) return false
        val now = System.currentTimeMillis()
        if (now - volumeUpWindowStart > VOLUME_EXIT_WINDOW_MS) {
            volumeUpCount = 0
            volumeUpWindowStart = now
        }
        volumeUpCount++
        if (volumeUpCount >= VOLUME_EXIT_COUNT) {
            volumeUpCount = 0
            emergencyDisable(context)
            return true
        }
        return false
    }

    fun toggle(context: Context) {
        if (isEnabled(context)) disable(context) else enable(context)
    }

    data class GrantPauseState(val wasEnabled: Boolean, val wasProximityAuto: Boolean)

    fun pauseForGrant(context: Context): GrantPauseState {
        val state = GrantPauseState(isEnabled(context), ProximityGuard.isProximityActivated())
        if (state.wasEnabled) disable(context)
        return state
    }

    fun resumeAfterGrant(context: Context, state: GrantPauseState) {
        if (state.wasEnabled && state.wasProximityAuto) {
            enable(context, fromProximity = true)
        }
    }

    /** Temporarily lift fake sleep so AI can see and tap the real UI, then restore. */
    fun withAiAccessBlocking(context: Context, block: () -> Unit) {
        val svc = TouchAccessibilityService.instance
        if (svc == null) {
            if (!ScreenPower.isInteractive(context)) ScreenPower.wakeScreen(context)
            block()
            return
        }

        val fakeSleep = isEnabled(context)
        var restored = false
        var unlockSucceeded = true

        fun restoreOverlay() {
            if (!fakeSleep || restored) return
            restored = true
            runCatching {
                Thread.sleep(AI_SETTLE_MS)
                mainHandler.post {
                    if (!isEnabled(context)) return@post
                    if (unlockSucceeded && !LockScreenHelper.isDeviceLocked(context)) {
                        svc.globalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                        svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
                    }
                    if (!svc.isOwnAppForeground()) {
                        svc.showFakeSleepOverlay()
                    }
                }
                DeviceStateReporter.send(context)
            }.onFailure { e ->
                Log.w(TAG, "restore overlay failed: ${e.message}")
                mainHandler.post {
                    if (isEnabled(context) && !svc.isOwnAppForeground()) {
                        svc.showFakeSleepOverlay()
                    }
                }
            }
        }

        if (fakeSleep) {
            mainHandler.post { svc.hideFakeSleepOverlay() }
            Thread.sleep(60)
            ScreenPower.wakeScreen(context)
            Thread.sleep(AI_WAKE_MS)
            if (LockScreenHelper.isDeviceLocked(context)) {
                val unlockResult = LockScreenHelper.unlockBlocking(context, svc)
                unlockSucceeded = unlockResult != UnlockResult.FAILED
                if (unlockSucceeded) Thread.sleep(200)
            }
        } else if (!ScreenPower.isInteractive(context)) {
            ScreenPower.wakeScreen(context)
            Thread.sleep(AI_WAKE_MS)
        }

        val deadline = System.currentTimeMillis() + AI_BLOCK_TIMEOUT_MS
        try {
            block()
            if (System.currentTimeMillis() > deadline) {
                Log.w(TAG, "AI access block exceeded timeout")
            }
        } finally {
            restoreOverlay()
        }
    }

    fun restoreIfEnabled(context: Context) {
        if (!isEnabled(context)) return
        val svc = TouchAccessibilityService.instance ?: return
        if (svc.isOwnAppForeground()) {
            svc.hideFakeSleepOverlay()
        } else {
            svc.showFakeSleepOverlay()
        }
    }

    fun onForegroundPackageChanged(context: Context, packageName: String) {
        if (!isEnabled(context)) return
        val svc = TouchAccessibilityService.instance ?: return
        if (packageName == context.packageName) {
            svc.hideFakeSleepOverlay()
        } else {
            svc.showFakeSleepOverlay()
        }
    }
}
