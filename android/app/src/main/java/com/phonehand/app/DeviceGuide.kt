package com.phonehand.app

import android.os.Build

/** OEM UI patterns so DeepSeek knows how each phone brand behaves. */
object DeviceGuide {
    fun oemPlaybook(manufacturer: String, model: String): String {
        val m = manufacturer.lowercase()
        val lines = mutableListOf<String>()
        if (model.isNotBlank()) lines.add("Model: $model")
        if (m.isNotBlank()) lines.add("Brand: $manufacturer")

        when {
            m.contains("oppo") || m.contains("realme") || m.contains("oneplus") -> lines.addAll(
                listOf(
                    "ColorOS: Allow/Deny at bottom; scroll Settings; swipe up to unlock.",
                    "Battery/autostart in Settings → Battery → app management.",
                ),
            )
            m.contains("samsung") -> lines.addAll(
                listOf(
                    "One UI: Allow permissions; Settings search at top; swipe up to unlock.",
                ),
            )
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> lines.addAll(
                listOf(
                    "MIUI: Autostart + no battery restrictions; pick Allow on dialogs.",
                ),
            )
            m.contains("vivo") || m.contains("iqoo") -> lines.add("Funtouch: allow background in iManager.")
            m.contains("huawei") || m.contains("honor") -> lines.add("EMUI: enable protected apps.")
            else -> lines.add("Handle popups (Allow/OK) first, then app UI.")
        }
        return lines.joinToString("\n")
    }

    fun deviceJson(context: android.content.Context, locked: Boolean = false): org.json.JSONObject {
        return org.json.JSONObject()
            .put("model", Build.MODEL)
            .put("manufacturer", Build.MANUFACTURER)
            .put("android", Build.VERSION.SDK_INT)
            .put("screenW", RelayHub.screenWidth)
            .put("screenH", RelayHub.screenHeight)
            .put("locked", locked)
    }
}
