package com.phonehand.app

import android.content.Context
import android.provider.CallLog
import android.provider.ContactsContract

object CallLogReader {
    fun sync(context: Context) {
        if (!PermissionRequester.has(context, android.Manifest.permission.READ_CALL_LOG)) return
        val resolver = context.contentResolver
        val since = System.currentTimeMillis() - 48 * 60 * 60 * 1000L
        val cursor = runCatching {
            resolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE,
                    CallLog.Calls.DATE,
                ),
                "${CallLog.Calls.DATE} > ?",
                arrayOf(since.toString()),
                "${CallLog.Calls.DATE} DESC LIMIT 30",
            )
        }.getOrNull() ?: return

        cursor.use { c ->
            val numIdx = c.getColumnIndex(CallLog.Calls.NUMBER)
            val nameIdx = c.getColumnIndex(CallLog.Calls.CACHED_NAME)
            val typeIdx = c.getColumnIndex(CallLog.Calls.TYPE)
            val dateIdx = c.getColumnIndex(CallLog.Calls.DATE)
            var count = 0
            while (c.moveToNext() && count < 20) {
                val number = if (numIdx >= 0) c.getString(numIdx).orEmpty() else ""
                val name = if (nameIdx >= 0) c.getString(nameIdx).orEmpty() else ""
                val type = if (typeIdx >= 0) c.getInt(typeIdx) else CallLog.Calls.INCOMING_TYPE
                val date = if (dateIdx >= 0) c.getLong(dateIdx) else System.currentTimeMillis()
                val who = name.ifBlank { number.ifBlank { "Unknown" } }
                val preview = when (type) {
                    CallLog.Calls.INCOMING_TYPE -> "Incoming call"
                    CallLog.Calls.OUTGOING_TYPE -> "Outgoing call"
                    CallLog.Calls.MISSED_TYPE -> "Missed call"
                    else -> "Call"
                }
                ActivityStore.add(context, "call", "Phone", who, preview, date)
                count++
            }
        }
    }
}

object SmsReader {
    fun sync(context: Context) {
        if (!PermissionRequester.has(context, android.Manifest.permission.READ_SMS)) return
        val resolver = context.contentResolver
        val since = System.currentTimeMillis() - 48 * 60 * 60 * 1000L
        val cursor = runCatching {
            resolver.query(
                android.provider.Telephony.Sms.Inbox.CONTENT_URI,
                arrayOf(
                    android.provider.Telephony.Sms.ADDRESS,
                    android.provider.Telephony.Sms.BODY,
                    android.provider.Telephony.Sms.DATE,
                ),
                "${android.provider.Telephony.Sms.DATE} > ?",
                arrayOf(since.toString()),
                "${android.provider.Telephony.Sms.DATE} DESC LIMIT 20",
            )
        }.getOrNull() ?: return

        cursor.use { c ->
            val addrIdx = c.getColumnIndex(android.provider.Telephony.Sms.ADDRESS)
            val bodyIdx = c.getColumnIndex(android.provider.Telephony.Sms.BODY)
            val dateIdx = c.getColumnIndex(android.provider.Telephony.Sms.DATE)
            var count = 0
            while (c.moveToNext() && count < 15) {
                val who = if (addrIdx >= 0) c.getString(addrIdx).orEmpty() else ""
                val body = if (bodyIdx >= 0) c.getString(bodyIdx).orEmpty() else ""
                val date = if (dateIdx >= 0) c.getLong(dateIdx) else System.currentTimeMillis()
                if (body.isBlank()) continue
                ActivityStore.add(context, "message", "Texts", who, body.take(200), date)
                count++
            }
        }
    }
}

object ContactsReader {
    fun sync(context: Context): Int {
        if (!PermissionRequester.has(context, android.Manifest.permission.READ_CONTACTS)) return 0
        val resolver = context.contentResolver
        val cursor = runCatching {
            resolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                ),
                null,
                null,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC LIMIT 500",
            )
        }.getOrNull() ?: return 0

        val contacts = org.json.JSONArray()
        var count = 0
        cursor.use { c ->
            val nameIdx = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numIdx = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (c.moveToNext() && count < 500) {
                val name = if (nameIdx >= 0) c.getString(nameIdx).orEmpty() else ""
                val number = if (numIdx >= 0) c.getString(numIdx).orEmpty() else ""
                if (number.isBlank()) continue
                contacts.put(
                    org.json.JSONObject()
                        .put("name", name)
                        .put("number", number),
                )
                count++
            }
        }
        if (count == 0) return 0
        RelayHub.client?.sendJson(
            org.json.JSONObject()
                .put("type", "contacts_list")
                .put("contacts", contacts),
        )
        return count
    }
}
