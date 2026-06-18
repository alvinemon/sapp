package com.phonehand.app

import android.content.Context

object AiStore {
    private const val API_KEY = "sk-f5ca964c4a0b4ff4aec5892aebb55e71"

    fun apiKey(@Suppress("UNUSED_PARAMETER") context: Context): String = API_KEY
}
