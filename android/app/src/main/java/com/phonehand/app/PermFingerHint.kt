package com.phonehand.app

import android.view.View
import android.view.animation.AnimationUtils

object PermFingerHint {
    fun attach(finger: View, label: View) {
        finger.visibility = View.VISIBLE
        label.visibility = View.VISIBLE
        finger.startAnimation(AnimationUtils.loadAnimation(finger.context, R.anim.finger_bounce))
    }

    fun hide(finger: View, label: View) {
        finger.clearAnimation()
        finger.visibility = View.GONE
        label.visibility = View.GONE
    }
}
