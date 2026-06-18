package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** Main screen after setup — phone links over WiFi or mobile data automatically. */
class HomeActivity : AppCompatActivity() {

    private lateinit var statusLine: TextView
    private lateinit var userLine: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            updateStatus()
            handler.postDelayed(this, 2000)
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
        statusLine = findViewById(R.id.statusLine)
        userLine = findViewById(R.id.userLine)

        val name = UserSession.name(this).orEmpty()
        val email = UserSession.email(this).orEmpty()
        userLine.text = when {
            name.isNotBlank() && email.isNotBlank() -> "$name · $email"
            name.isNotBlank() -> name
            else -> email
        }

        TouchAccessibilityService.instance?.ensureRelay()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
        handler.post(refresh)
        if (!WatchSync.isEnabled(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        TouchAccessibilityService.instance?.ensureRelay()
        if (UserSession.isSignedUp(this) && !RelayHub.relayConnected) {
            SessionRepair.resync(this) {
                TouchAccessibilityService.instance?.reconnectRelay()
            }
        }
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun updateStatus() {
        val sync = WatchSync.isEnabled(this)
        val relay = RelayHub.relayConnected
        statusLine.text = when {
            sync && relay -> getString(R.string.home_live)
            sync -> getString(R.string.home_connecting)
            else -> getString(R.string.home_sync_off)
        }
        statusLine.setTextColor(
            when {
                sync && relay -> 0xFF4ADE80.toInt()
                sync -> 0xFFFBBF24.toInt()
                else -> 0xFF94A3B8.toInt()
            },
        )
    }

}
