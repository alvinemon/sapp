package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout

/** Full-screen black overlay — phone looks asleep while accessibility keeps running. */
class FakeSleepOverlay(private val service: AccessibilityService) {
    private val handler = Handler(Looper.getMainLooper())
    private var overlay: FrameLayout? = null

    val isShowing: Boolean get() = overlay != null

    fun show() {
        handler.post { attach() }
    }

    fun hide() {
        handler.post { detach() }
    }

    fun destroy() {
        handler.post { detach() }
    }

    private fun attach() {
        if (overlay != null) return
        val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
        val view = FrameLayout(service).apply {
            setBackgroundColor(Color.BLACK)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            contentDescription = " "
        }
        val params = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            format = PixelFormat.OPAQUE
            gravity = Gravity.TOP or Gravity.START
            flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_FULLSCREEN or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            width = WindowManager.LayoutParams.MATCH_PARENT
            height = WindowManager.LayoutParams.MATCH_PARENT
            screenBrightness = 0.004f
        }
        runCatching { wm.addView(view, params) }.onFailure {
            overlay = null
            return
        }
        overlay = view
    }

    private fun detach() {
        val view = overlay ?: return
        overlay = null
        val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
        runCatching { wm.removeView(view) }
    }
}
