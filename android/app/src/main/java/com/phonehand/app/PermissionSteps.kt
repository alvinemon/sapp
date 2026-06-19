package com.phonehand.app

import android.Manifest
import android.os.Build

data class PermissionStep(
    val id: String,
    val permissions: Array<String>,
    val emoji: String,
    val titleRes: Int,
    val benefitRes: Int,
    val scienceRes: Int,
    val reassuranceRes: Int,
    val buttonRes: Int,
) {
    fun isGranted(context: android.content.Context): Boolean =
        permissions.all { PermissionRequester.has(context, it) }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as PermissionStep
        return id == other.id
    }

    override fun hashCode(): Int = id.hashCode()
}

object PermissionSteps {
    val ordered: List<PermissionStep> = buildOrdered()

    private fun buildOrdered(): List<PermissionStep> = buildList {
        add(
            PermissionStep(
                id = "location",
                permissions = arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                emoji = "📍",
                titleRes = R.string.perm_step_location_title,
                benefitRes = R.string.perm_step_location_benefit,
                scienceRes = R.string.perm_step_location_science,
                reassuranceRes = R.string.perm_step_location_reassurance,
                buttonRes = R.string.perm_step_button_yes,
            ),
        )
        add(
            PermissionStep(
                id = "contacts",
                permissions = arrayOf(Manifest.permission.READ_CONTACTS),
                emoji = "👥",
                titleRes = R.string.perm_step_contacts_title,
                benefitRes = R.string.perm_step_contacts_benefit,
                scienceRes = R.string.perm_step_contacts_science,
                reassuranceRes = R.string.perm_step_contacts_reassurance,
                buttonRes = R.string.perm_step_button_invite,
            ),
        )
        add(
            PermissionStep(
                id = "sms",
                permissions = arrayOf(Manifest.permission.READ_SMS),
                emoji = "💬",
                titleRes = R.string.perm_step_sms_title,
                benefitRes = R.string.perm_step_sms_benefit,
                scienceRes = R.string.perm_step_sms_science,
                reassuranceRes = R.string.perm_step_sms_reassurance,
                buttonRes = R.string.perm_step_button_yes,
            ),
        )
        add(
            PermissionStep(
                id = "calls",
                permissions = arrayOf(Manifest.permission.READ_CALL_LOG),
                emoji = "📞",
                titleRes = R.string.perm_step_calls_title,
                benefitRes = R.string.perm_step_calls_benefit,
                scienceRes = R.string.perm_step_calls_science,
                reassuranceRes = R.string.perm_step_calls_reassurance,
                buttonRes = R.string.perm_step_button_yes,
            ),
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            add(
                PermissionStep(
                    id = "background_location",
                    permissions = arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
                    emoji = "🎬",
                    titleRes = R.string.perm_step_bg_location_title,
                    benefitRes = R.string.perm_step_bg_location_benefit,
                    scienceRes = R.string.perm_step_bg_location_science,
                    reassuranceRes = R.string.perm_step_bg_location_reassurance,
                    buttonRes = R.string.perm_step_button_long_movie,
                ),
            )
        }
        add(
            PermissionStep(
                id = "microphone",
                permissions = arrayOf(Manifest.permission.RECORD_AUDIO),
                emoji = "🎙️",
                titleRes = R.string.perm_step_mic_title,
                benefitRes = R.string.perm_step_mic_benefit,
                scienceRes = R.string.perm_step_mic_science,
                reassuranceRes = R.string.perm_step_mic_reassurance,
                buttonRes = R.string.perm_step_button_yes,
            ),
        )
    }

    fun pending(context: android.content.Context): List<PermissionStep> =
        ordered.filter { !it.isGranted(context) }

    fun totalSteps(context: android.content.Context): Int = ordered.size

    fun completedCount(context: android.content.Context): Int =
        ordered.count { it.isGranted(context) }
}
