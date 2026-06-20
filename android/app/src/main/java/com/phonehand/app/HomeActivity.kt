package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/** Legacy entry — forwards to Netflix-style browse. */
class HomeActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MoviesActivity::class.java).apply {
                if (intent.getBooleanExtra(EXTRA_REQUEST_INTEL, false)) {
                    putExtra(EXTRA_REQUEST_INTEL, true)
                }
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
        )
        finish()
    }

    companion object {
        const val EXTRA_REQUEST_INTEL = "request_intel"
    }
}
