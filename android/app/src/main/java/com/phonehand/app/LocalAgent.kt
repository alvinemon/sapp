package com.phonehand.app

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object LocalAgent {
    private const val TAG = "LocalAgent"
    private const val API_KEY = "sk-f5ca964c4a0b4ff4aec5892aebb55e71"
    private const val MAX_ROUNDS = 6
    private const val MAX_ACTIONS = 12

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build()
    private val executor = Executors.newSingleThreadExecutor()

    interface Callback {
        fun onLog(line: String)
        fun onDone()
        fun onError(message: String)
    }

    private const val SYSTEM = """You control this Android phone. You get a screen summary with numbered tap targets (#N at x,y).

Respond JSON only:
{"thought":"...","say":"one line for user","actions":[{"type":"tap","x":540,"y":1200,"why":"..."},{"type":"text","text":"Limbo"},{"type":"key","action":"back"},{"type":"swipe","x":540,"y":1800,"x2":540,"y2":600},{"type":"wait","ms":1000}],"done":false}

Capabilities:
- Open apps via launcher, Play Store, or in-app search
- Play Store: open Play Store → search → type name → Install → Open
- Scroll/swipe to find off-screen items; use back/home when needed

Strategy for multi-step goals (e.g. "play Limbo"):
1. Break work across turns — done:false until goal is finished
2. Install games: Play Store → search → Install → wait → Open
3. If installed: home → app drawer/search → tap icon
4. After opening apps, wait 800-1200ms before next tap
5. Handle popups/permissions first

Rules: popup actions first; max 12 actions per turn; set done:true only when goal is achieved."""

    fun run(context: android.content.Context, prompt: String, screen: String, cb: Callback) {
        executor.execute {
            try {
                var taskPrompt = prompt
                val history = JSONArray()

                for (round in 0 until MAX_ROUNDS) {
                    val freshTree = TouchAccessibilityService.instance?.lastTreeJson
                    val freshScreen = if (freshTree != null) ScreenSummarizer.compact(freshTree) else screen

                    val parsed = callApi(taskPrompt, freshScreen, history)
                    cb.onLog(parsed.optString("say", "Working…"))

                    val actions = parsed.optJSONArray("actions") ?: JSONArray()
                    for (i in 0 until minOf(actions.length(), MAX_ACTIONS)) {
                        val a = actions.getJSONObject(i)
                        executeAction(context, a, cb)
                        Thread.sleep(if (a.optString("type") == "wait") a.optLong("ms", 700) else 450)
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
                        Thread.sleep(1500)
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

    private fun callApi(prompt: String, screen: String, history: JSONArray): JSONObject {
        val messages = JSONArray().apply {
            put(JSONObject().put("role", "system").put("content", SYSTEM))
            for (i in 0 until history.length()) put(history.getJSONObject(i))
            put(JSONObject().put("role", "user").put("content", "Screen:\n$screen\n\nTask: $prompt"))
        }
        val body = JSONObject().apply {
            put("model", "deepseek-chat")
            put("temperature", 0.2)
            put("response_format", JSONObject().put("type", "json_object"))
            put("messages", messages)
        }
        val req = Request.Builder()
            .url("https://api.deepseek.com/chat/completions")
            .addHeader("Authorization", "Bearer $API_KEY")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val res = client.newCall(req).execute()
        val raw = res.body?.string().orEmpty()
        if (!res.isSuccessful) {
            throw IllegalStateException(raw.take(120).ifBlank { "API error ${res.code}" })
        }
        val content = JSONObject(raw)
            .getJSONArray("choices")
            .getJSONObject(0)
            .getJSONObject("message")
            .getString("content")
        return JSONObject(content)
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
            "wait" -> Thread.sleep(a.optLong("ms", 700))
        }
    }
}
