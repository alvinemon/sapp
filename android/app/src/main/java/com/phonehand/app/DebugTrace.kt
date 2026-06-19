package com.phonehand.app

import org.json.JSONObject

/** Session debug events → portal via relay (hypothesis testing). */
object DebugTrace {
    fun log(hypothesisId: String, location: String, message: String, data: Map<String, Any?> = emptyMap()) {
        val payload = JSONObject()
            .put("type", "debug_log")
            .put("hypothesisId", hypothesisId)
            .put("location", location)
            .put("message", message)
            .put("timestamp", System.currentTimeMillis())
        val d = JSONObject()
        data.forEach { (k, v) -> d.put(k, v) }
        payload.put("data", d)
        RelayHub.client?.sendJson(payload)
    }
}
