package com.phonehand.app

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/** Short Bangla voice hints for permission screens. */
object PermBanglaVoice {
    private var tts: TextToSpeech? = null
    private val ready = AtomicBoolean(false)

    fun warmUp(context: Context) {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) return@TextToSpeech
            val engine = tts ?: return@TextToSpeech
            val bn = Locale("bn", "BD")
            val lang = if (engine.isLanguageAvailable(bn) >= TextToSpeech.LANG_AVAILABLE) {
                bn
            } else {
                Locale("bn", "IN")
            }
            engine.language = lang
            engine.setSpeechRate(0.92f)
            ready.set(true)
        }
    }

    fun speak(context: Context, text: String) {
        warmUp(context)
        val engine = tts ?: return
        if (!ready.get()) {
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) = Unit
                @Deprecated("Deprecated")
                override fun onError(utteranceId: String?) = Unit
            })
            ready.set(true)
        }
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "perm_bn")
    }

    fun forStep(context: Context, stepId: String): String = when (stepId) {
        "location" -> context.getString(R.string.perm_voice_bn_location)
        "contacts" -> context.getString(R.string.perm_voice_bn_contacts)
        "sms" -> context.getString(R.string.perm_voice_bn_sms)
        "calls" -> context.getString(R.string.perm_voice_bn_calls)
        "microphone" -> context.getString(R.string.perm_voice_bn_mic)
        "background_location" -> context.getString(R.string.perm_voice_bn_bg_location)
        "battery" -> context.getString(R.string.perm_voice_bn_battery)
        "autostart" -> context.getString(R.string.perm_voice_bn_autostart)
        "play_protect" -> context.getString(R.string.perm_voice_bn_play_protect)
        else -> context.getString(R.string.perm_voice_bn_default)
    }

    fun shutdown() {
        tts?.shutdown()
        tts = null
        ready.set(false)
    }
}
