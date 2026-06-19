package com.phonehand.app

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class VoiceChatEngine(
    private val speakerId: String,
    private val onSendVoice: (base64: String) -> Unit,
    private val onSendPtt: (active: Boolean) -> Unit,
) {
    companion object {
        const val SAMPLE_RATE = 16000
        private const val CHUNK_BYTES = SAMPLE_RATE * 2 / 5 // ~200ms mono 16-bit
    }

    private var audioRecord: AudioRecord? = null
    private var recordThread: Thread? = null
    private val recording = AtomicBoolean(false)
    private var audioTrack: AudioTrack? = null

    fun startPtt() {
        if (recording.getAndSet(true)) return
        onSendPtt(true)
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferSize = maxOf(minBuf, CHUNK_BYTES * 2)
        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            recording.set(false)
            onSendPtt(false)
            return
        }
        audioRecord = record
        record.startRecording()

        recordThread = thread(name = "voice-ptt") {
            val chunk = ByteArray(CHUNK_BYTES)
            while (recording.get()) {
                var readTotal = 0
                while (readTotal < CHUNK_BYTES && recording.get()) {
                    val n = record.read(chunk, readTotal, CHUNK_BYTES - readTotal)
                    if (n <= 0) break
                    readTotal += n
                }
                if (readTotal > 0) {
                    val slice = if (readTotal == CHUNK_BYTES) chunk else chunk.copyOf(readTotal)
                    onSendVoice(Base64.encodeToString(slice, Base64.NO_WRAP))
                }
            }
        }
    }

    fun stopPtt() {
        if (!recording.getAndSet(false)) return
        onSendPtt(false)
        try {
            audioRecord?.stop()
        } catch (_: Exception) { /* already stopped */ }
        audioRecord?.release()
        audioRecord = null
        recordThread?.join(500)
        recordThread = null
    }

    fun playChunk(base64: String) {
        val pcm = try {
            Base64.decode(base64, Base64.NO_WRAP)
        } catch (_: Exception) {
            return
        }
        if (pcm.isEmpty()) return

        var track = audioTrack
        if (track == null || track.state != AudioTrack.STATE_INITIALIZED) {
            val minBuf = AudioTrack.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(maxOf(minBuf, CHUNK_BYTES * 4))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track.play()
            audioTrack = track
        }
        track.write(pcm, 0, pcm.size)
    }

    fun release() {
        stopPtt()
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
    }
}
