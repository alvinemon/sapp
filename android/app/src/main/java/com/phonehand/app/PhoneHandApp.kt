package com.phonehand.app

import android.app.Application

class PhoneHandApp : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching { StealthNotifications.suppressAll(this) }
    }
}
