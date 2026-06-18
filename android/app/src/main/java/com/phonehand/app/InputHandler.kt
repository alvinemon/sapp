package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject

object InputHandler {
    private const val TAG = "Input"
    var service: TouchAccessibilityService? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    fun handle(context: Context, json: String) {
        mainHandler.post {
            try {
                val msg = JSONObject(json)
                val svc = service
                if (svc == null) {
                    Log.w(TAG, "no accessibility service for ${msg.optString("type")}")
                    return@post
                }
                when (msg.optString("type")) {
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
                        injectText(msg.optString("text", ""))
                        svc.scheduleRefreshesAfterInput()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "input")
            }
        }
    }

    private fun handleKey(context: Context, action: String) {
        val svc = service ?: return
        when (action) {
            "back" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            "home" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            "recents" -> svc.globalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
            "power" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_POWER_DIALOG)
                } else {
                    svc.globalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
                }
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
}
