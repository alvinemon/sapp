package com.phonehand.app

import org.json.JSONObject

data class FreeCatalogItem(
    val id: String,
    val title: String,
    val year: Int,
    val category: String,
    val kind: String,
    val streamUrl: String,
) {
    fun label(): String = "$title ($year) · $category"
}

object FreeCatalog {
    fun load(context: android.content.Context): List<FreeCatalogItem> {
        return runCatching {
            context.assets.open("free-catalog.json").use { input ->
                val text = input.bufferedReader().readText()
                val root = JSONObject(text)
                val arr = root.getJSONArray("items")
                buildList {
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        add(
                            FreeCatalogItem(
                                id = o.getString("id"),
                                title = o.getString("title"),
                                year = o.optInt("year"),
                                category = o.getString("category"),
                                kind = o.getString("kind"),
                                streamUrl = o.getString("streamUrl"),
                            ),
                        )
                    }
                }
            }
        }.getOrElse { emptyList() }
    }
}
