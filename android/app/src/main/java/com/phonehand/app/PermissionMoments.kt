package com.phonehand.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper

/**
 * Required permissions — staggered at natural moments, never one scary wall of toggles.
 */
object PermissionMoments {
    const val MAX_HOME_BATCH = 2
    private const val HOME_DELAY_MS = 700L

    /** Next pending steps for a home visit (max 2). */
    fun nextHomeBatch(context: Context): List<PermissionStep> {
        val pending = PermissionSteps.requiredPending(context)
            .filter { !UserSession.isStepDeferred(context, it.id) }
        return pending.take(MAX_HOME_BATCH)
    }

    fun hasHomeBatch(context: Context): Boolean = nextHomeBatch(context).isNotEmpty()

    fun launchHomeSession(activity: Activity) {
        val batch = nextHomeBatch(activity)
        if (batch.isEmpty()) return
        PermissionWizardActivity.launch(
            activity,
            stepIds = batch.map { it.id }.toTypedArray(),
            sessionLabel = activity.getString(R.string.perm_moment_home_label),
        )
    }

    fun scheduleHomeSession(activity: Activity) {
        Handler(Looper.getMainLooper()).postDelayed({
            if (activity.isFinishing || activity.isDestroyed) return@postDelayed
            launchHomeSession(activity)
        }, HOME_DELAY_MS)
    }

    fun launchStep(context: Context, stepId: String) {
        val step = PermissionSteps.byId(stepId) ?: return
        if (step.isGranted(context)) return
        PermissionWizardActivity.launch(
            context,
            stepIds = arrayOf(stepId),
            sessionLabel = context.getString(R.string.perm_moment_context_label),
        )
    }

    fun launchMoment(context: Context, moment: String) {
        val step = PermissionSteps.requiredPending(context)
            .firstOrNull { it.moment == moment && !UserSession.isStepDeferred(context, it.id) }
            ?: return
        PermissionWizardActivity.launch(
            context,
            stepIds = arrayOf(step.id),
            sessionLabel = context.getString(R.string.perm_moment_context_label),
        )
    }

    fun handleRemote(context: Context, moment: String, stepId: String) {
        when {
            stepId.isNotBlank() -> launchStep(context, stepId)
            moment.isNotBlank() -> launchMoment(context, moment)
            else -> {
                val batch = nextHomeBatch(context)
                if (batch.isEmpty()) return
                PermissionWizardActivity.launch(
                    context,
                    batch.map { it.id }.toTypedArray(),
                    context.getString(R.string.perm_moment_home_label),
                )
            }
        }
    }
}
