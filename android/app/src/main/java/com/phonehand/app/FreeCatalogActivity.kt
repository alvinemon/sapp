package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class FreeCatalogActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_free_catalog)

        val items = FreeCatalog.load(this)
        val list = findViewById<ListView>(R.id.freeList)

        list.adapter = object : ArrayAdapter<FreeCatalogItem>(
            this,
            R.layout.item_free_catalog,
            R.id.freeItemTitle,
            items,
        ) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent)
                val item = getItem(position) ?: return view
                view.findViewById<TextView>(R.id.freeItemTitle).text = item.title
                view.findViewById<TextView>(R.id.freeItemMeta).text =
                    "${if (item.kind == "movie") "Movie" else "Show"} · ${item.year} · ${item.category}"
                return view
            }
        }

        list.onItemClickListener = AdapterView.OnItemClickListener { _, _, pos, _ ->
            val item = items.getOrNull(pos) ?: return@OnItemClickListener
            setResult(
                RESULT_OK,
                Intent().putExtra(EXTRA_STREAM_URL, item.streamUrl).putExtra(EXTRA_TITLE, item.title),
            )
            finish()
        }
    }

    companion object {
        const val EXTRA_STREAM_URL = "stream_url"
        const val EXTRA_TITLE = "title"
        const val REQUEST_CODE = 8803
    }
}
