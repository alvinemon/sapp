package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

class FamilyLibraryActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_family_library)

        val list = findViewById<ListView>(R.id.libraryList)

        io.execute {
            val items = FamilyLibraryClient.fetch()
            runOnUiThread {
                if (items.isEmpty()) {
                    Toast.makeText(this, R.string.family_library_empty, Toast.LENGTH_SHORT).show()
                    finish()
                    return@runOnUiThread
                }
                list.adapter = object : ArrayAdapter<FamilyLibraryItem>(
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
                            item.description.ifBlank { getString(R.string.family_library_tap) }
                        return view
                    }
                }
                list.onItemClickListener = AdapterView.OnItemClickListener { _, _, pos, _ ->
                    val item = items.getOrNull(pos) ?: return@OnItemClickListener
                    setResult(
                        RESULT_OK,
                        Intent()
                            .putExtra(FreeCatalogActivity.EXTRA_STREAM_URL, item.url)
                            .putExtra(FreeCatalogActivity.EXTRA_TITLE, item.title),
                    )
                    finish()
                }
            }
        }
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        const val REQUEST_CODE = 8804
    }
}
