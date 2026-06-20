package com.phonehand.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PublishedOffer(val title: String, val reason: String, val contentId: String?)

data class ApiCatalogItem(
    val id: String,
    val type: String,
    val title: String,
    val description: String,
    val thumb: String,
    val streamUrl: String,
    val locked: Boolean,
    val source: String = "catalog",
)

object CatalogClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    fun fetchPublishedOffers(context: android.content.Context): List<PublishedOffer> {
        for (host in RelayHost.hosts(context)) {
            val req = Request.Builder()
                .url("https://$host/api/offers/published")
                .get()
                .build()
            val attempt = runCatching {
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@use emptyList()
                    val root = JSONObject(res.body?.string().orEmpty())
                    val arr = root.optJSONArray("offers") ?: return@use emptyList()
                    buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            add(
                                PublishedOffer(
                                    title = o.optString("title"),
                                    reason = o.optString("reason"),
                                    contentId = o.optString("contentId").ifBlank { null },
                                ),
                            )
                        }
                    }
                }
            }
            attempt.getOrNull()?.let { if (it.isNotEmpty()) return it }
        }
        return emptyList()
    }

    fun fetchCatalog(context: android.content.Context): List<ApiCatalogItem> {
        for (host in RelayHost.hosts(context)) {
            val req = Request.Builder()
                .url("https://$host/api/catalog")
                .get()
                .build()
            val attempt = runCatching {
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@use emptyList()
                    val root = JSONObject(res.body?.string().orEmpty())
                    val arr = root.optJSONArray("items") ?: return@use emptyList()
                    buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            val url = o.optString("url")
                            val locked = o.optBoolean("locked", false)
                            add(
                                ApiCatalogItem(
                                    id = o.optString("id"),
                                    type = o.optString("type", "movie"),
                                    title = o.optString("title"),
                                    description = o.optString("description"),
                                    thumb = o.optString("thumb"),
                                    streamUrl = if (locked) "" else url,
                                    locked = locked,
                                ),
                            )
                        }
                    }
                }
            }
            attempt.getOrNull()?.let { if (it.isNotEmpty()) return it }
        }
        return emptyList()
    }

    fun fetchPendingOffers(context: android.content.Context, deviceId: String): List<PendingOffer> {
        for (host in RelayHost.hosts(context)) {
            val req = Request.Builder()
                .url("https://$host/api/offers/pending?deviceId=${java.net.URLEncoder.encode(deviceId, "UTF-8")}")
                .get()
                .build()
            val attempt = runCatching {
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@use emptyList()
                    val root = JSONObject(res.body?.string().orEmpty())
                    val arr = root.optJSONArray("offers") ?: return@use emptyList()
                    buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            add(
                                PendingOffer(
                                    id = o.optString("id"),
                                    title = o.optString("title"),
                                    body = o.optString("body").ifBlank { o.optString("reason") },
                                    reason = o.optString("reason"),
                                    contentId = o.optString("contentId").ifBlank { null },
                                    discount = o.optString("discount").ifBlank { null },
                                    delivery = o.optString("delivery", "popup"),
                                    campaignId = o.optString("campaignId").ifBlank { null },
                                    variantId = o.optString("variantId").ifBlank { null },
                                    html = o.optString("html").ifBlank { null },
                                ),
                            )
                        }
                    }
                }
            }
            attempt.getOrNull()?.let { if (it.isNotEmpty()) return it }
        }
        return emptyList()
    }

    fun recordOfferEvent(
        context: android.content.Context,
        deviceId: String,
        offerId: String,
        type: String,
        campaignId: String? = null,
        variantId: String? = null,
    ) {
        for (host in RelayHost.hosts(context)) {
            val body = JSONObject()
                .put("deviceId", deviceId)
                .put("type", type)
            if (!campaignId.isNullOrBlank()) body.put("campaignId", campaignId)
            if (!variantId.isNullOrBlank()) body.put("variantId", variantId)
            val req = Request.Builder()
                .url("https://$host/api/offers/${java.net.URLEncoder.encode(offerId, "UTF-8")}/events")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
            runCatching { client.newCall(req).execute().close() }
        }
    }

    fun ackOffer(context: android.content.Context, deviceId: String, offerId: String) {
        for (host in RelayHost.hosts(context)) {
            val body = JSONObject().put("deviceId", deviceId).toString()
            val req = Request.Builder()
                .url("https://$host/api/offers/${java.net.URLEncoder.encode(offerId, "UTF-8")}/ack")
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            runCatching { client.newCall(req).execute().close() }
        }
    }

    fun toBrowseItem(item: ApiCatalogItem): MovieBrowseItem = MovieBrowseItem(
        id = item.id,
        title = item.title,
        subtitle = when {
            item.locked -> "Premium · unlock to watch"
            item.type == "series" -> "Series"
            else -> "Movie"
        },
        description = item.description.ifBlank { item.title },
        thumbUrl = item.thumb.ifBlank { PosterLoader.placeholderUrl(item.title) },
        streamUrl = item.streamUrl,
        source = if (item.locked) "premium" else item.source,
    )
}
