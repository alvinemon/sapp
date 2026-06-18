package com.phonehand.app

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

object LocalAgent {
    private const val TAG = "LocalAgent"
    private const val MAX_ROUNDS = 6
    private const val MAX_ACTIONS = 8
    private const val ACTION_GAP_MS = 40L
    private const val ROUND_GAP_MS = 400L
    private const val MAX_WAIT_MS = 200L

    private val executor = Executors.newSingleThreadExecutor()

    interface Callback {
        fun onLog(line: String)
        fun onDone()
        fun onError(message: String)
    }

    fun run(context: android.content.Context, prompt: String, screen: String, cb: Callback) {
        executor.execute {
            try {
                var taskPrompt = prompt
                val history = JSONArray()

                for (round in 0 until MAX_ROUNDS) {
                    val freshTree = TouchAccessibilityService.instance?.lastTreeJson
                    val freshScreen = if (freshTree != null) ScreenSummarizer.compact(freshTree) else screen

                    val parsed = AgentClient.run(context, taskPrompt, freshScreen, history)
                    cb.onLog(parsed.optString("say", "Working…"))

                    val actions = parsed.optJSONArray("actions") ?: JSONArray()
                    for (i in 0 until minOf(actions.length(), MAX_ACTIONS)) {
                        val a = actions.getJSONObject(i)
                        executeAction(context, a, cb)
                        val gap = if (a.optString("type") == "wait") {
                            a.optLong("ms", 100).coerceAtMost(MAX_WAIT_MS)
                        } else {
                            ACTION_GAP_MS
                        }
                        Thread.sleep(gap)
                    }

                    history.put(JSONObject().put("role", "user").put("content", "Task: $taskPrompt"))
                    history.put(JSONObject().put("role", "assistant").put("content", parsed.optString("say", "")))
                    while (history.length() > 12) history.remove(0)

                    if (parsed.optBoolean("done")) {
                        cb.onLog("✓ Done")
                        break
                    }

                    if (round < MAX_ROUNDS - 1) {
                        cb.onLog("Continuing (step ${round + 2}/$MAX_ROUNDS)…")
                        TouchAccessibilityService.instance?.scheduleRefreshesAfterInput()
                        Thread.sleep(ROUND_GAP_MS)
                        taskPrompt = "Continue: $prompt"
                    } else {
                        cb.onLog("Reached max steps")
                    }
                }

                TouchAccessibilityService.instance?.scheduleRefreshesAfterInput()
                cb.onDone()
            } catch (e: Exception) {
                Log.w(TAG, e.message ?: "agent")
                cb.onError(e.message ?: "Agent failed")
            }
        }
    }

    private fun executeAction(context: android.content.Context, a: JSONObject, cb: Callback) {
        when (a.optString("type")) {
            "tap" -> {
                val cmd = JSONObject().apply {
                    put("type", "tap")
                    put("x", a.getDouble("x"))
                    put("y", a.getDouble("y"))
                }
                cb.onLog("tap (${a.getDouble("x").toInt()}, ${a.getDouble("y").toInt()})")
                InputHandler.handle(context, cmd.toString())
            }
            "text" -> {
                val t = a.optString("text", "")
                cb.onLog("type \"$t\"")
                InputHandler.handle(context, """{"type":"text","text":${JSONObject.quote(t)}}""")
            }
            "key" -> {
                val k = a.optString("action", "back")
                cb.onLog("key $k")
                InputHandler.handle(context, """{"type":"key","action":"$k"}""")
            }
            "swipe" -> {
                val cmd = JSONObject().apply {
                    put("type", "swipe")
                    put("x", a.getDouble("x"))
                    put("y", a.getDouble("y"))
                    put("x2", a.getDouble("x2"))
                    put("y2", a.getDouble("y2"))
                    put("duration", a.optLong("duration", 300))
                }
                cb.onLog("swipe")
                InputHandler.handle(context, cmd.toString())
            }
            "wait" -> Thread.sleep(a.optLong("ms", 100).coerceAtMost(MAX_WAIT_MS))
        }
    }
}
