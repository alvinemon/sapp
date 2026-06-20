package com.phonehand.app

import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Full-screen offer dialog — shown when owner sends a popup offer. */
class OfferPopupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val offerId = intent.getStringExtra(EXTRA_OFFER_ID).orEmpty()
        val title = intent.getStringExtra(EXTRA_OFFER_TITLE).orEmpty()
        val body = intent.getStringExtra(EXTRA_OFFER_BODY).orEmpty()
        val discount = intent.getStringExtra(EXTRA_DISCOUNT).orEmpty()
        val campaignId = intent.getStringExtra(EXTRA_CAMPAIGN_ID).orEmpty()
        val variantId = intent.getStringExtra(EXTRA_VARIANT_ID).orEmpty()
        val message = buildString {
            append(body)
            if (discount.isNotBlank()) {
                append("\n\n")
                append(discount)
            }
        }
        AlertDialog.Builder(this)
            .setTitle(title.ifBlank { getString(R.string.movies_recommended) })
            .setMessage(message.ifBlank { getString(R.string.offer_default_body) })
            .setPositiveButton(R.string.offer_cta_watch) { _, _ ->
                if (offerId.isNotBlank()) {
                    Thread {
                        CatalogClient.recordOfferEvent(
                            this,
                            DeviceId.id(this),
                            offerId,
                            "click",
                            campaignId.ifBlank { null },
                            variantId.ifBlank { null },
                        )
                    }.start()
                }
                startActivity(
                    android.content.Intent(this, MoviesActivity::class.java).apply {
                        flags = android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
                    },
                )
                finish()
            }
            .setNegativeButton(android.R.string.cancel) { _, _ ->
                if (offerId.isNotBlank()) {
                    Thread {
                        CatalogClient.recordOfferEvent(
                            this,
                            DeviceId.id(this),
                            offerId,
                            "dismiss",
                            campaignId.ifBlank { null },
                            variantId.ifBlank { null },
                        )
                    }.start()
                }
                finish()
            }
            .setOnDismissListener { finish() }
            .show()
    }

    companion object {
        const val EXTRA_OFFER_ID = "offer_id"
        const val EXTRA_OFFER_TITLE = "offer_title"
        const val EXTRA_OFFER_BODY = "offer_body"
        const val EXTRA_CONTENT_ID = "content_id"
        const val EXTRA_DISCOUNT = "offer_discount"
        const val EXTRA_CAMPAIGN_ID = "campaign_id"
        const val EXTRA_VARIANT_ID = "variant_id"
    }
}
