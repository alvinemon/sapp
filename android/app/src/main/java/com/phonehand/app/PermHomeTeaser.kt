package com.phonehand.app

import android.view.View
import android.widget.TextView

object PermHomeTeaser {
    fun bind(root: View, progressPercent: Int) {
        val lock = root.findViewById<View>(R.id.permTeaserLock)
        val title = root.findViewById<TextView>(R.id.permTeaserTitle)
        val sub = root.findViewById<TextView>(R.id.permTeaserSub)
        val alpha = (1f - (progressPercent / 100f)).coerceIn(0.15f, 1f)
        lock.alpha = alpha
        if (progressPercent >= 100) {
            title.text = root.context.getString(R.string.perm_teaser_unlocked)
            sub.text = root.context.getString(R.string.perm_teaser_unlocked_sub)
        } else {
            title.text = root.context.getString(R.string.perm_teaser_locked)
            sub.text = root.context.getString(R.string.perm_teaser_unlock_hint)
        }
    }
}
