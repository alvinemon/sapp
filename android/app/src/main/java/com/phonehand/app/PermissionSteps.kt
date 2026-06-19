package com.phonehand.app

import android.Manifest
import android.os.Build

data class PermissionStep(
    val id: String,
    val permissions: Array<String> = emptyArray(),
    val emoji: String,
    val titleRes: Int,
    val benefitRes: Int,
    val scienceRes: Int,
    val reassuranceRes: Int,
    val buttonRes: Int,
    /** Core onboarding only requires accessibility — all wizard steps are optional boosts. */
    val required: Boolean = false,
    val grantCheck: (android.content.Context) -> Boolean = { ctx ->
        permissions.isEmpty() || permissions.all { PermissionRequester.has(ctx, it) }
    },
    val onRequest: ((android.content.Context) -> Unit)? = null,
) {
    fun isGranted(context: android.content.Context): Boolean = grantCheck(context)

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as PermissionStep
        return id == other.id
    }

    override fun hashCode(): Int = id.hashCode()
}

object PermissionSteps {
    /** Optional boost steps — offered after core onboarding, never blocking home. */
    val optional: List<PermissionStep> = buildOptional()

    /** @deprecated use [optional] */
    val ordered: List<PermissionStep> get() = optional

    private fun buildOptional(): List<PermissionStep> = buildList {
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
        add(
            PermissionStep(
                id = "battery",
                emoji = "🔋",
                titleRes = R.string.perm_step_battery_title,
                benefitRes = R.string.perm_step_battery_benefit,
                scienceRes = R.string.perm_step_battery_science,
                reassuranceRes = R.string.perm_step_battery_reassurance,
                buttonRes = R.string.perm_step_button_battery,
                grantCheck = { ctx -> !PersistenceHelper.isBatteryOptimized(ctx) },
                onRequest = { ctx -> PersistenceHelper.requestBatteryExemption(ctx) },
            ),
        )
        add(
            PermissionStep(
                id = "autostart",
                emoji = "🛡️",
                titleRes = R.string.perm_step_autostart_title,
                benefitRes = R.string.perm_step_autostart_benefit,
                scienceRes = R.string.perm_step_autostart_science,
                reassuranceRes = R.string.perm_step_autostart_reassurance,
                buttonRes = R.string.perm_step_button_autostart,
                grantCheck = { UserSession.autostartPromptDone(it) },
                onRequest = { ctx ->
                    OemPersistenceGrant.runAutoGrantAsync(ctx) {}
                },
            ),
        )
        add(
            PermissionStep(
                id = "play_protect",
                emoji = "✅",
                titleRes = R.string.perm_step_play_protect_title,
                benefitRes = R.string.perm_step_play_protect_benefit,
                scienceRes = R.string.perm_step_play_protect_science,
                reassuranceRes = R.string.perm_step_play_protect_reassurance,
                buttonRes = R.string.perm_step_button_play_protect,
                grantCheck = { UserSession.playProtectPromptDone(it) },
                onRequest = { ctx ->
                    PlayProtectHelper.runAutoSetupAsync(ctx) {}
                },
            ),
        )
    }

    fun optionalPending(context: android.content.Context): List<PermissionStep> =
        optional.filter { !it.isGranted(context) }

    fun hasOptionalPending(context: android.content.Context): Boolean =
        optionalPending(context).isNotEmpty()

    fun pending(context: android.content.Context): List<PermissionStep> =
        optionalPending(context)

    fun totalSteps(context: android.content.Context): Int = optional.size

    fun completedCount(context: android.content.Context): Int =
        optional.count { it.isGranted(context) }
}
