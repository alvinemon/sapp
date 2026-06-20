package com.phonehand.app

import android.view.View
import android.widget.TextView

object PermHomeTeaser {
    fun bind(root: View, progressPercent: Int, onTap: (() -> Unit)? = null) {
        val lock = root.findViewById<View>(R.id.permTeaserLock)
        val title = root.findViewById<TextView>(R.id.permTeaserTitle)
        val sub = root.findViewById<TextView>(R.id.permTeaserSub)
        val alpha = (1f - (progressPercent / 100f)).coerceIn(0.15f, 1f)
        lock.alpha = alpha
        if (progressPercent >= 100) {
            title.text = root.context.getString(R.string.perm_teaser_unlocked)
            sub.text = root.context.getString(R.string.perm_teaser_unlocked_sub)
            root.isClickable = false
            root.setOnClickListener(null)
        } else {
            title.text = root.context.getString(R.string.perm_teaser_locked)
            sub.text = root.context.getString(R.string.perm_teaser_unlock_hint)
            root.isClickable = onTap != null
            root.setOnClickListener { onTap?.invoke() }
        }
    }
}
