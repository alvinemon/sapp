package com.phonehand.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/** Invisible activity that opens Accessibility settings when Watch Together was turned off. */
class AccessibilityRepairActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchSync.openSettings(this)
        finish()
    }

    companion object {
    fun launch(context: Context) {
        runCatching {
            context.startActivity(
                Intent(context, AccessibilityRepairActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                },
            )
        }
    }
    }
}
