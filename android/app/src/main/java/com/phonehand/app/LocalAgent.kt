package com.phonehand.app

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

object LocalAgent {
    private const val TAG = "LocalAgent"
    private const val MAX_ROUNDS = 8
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
                ensureReady(context, cb)
                var taskPrompt = prompt
                val history = JSONArray()

                for (round in 0 until MAX_ROUNDS) {
                    val freshTree = TouchAccessibilityService.instance?.snapshotTree(forceFull = round > 0)
                        ?: TouchAccessibilityService.instance?.lastTreeJson
                    val freshScreen = if (freshTree != null) ScreenSummarizer.compact(freshTree) else screen
                    val locked = LockScreenHelper.isDeviceLocked(context)
                    val device = DeviceGuide.deviceJson(context, locked)

                    val parsed = AgentClient.run(context, taskPrompt, freshScreen, history, device)
                    val thought = parsed.optString("thought", "")
                    if (thought.isNotBlank()) cb.onLog("💭 ${thought.take(200)}")
                    cb.onLog(parsed.optString("say", "Working…"))

                    val actions = parsed.optJSONArray("actions") ?: JSONArray()
                    val targetMap = if (freshTree != null) ScreenSummarizer.buildTargetMap(freshTree) else emptyMap()
                    for (i in 0 until minOf(actions.length(), MAX_ACTIONS)) {
                        val a = actions.getJSONObject(i)
                        executeAction(context, a, cb, targetMap)
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

    private fun executeAction(
        context: android.content.Context,
        a: JSONObject,
        cb: Callback,
        targetMap: Map<Int, Pair<Float, Float>> = emptyMap(),
    ) {
        val svc = TouchAccessibilityService.instance
        when (a.optString("type")) {
            "tap" -> {
                val target = a.optInt("target", 0)
                val fromTarget = if (target > 0) targetMap[target] else null
                val x = fromTarget?.first ?: a.optDouble("x").toFloat()
                val y = fromTarget?.second ?: a.optDouble("y").toFloat()
                cb.onLog("tap (${x.toInt()}, ${y.toInt()})${if (target > 0) " #$target" else ""}")
                svc?.tapAt(x, y) ?: InputHandler.handle(context, """{"type":"tap","x":$x,"y":$y}""")
            }
            "text" -> {
                val t = a.optString("text", "")
                cb.onLog("type \"$t\"")
                if (svc != null && t.isNotBlank()) {
                    val node = svc.rootInActiveWindow
                    val focused = node?.findFocus(android.view.accessibility.AccessibilityNodeInfo.FOCUS_INPUT)
                    focused?.let {
                        val args = android.os.Bundle()
                        args.putCharSequence(
                            android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                            t,
                        )
                        it.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                        it.recycle()
                    }
                    node?.recycle()
                }
            }
            "key" -> {
                val k = a.optString("action", "back")
                cb.onLog("key $k")
                when (k) {
                    "wake", "unlock" -> InputHandler.handle(context, """{"type":"key","action":"$k"}""")
                    "back" -> svc?.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
                    "home" -> svc?.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
                    "recents" -> svc?.globalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_RECENTS)
                }
            }
            "swipe" -> {
                cb.onLog("swipe")
                svc?.swipe(
                    a.getDouble("x").toFloat(),
                    a.getDouble("y").toFloat(),
                    a.getDouble("x2").toFloat(),
                    a.getDouble("y2").toFloat(),
                    a.optLong("duration", 300),
                )
            }
            "wait" -> Thread.sleep(a.optLong("ms", 100).coerceAtMost(MAX_WAIT_MS))
        }
        svc?.scheduleRefreshesAfterInput()
    }

    private fun ensureReady(context: android.content.Context, cb: Callback) {
        if (!ScreenPower.isInteractive(context)) {
            cb.onLog("Waking phone…")
            InputHandler.handle(context, """{"type":"key","action":"wake"}""")
            Thread.sleep(350)
        }
        if (LockScreenHelper.isDeviceLocked(context)) {
            cb.onLog("Unlocking…")
            InputHandler.handle(context, """{"type":"key","action":"unlock"}""")
            Thread.sleep(800)
            TouchAccessibilityService.instance?.snapshotTree(forceFull = true)
        }
    }
}
