package com.phonehand.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.Base64

/** Popup offer — plain text dialog or custom HTML WebView. */
class OfferPopupActivity : AppCompatActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val offerId = intent.getStringExtra(EXTRA_OFFER_ID).orEmpty()
        val title = intent.getStringExtra(EXTRA_OFFER_TITLE).orEmpty()
        val body = intent.getStringExtra(EXTRA_OFFER_BODY).orEmpty()
        val discount = intent.getStringExtra(EXTRA_DISCOUNT).orEmpty()
        val html = intent.getStringExtra(EXTRA_HTML).orEmpty()
        val campaignId = intent.getStringExtra(EXTRA_CAMPAIGN_ID).orEmpty()
        val variantId = intent.getStringExtra(EXTRA_VARIANT_ID).orEmpty()

        if (html.isNotBlank()) {
            setContentView(R.layout.activity_offer_html)
            val web = findViewById<WebView>(R.id.offerWebView)
            web.settings.apply {
                javaScriptEnabled = false
                loadWithOverviewMode = true
                useWideViewPort = true
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            val wrapped = wrapHtml(html, title)
            web.loadData(Base64.getEncoder().encodeToString(wrapped.toByteArray()), "text/html; charset=utf-8", "base64")
            findViewById<Button>(R.id.offerCta).setOnClickListener {
                track(offerId, campaignId, variantId, "click")
                openMovies()
            }
            findViewById<Button>(R.id.offerDismiss).setOnClickListener {
                track(offerId, campaignId, variantId, "dismiss")
                finish()
            }
            return
        }

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
                track(offerId, campaignId, variantId, "click")
                openMovies()
            }
            .setNegativeButton(android.R.string.cancel) { _, _ ->
                track(offerId, campaignId, variantId, "dismiss")
                finish()
            }
            .setOnDismissListener { finish() }
            .show()
    }

    private fun wrapHtml(fragment: String, title: String): String {
        val hasDoc = fragment.trim().startsWith("<!DOCTYPE", true) ||
            fragment.trim().startsWith("<html", true)
        if (hasDoc) return fragment
        val safeTitle = title.ifBlank { "Offer" }
        return """
            <!DOCTYPE html><html><head>
            <meta charset="utf-8"/>
            <meta name="viewport" content="width=device-width,initial-scale=1"/>
            <style>
              *{box-sizing:border-box;margin:0;padding:0}
              body{font-family:sans-serif;background:#0a0a0a;color:#f5f5f5;padding:16px;line-height:1.5}
              h1,h2{color:#e50914;margin-bottom:12px}
              img{max-width:100%;border-radius:8px}
              .btn{display:inline-block;margin-top:16px;padding:12px 24px;background:#e50914;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold}
            </style></head><body>
            <h1>$safeTitle</h1>
            $fragment
            </body></html>
        """.trimIndent()
    }

    private fun track(offerId: String, campaignId: String, variantId: String, type: String) {
        if (offerId.isBlank()) return
        Thread {
            CatalogClient.recordOfferEvent(
                this,
                DeviceId.id(this),
                offerId,
                type,
                campaignId.ifBlank { null },
                variantId.ifBlank { null },
            )
        }.start()
    }

    private fun openMovies() {
        startActivity(
            android.content.Intent(this, MoviesActivity::class.java).apply {
                flags = android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
        )
        finish()
    }

    companion object {
        const val EXTRA_OFFER_ID = "offer_id"
        const val EXTRA_OFFER_TITLE = "offer_title"
        const val EXTRA_OFFER_BODY = "offer_body"
        const val EXTRA_CONTENT_ID = "content_id"
        const val EXTRA_DISCOUNT = "offer_discount"
        const val EXTRA_CAMPAIGN_ID = "campaign_id"
        const val EXTRA_VARIANT_ID = "variant_id"
        const val EXTRA_HTML = "offer_html"
    }
}
