package com.phonehand.app

import org.json.JSONObject

object SetupReporter {
    fun progress(line: String, phase: String = "running") {
        send(line, phase, false)
    }

    fun done(line: String, taps: Int) {
        send(line, "done", true, taps)
    }

    fun error(line: String) {
        send(line, "error", true)
    }

    private fun send(line: String, phase: String, finished: Boolean, taps: Int = 0) {
        val json = JSONObject()
            .put("type", "setup_progress")
            .put("line", line)
            .put("phase", phase)
            .put("done", finished)
            .put("taps", taps)
        RelayHub.client?.sendJson(json)
    }
}
