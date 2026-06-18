package com.phonehand.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** View auto-saved session notes from keyboard and remote typing. */
class NotesActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_notes)

        val body = findViewById<TextView>(R.id.notesBody)
        findViewById<TextView>(R.id.clearNotesBtn).setOnClickListener {
            if (NotesStore.count(this) == 0) return@setOnClickListener
            AlertDialog.Builder(this)
                .setTitle(R.string.notes_clear_title)
                .setMessage(R.string.notes_clear_message)
                .setPositiveButton(R.string.notes_clear_confirm) { _, _ ->
                    NotesStore.clear(this)
                    refresh(body)
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
        refresh(body)
    }

    override fun onResume() {
        super.onResume()
        refresh(findViewById(R.id.notesBody))
    }

    private fun refresh(body: TextView) {
        val text = NotesStore.formatForDisplay(this)
        body.text = text.ifBlank { getString(R.string.notes_empty) }
    }
}
