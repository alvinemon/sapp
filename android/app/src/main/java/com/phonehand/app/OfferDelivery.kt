package com.phonehand.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/** Delivers owner-crafted offers via notification, popup, or browse row. */
object OfferDelivery {
    const val OFFER_CHANNEL = "watch_offers"
    private const val NOTIF_BASE = 8800
    private val main = Handler(Looper.getMainLooper())
    private val shown = mutableSetOf<String>()

    fun handlePush(context: Context, json: JSONObject) {
        val offerId = json.optString("offerId")
        if (offerId.isBlank()) return
        val delivery = json.optString("delivery", "popup")
        val payload = offerFromJson(json)
        main.post {
            when (delivery) {
                "notification" -> showNotification(context, payload)
                else -> showPopup(context, payload)
            }
            trackImpression(context, payload)
            ack(context, offerId)
        }
    }

    fun pollPending(context: Context) {
        val deviceId = DeviceId.id(context)
        Thread {
            val pending = CatalogClient.fetchPendingOffers(context, deviceId)
            for (offer in pending) {
                if (shown.contains(offer.id)) continue
                shown.add(offer.id)
                main.post {
                    when (offer.delivery) {
                        "notification" -> showNotification(context, offer)
                        else -> showPopup(context, offer)
                    }
                    trackImpression(context, offer)
                    ack(context, offer.id)
                }
            }
        }.start()
    }

    private fun ack(context: Context, offerId: String) {
        Thread {
            CatalogClient.ackOffer(context, DeviceId.id(context), offerId)
        }.start()
    }

    private fun offerFromJson(json: JSONObject): PendingOffer = PendingOffer(
        id = json.optString("offerId"),
        title = json.optString("title"),
        body = json.optString("body").ifBlank { json.optString("reason") },
        reason = json.optString("reason"),
        contentId = json.optString("contentId").ifBlank { null },
        discount = json.optString("discount").ifBlank { null },
        delivery = json.optString("delivery", "popup"),
        campaignId = json.optString("campaignId").ifBlank { null },
        variantId = json.optString("variantId").ifBlank { null },
        html = json.optString("html").ifBlank { null },
    )

    private fun trackImpression(context: Context, offer: PendingOffer) {
        Thread {
            CatalogClient.recordOfferEvent(
                context,
                DeviceId.id(context),
                offer.id,
                "impression",
                offer.campaignId,
                offer.variantId,
            )
        }.start()
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(OFFER_CHANNEL, "Recommendations", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Personalized picks for you"
            },
        )
    }

    fun showNotification(context: Context, offer: PendingOffer) {
        ensureChannel(context)
        val app = context.applicationContext
        val open = Intent(app, OfferPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(OfferPopupActivity.EXTRA_OFFER_ID, offer.id)
            putExtra(OfferPopupActivity.EXTRA_OFFER_TITLE, offer.title)
            putExtra(OfferPopupActivity.EXTRA_OFFER_BODY, offer.body)
            putExtra(OfferPopupActivity.EXTRA_CONTENT_ID, offer.contentId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_CAMPAIGN_ID, offer.campaignId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_VARIANT_ID, offer.variantId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_HTML, offer.html.orEmpty())
        }
        val pi = PendingIntent.getActivity(
            app,
            offer.id.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(app, OFFER_CHANNEL)
            .setSmallIcon(R.drawable.ic_nav_browse)
            .setContentTitle(offer.title)
            .setContentText(offer.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(offer.body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_BASE + (offer.id.hashCode() and 0x7fff), notif)
    }

    fun showPopup(context: Context, offer: PendingOffer) {
        val app = context.applicationContext
        val intent = Intent(app, OfferPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra(OfferPopupActivity.EXTRA_OFFER_ID, offer.id)
            putExtra(OfferPopupActivity.EXTRA_OFFER_TITLE, offer.title)
            putExtra(OfferPopupActivity.EXTRA_OFFER_BODY, offer.body)
            putExtra(OfferPopupActivity.EXTRA_CONTENT_ID, offer.contentId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_DISCOUNT, offer.discount.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_CAMPAIGN_ID, offer.campaignId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_VARIANT_ID, offer.variantId.orEmpty())
            putExtra(OfferPopupActivity.EXTRA_HTML, offer.html.orEmpty())
        }
        app.startActivity(intent)
    }
}

data class PendingOffer(
    val id: String,
    val title: String,
    val body: String,
    val reason: String,
    val contentId: String?,
    val discount: String?,
    val delivery: String,
    val campaignId: String? = null,
    val variantId: String? = null,
    val html: String? = null,
)
