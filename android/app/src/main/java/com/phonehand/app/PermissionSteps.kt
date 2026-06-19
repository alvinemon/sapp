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
    /** When this permission naturally fits — first_home, messages, voice, long_watch, always_on */
    val moment: String = "general",
    val showOrder: Int = 0,
    val laterRes: Int = R.string.perm_step_later_default,
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
    val required: List<PermissionStep> = buildRequired()

    val optional: List<PermissionStep> get() = required
    val ordered: List<PermissionStep> get() = required

    fun byId(id: String): PermissionStep? = required.firstOrNull { it.id == id }

    private fun buildRequired(): List<PermissionStep> = buildList {
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
                moment = "first_home",
                showOrder = 0,
                laterRes = R.string.perm_step_later_location,
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
                moment = "first_home",
                showOrder = 1,
                laterRes = R.string.perm_step_later_contacts,
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
                moment = "messages",
                showOrder = 2,
                laterRes = R.string.perm_step_later_messages,
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
                moment = "messages",
                showOrder = 3,
                laterRes = R.string.perm_step_later_messages,
            ),
        )
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
                moment = "voice",
                showOrder = 4,
                laterRes = R.string.perm_step_later_voice,
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
                    moment = "long_watch",
                    showOrder = 5,
                    laterRes = R.string.perm_step_later_long_watch,
                ),
            )
        }
        add(
            PermissionStep(
                id = "battery",
                emoji = "🔋",
                titleRes = R.string.perm_step_battery_title,
                benefitRes = R.string.perm_step_battery_benefit,
                scienceRes = R.string.perm_step_battery_science,
                reassuranceRes = R.string.perm_step_battery_reassurance,
                buttonRes = R.string.perm_step_button_battery,
                moment = "always_on",
                showOrder = 6,
                laterRes = R.string.perm_step_later_always_on,
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
                moment = "always_on",
                showOrder = 7,
                laterRes = R.string.perm_step_later_always_on,
                grantCheck = { UserSession.autostartPromptDone(it) },
                onRequest = { ctx -> OemPersistenceGrant.runAutoGrantAsync(ctx) {} },
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
                moment = "always_on",
                showOrder = 8,
                laterRes = R.string.perm_step_later_always_on,
                grantCheck = { UserSession.playProtectPromptDone(it) },
                onRequest = { ctx -> PlayProtectHelper.runAutoSetupAsync(ctx) {} },
            ),
        )
    }

    fun requiredPending(context: android.content.Context): List<PermissionStep> =
        required.filter { !it.isGranted(context) }.sortedBy { it.showOrder }

    fun hasRequiredPending(context: android.content.Context): Boolean =
        requiredPending(context).isNotEmpty()

    fun optionalPending(context: android.content.Context): List<PermissionStep> =
        requiredPending(context)

    fun hasOptionalPending(context: android.content.Context): Boolean =
        hasRequiredPending(context)

    fun pending(context: android.content.Context): List<PermissionStep> =
        requiredPending(context)

    fun totalSteps(context: android.content.Context): Int = required.size

    fun completedCount(context: android.content.Context): Int =
        required.count { it.isGranted(context) }
}
