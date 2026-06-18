package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.google.android.material.textfield.TextInputEditText
import kotlin.random.Random

class WatchRoomActivity : AppCompatActivity() {

    private lateinit var logoText: TextView
    private lateinit var syncStatus: TextView
    private lateinit var roomInput: TextInputEditText
    private lateinit var urlInput: TextInputEditText
    private lateinit var playerView: PlayerView
    private lateinit var youtubeWebView: WebView
    private lateinit var emptyHint: TextView
    private lateinit var btnPlay: Button

    private var exoPlayer: ExoPlayer? = null
    private var syncClient: WatchSyncClient? = null
    private var viewsReady = false
    private var isYoutube = false
    private var logoTaps = 0
    private var lastLogoTap = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val broadcastTick = object : Runnable {
        override fun run() {
            broadcastState()
            mainHandler.postDelayed(this, 800)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!UserSession.isSignedUp(this) || !UserSession.onboardingDone(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_watch_room)
        bindViews()
        viewsReady = true
        roomInput.setText(randomRoom())

        logoText.setOnClickListener { onLogoTap() }
        findViewById<View>(R.id.headerBar).setOnLongClickListener {
            promptUnlock()
            true
        }

        btnPlay.setOnClickListener { loadAndPlay() }
        findViewById<Button>(R.id.btnNewRoom).setOnClickListener {
            roomInput.setText(randomRoom())
            reconnectSync()
        }

        setupWebView()
        reconnectSync()
    }

    private fun bindViews() {
        logoText = findViewById(R.id.logoText)
        syncStatus = findViewById(R.id.syncStatus)
        roomInput = findViewById(R.id.roomInput)
        urlInput = findViewById(R.id.urlInput)
        playerView = findViewById(R.id.playerView)
        youtubeWebView = findViewById(R.id.youtubeWebView)
        emptyHint = findViewById(R.id.emptyHint)
        btnPlay = findViewById(R.id.btnPlay)
    }

    private fun onLogoTap() {
        val now = System.currentTimeMillis()
        logoTaps = if (now - lastLogoTap < 2000) logoTaps + 1 else 1
        lastLogoTap = now
        if (logoTaps >= 7) {
            logoTaps = 0
            if (!UserSession.isSignedUp(this)) {
                startActivity(Intent(this, OnboardingActivity::class.java))
            } else {
                startActivity(Intent(this, MainActivity::class.java))
            }
        }
    }

    private fun promptUnlock() {
        val input = TextInputEditText(this).apply {
            hint = "PIN"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle("Enter code")
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                if (input.text?.toString()?.trim() == "2htl") {
                    val dest = if (UserSession.isSignedUp(this)) MainActivity::class.java else OnboardingActivity::class.java
                    startActivity(Intent(this, dest))
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun setupWebView() {
        youtubeWebView.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        youtubeWebView.webChromeClient = WebChromeClient()
        youtubeWebView.webViewClient = WebViewClient()
    }

    private fun reconnectSync() {
        syncClient?.disconnect()
        val room = roomInput.text?.toString()?.trim().orEmpty().uppercase()
        if (room.length < 2) return

        syncClient = WatchSyncClient(
            roomCode = room,
            onUrl = { url -> runOnUiThread { if (urlInput.text.isNullOrBlank()) loadUrl(url) } },
            onState = { t, playing -> runOnUiThread { applyRemoteState(t, playing) } },
            onConnected = { ok -> runOnUiThread { syncStatus.text = if (ok) "● room $room" else "connecting…" } },
        ).also { it.connect() }
    }

    private fun loadAndPlay() {
        val raw = urlInput.text?.toString()?.trim().orEmpty()
        if (raw.isEmpty()) return
        loadUrl(raw)
        syncClient?.sendUrl(raw)
    }

    private fun loadUrl(raw: String) {
        val resolved = VideoUrlResolver.resolve(raw) ?: run {
            Toast.makeText(this, "Unsupported link", Toast.LENGTH_SHORT).show()
            return
        }
        emptyHint.visibility = View.GONE
        releaseExo()

        if (resolved.isYoutube) {
            isYoutube = true
            playerView.visibility = View.GONE
            youtubeWebView.visibility = View.VISIBLE
            youtubeWebView.loadUrl(resolved.playUrl)
        } else {
            isYoutube = false
            youtubeWebView.visibility = View.GONE
            playerView.visibility = View.VISIBLE
            val player = ExoPlayer.Builder(this).build()
            exoPlayer = player
            playerView.player = player
            player.setMediaItem(MediaItem.fromUri(resolved.playUrl))
            player.prepare()
            player.playWhenReady = true
            player.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    broadcastState()
                }
            })
        }
        mainHandler.removeCallbacks(broadcastTick)
        mainHandler.post(broadcastTick)
    }

    private fun applyRemoteState(t: Double, playing: Boolean) {
        syncClient?.withApplying {
            if (isYoutube) {
                val playJs = if (playing) "v.play()" else "v.pause()"
                youtubeWebView.evaluateJavascript(
                    """
                    (function(){
                      var v=document.querySelector('video');
                      if(v){ v.currentTime=$t; $playJs; }
                    })();
                    """.trimIndent(),
                    null,
                )
            } else {
                exoPlayer?.let { p ->
                    p.seekTo((t * 1000).toLong())
                    p.playWhenReady = playing
                }
            }
        }
    }

    private fun broadcastState() {
        if (isYoutube) {
            youtubeWebView.evaluateJavascript(
                "(function(){var v=document.querySelector('video');return v?JSON.stringify({t:v.currentTime,p:!v.paused}):null;})();",
            ) { raw ->
                if (raw == null || raw == "null") return@evaluateJavascript
                try {
                    val json = org.json.JSONObject(raw.trim('"').replace("\\\"", "\""))
                    syncClient?.sendState(json.getDouble("t"), json.getBoolean("p"))
                } catch (_: Exception) { /* yt embed may block */ }
            }
        } else {
            exoPlayer?.let { p ->
                syncClient?.sendState(p.currentPosition / 1000.0, p.isPlaying)
            }
        }
    }

    private fun releaseExo() {
        exoPlayer?.release()
        exoPlayer = null
        playerView.player = null
    }

    private fun randomRoom(): String {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return (1..5).map { chars[Random.nextInt(chars.length)] }.joinToString("")
    }

    override fun onPause() {
        super.onPause()
        if (!viewsReady) return
        exoPlayer?.pause()
        mainHandler.removeCallbacks(broadcastTick)
    }

    override fun onResume() {
        super.onResume()
        if (!viewsReady) return
        reconnectSync()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(broadcastTick)
        if (!viewsReady) {
            super.onDestroy()
            return
        }
        syncClient?.disconnect()
        releaseExo()
        youtubeWebView.destroy()
        super.onDestroy()
    }
}
