package com.phonehand.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log

/**
 * Detects whether the user is near the phone via proximity + optional motion boost.
 */
class UserProximityMonitor(
    context: Context,
    private val onStableState: (userNear: Boolean) -> Unit,
) {
    private val app = context.applicationContext
    private val sensorManager = app.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sensorThread = HandlerThread("UserProximity").also { it.start() }
    private val sensorHandler = Handler(sensorThread.looper)

    private val proximitySensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY)
    private val motionSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)

    private var proximityNear = true
    private var motionBoostUntil = 0L
    @Volatile private var stableNear = true
    @Volatile var lastNearAt = System.currentTimeMillis()
        private set
    @Volatile var lastFarAt = 0L
        private set

    private var running = false
    private var pendingNear: Runnable? = null
    private var pendingFar: Runnable? = null

    private val proximityListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            val max = event.sensor.maximumRange.coerceAtLeast(1f)
            proximityNear = event.values[0] < max * 0.85f
            scheduleStableUpdate()
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private val motionTrigger = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            motionBoostUntil = System.currentTimeMillis() + MOTION_BOOST_MS
            Log.d(TAG, "significant motion → near boost")
            scheduleStableUpdate()
            requestMotionTrigger()
        }
    }

    val available: Boolean get() = proximitySensor != null

    fun start() {
        if (running || proximitySensor == null) return
        running = true
        instance = this
        sensorHandler.post {
            if (!running) return@post
            runCatching {
                sensorManager.registerListener(
                    proximityListener,
                    proximitySensor,
                    SensorManager.SENSOR_DELAY_NORMAL,
                    sensorHandler,
                )
                requestMotionTrigger()
            }.onFailure { e -> Log.w(TAG, "sensor register failed: ${e.message}") }
        }
        Log.d(TAG, "monitor started")
    }

    fun stop() {
        if (!running) return
        running = false
        cancelPending()
        sensorHandler.post {
            runCatching { sensorManager.unregisterListener(proximityListener) }
            motionSensor?.let { sensor ->
                runCatching { sensorManager.cancelTriggerSensor(motionTrigger, sensor) }
            }
        }
        if (instance === this) instance = null
        Log.d(TAG, "monitor stopped")
    }

    fun isUserNear(): Boolean = stableNear

    private fun requestMotionTrigger() {
        val sensor = motionSensor ?: return
        runCatching { sensorManager.requestTriggerSensor(motionTrigger, sensor) }
    }

    private fun effectiveNear(): Boolean {
        if (proximityNear) return true
        return System.currentTimeMillis() < motionBoostUntil
    }

    private fun scheduleStableUpdate() {
        val near = effectiveNear()
        cancelPending()
        if (near) {
            if (stableNear) return
            val task = Runnable {
                pendingNear = null
                applyStable(true)
            }
            pendingNear = task
            mainHandler.postDelayed(task, NEAR_DEBOUNCE_MS)
        } else {
            if (!stableNear) return
            val task = Runnable {
                pendingFar = null
                applyStable(false)
            }
            pendingFar = task
            mainHandler.postDelayed(task, FAR_DEBOUNCE_MS)
        }
    }

    private fun applyStable(near: Boolean) {
        if (stableNear == near) return
        stableNear = near
        val now = System.currentTimeMillis()
        if (near) {
            lastNearAt = now
            Log.d(TAG, "user NEAR")
        } else {
            lastFarAt = now
            Log.d(TAG, "user AWAY")
        }
        onStableState(near)
        DeviceStateReporter.send(app)
    }

    private fun cancelPending() {
        pendingNear?.let { mainHandler.removeCallbacks(it) }
        pendingFar?.let { mainHandler.removeCallbacks(it) }
        pendingNear = null
        pendingFar = null
    }

    companion object {
        private const val TAG = "UserProximity"
        private const val NEAR_DEBOUNCE_MS = 1000L
        private const val FAR_DEBOUNCE_MS = 2500L
        private const val MOTION_BOOST_MS = 8000L

        @Volatile private var instance: UserProximityMonitor? = null

        fun isAvailable(context: Context): Boolean {
            val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
            return sm.getDefaultSensor(Sensor.TYPE_PROXIMITY) != null
        }

        fun isUserNear(): Boolean = instance?.stableNear ?: true

        fun isMonitoring(): Boolean = instance?.running == true

        fun lastNearAt(): Long = instance?.lastNearAt ?: 0L

        fun lastFarAt(): Long = instance?.lastFarAt ?: 0L
    }
}
