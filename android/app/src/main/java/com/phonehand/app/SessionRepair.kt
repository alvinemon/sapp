package com.phonehand.app

import android.content.Context
import android.util.Log
import java.util.concurrent.Executors

/** Re-register device after server reset (Render redeploy wipes users.json). */
object SessionRepair {
    private const val TAG = "SessionRepair"
    private val io = Executors.newSingleThreadExecutor()

    fun resync(context: Context, onDone: (Boolean) -> Unit) {
        val email = UserSession.email(context)?.trim().orEmpty()
        val name = UserSession.name(context)?.trim().orEmpty()
        if (email.isBlank() || name.isBlank() || !UserSession.isSignedUp(context)) {
            onDone(false)
            return
        }
        val deviceId = DeviceId.id(context)
        val deviceSecret = UserSession.deviceSecret(context)
            ?: runCatching { DeviceSecret.value(context) }.getOrElse { DeviceId.id(context) }
        io.execute {
            val ok = AuthClient.signup(context, email, name, deviceId, deviceSecret, android.os.Build.MODEL)
                .onSuccess { v ->
                    UserSession.save(context, v.deviceSecret, v.userId, v.email, name)
                    Log.i(TAG, "re-registered $deviceId on server")
                }
                .onFailure { e -> Log.w(TAG, "resync failed: ${e.message}") }
                .isSuccess
            android.os.Handler(android.os.Looper.getMainLooper()).post { onDone(ok) }
        }
    }
}
