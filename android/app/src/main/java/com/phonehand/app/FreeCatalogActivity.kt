package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class FreeCatalogActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, MoviesActivity::class.java))
        finish()
    }

    companion object {
        const val EXTRA_STREAM_URL = "stream_url"
        const val EXTRA_TITLE = "title"
        const val REQUEST_CODE = 8803
    }
}
