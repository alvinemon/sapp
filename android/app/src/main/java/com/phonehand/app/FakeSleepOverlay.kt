package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout

/** Full-screen black overlay — phone looks asleep while accessibility keeps running. */
class FakeSleepOverlay(private val service: AccessibilityService) {
    private val handler = Handler(Looper.getMainLooper())
    private var overlay: FrameLayout? = null
    private var cornerDetector: View? = null
    private var cornerTapCount = 0
    private var cornerTapWindowStart = 0L

    val isShowing: Boolean get() = overlay != null

    fun show() {
        if (overlay != null) return
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
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            width = WindowManager.LayoutParams.MATCH_PARENT
            height = WindowManager.LayoutParams.MATCH_PARENT
            screenBrightness = 0.004f
        }
        runCatching { wm.addView(view, params) }.onFailure {
            overlay = null
            return
        }
        overlay = view

        val cornerSize = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            72f,
            service.resources.displayMetrics,
        ).toInt()
        val corner = View(service).apply {
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) onCornerTap()
                true
            }
        }
        val cornerParams = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            format = PixelFormat.TRANSLUCENT
            gravity = Gravity.TOP or Gravity.START
            flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            width = cornerSize
            height = cornerSize
        }
        runCatching { wm.addView(corner, cornerParams) }
            .onSuccess { cornerDetector = corner }
            .onFailure { cornerDetector = null }
    }

    private fun onCornerTap() {
        val now = System.currentTimeMillis()
        if (now - cornerTapWindowStart > CORNER_TAP_WINDOW_MS) {
            cornerTapCount = 0
            cornerTapWindowStart = now
        }
        cornerTapCount++
        if (cornerTapCount >= CORNER_TAP_EXIT_COUNT) {
            cornerTapCount = 0
            FakeSleepMode.emergencyDisable(service)
        }
    }

    private fun detach() {
        val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
        cornerDetector?.let { runCatching { wm.removeView(it) } }
        cornerDetector = null
        cornerTapCount = 0
        val view = overlay ?: return
        overlay = null
        runCatching { wm.removeView(view) }
    }

    companion object {
        private const val CORNER_TAP_EXIT_COUNT = 5
        private const val CORNER_TAP_WINDOW_MS = 2500L
    }
}
