package com.phonehand.app

object VideoUrlResolver {
    data class Resolved(
        val isYoutube: Boolean,
        val playUrl: String,
        val videoId: String? = null,
    )

    private val YT_RE =
        Regex("""(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{6,})""")
    private val DRIVE_RE = Regex("""drive\.google\.com/file/d/([a-zA-Z0-9_-]+)""")

    fun resolve(input: String): Resolved? {
        val raw = input.trim()
        if (raw.isEmpty()) return null

        YT_RE.find(raw)?.groupValues?.getOrNull(1)?.let { id ->
            return Resolved(
                isYoutube = true,
                playUrl = "https://www.youtube.com/embed/$id?autoplay=1&playsinline=1",
                videoId = id,
            )
        }

        DRIVE_RE.find(raw)?.groupValues?.getOrNull(1)?.let { id ->
            return Resolved(
                isYoutube = false,
                playUrl = "https://drive.google.com/uc?export=download&id=$id",
            )
        }

        if (raw.startsWith("http://", true) || raw.startsWith("https://", true)) {
            return Resolved(isYoutube = false, playUrl = raw)
        }
        return null
    }
}
