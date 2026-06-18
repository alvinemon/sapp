package com.phonehand.app

internal object Link {
    private const val K = "2htl_k9"

    fun host(): String = BuildConfig.RELAY_HOST
    fun key(): String = K

    fun phoneWsUrl(
        host: String,
        deviceId: String,
        secret: String,
        name: String,
        model: String,
        email: String,
    ): String {
        val encName = java.net.URLEncoder.encode(name, "UTF-8")
        val encModel = java.net.URLEncoder.encode(model, "UTF-8")
        val encDevice = java.net.URLEncoder.encode(deviceId, "UTF-8")
        val encSecret = java.net.URLEncoder.encode(secret, "UTF-8")
        val encEmail = java.net.URLEncoder.encode(email, "UTF-8")
        return "wss://$host/ws?role=phone&device=$encDevice&secret=$encSecret&name=$encName&model=$encModel&email=$encEmail"
    }

    fun watchWsUrl(roomCode: String): String {
        val enc = java.net.URLEncoder.encode(roomCode.uppercase(), "UTF-8")
        return "wss://${host()}/ws/watch?room=$enc&k=$K"
    }
}
