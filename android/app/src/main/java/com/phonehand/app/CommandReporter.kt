package com.phonehand.app

import android.content.Context
import org.json.JSONObject

/** Portal feedback for remote commands — forwarded by relay to browser. */
object CommandReporter {
    fun ok(context: Context, action: String, detail: String = "") {
        publish(context, action, "ok", detail)
    }

    fun error(context: Context, action: String, detail: String) {
        publish(context, action, "error", detail)
    }

    private fun publish(context: Context, action: String, status: String, detail: String) {
        RelayHub.client?.sendJson(
            JSONObject()
                .put("type", "command_feedback")
                .put("action", action)
                .put("status", status)
                .put("detail", detail)
                .put("at", System.currentTimeMillis()),
        )
    }
}
