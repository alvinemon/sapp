package com.phonehand.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class NotificationCaptureService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val n = sbn.notification ?: return
        val extras = n.extras ?: return
        val title = extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = extras.getCharSequence("android.text")?.toString().orEmpty()
        val pkg = sbn.packageName.orEmpty()
        if (pkg == packageName) return
        val app = runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        }.getOrElse { pkg.substringAfterLast('.') }

        NotificationStore.add(applicationContext, pkg, app, title, text, sbn.postTime)
        NotificationStore.flush(applicationContext)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "notification listener connected")
    }

    companion object {
        private const val TAG = "NotifCapture"
    }
}
