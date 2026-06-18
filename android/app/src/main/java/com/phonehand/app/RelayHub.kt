package com.phonehand.app

object RelayHub {
    @Volatile var live = false

    @Volatile var relayConnected = false

    @Volatile var peerBrowserConnected = false

    @Volatile var screenWidth = 1080

    @Volatile var screenHeight = 2400

    var client: RelayClient? = null
}
