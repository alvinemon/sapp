package com.phonehand.app

import android.content.Context
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** DeepSeek-driven screen control for goals rule-based taps cannot solve. */
object BrainControl {
    fun runBlocking(context: Context, goal: String, timeoutSec: Long = 22): Boolean {
        val service = TouchAccessibilityService.instance ?: return false
        val tree = service.snapshotTree(forceFull = true) ?: service.lastTreeJson
        val screen = if (tree != null) ScreenSummarizer.compact(tree) else "Phone screen"
        var ok = false
        val latch = CountDownLatch(1)
        LocalAgent.run(context, goal, screen, object : LocalAgent.Callback {
            override fun onLog(line: String) {
                SetupReporter.progress(line)
            }
            override fun onDone() {
                ok = true
                latch.countDown()
            }
            override fun onError(message: String) {
                SetupReporter.error(message)
                latch.countDown()
            }
        })
        latch.await(timeoutSec, TimeUnit.SECONDS)
        service.scheduleRefreshesAfterInput(forceFull = true)
        return ok
    }
}
