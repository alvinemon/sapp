package com.phonehand.app

import org.json.JSONArray
import org.json.JSONObject

object TreeDiffer {
    private var lastNodes: Map<String, JSONObject> = emptyMap()
    private var lastPkg: String = ""
    private var lastPopup: Int = 0
    private var seq = 0
    private var lastFullAt = 0L

    fun reset() {
        lastNodes = emptyMap()
        lastPkg = ""
        lastPopup = 0
        seq = 0
        lastFullAt = 0L
    }

    /** Returns full tree JSON, patch JSON, or null if unchanged. */
    fun diff(current: JSONObject): JSONObject? {
        val nodes = current.getJSONArray("nodes")
        val currentMap = linkedMapOf<String, JSONObject>()
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            currentMap[n.getString("id")] = n
        }

        val pkg = current.optString("pkg", "")
        val popup = current.optInt("popup", 0)
        val now = System.currentTimeMillis()
        val forceFull = lastNodes.isEmpty() ||
            pkg != lastPkg ||
            popup != lastPopup ||
            now - lastFullAt > 30_000

        if (forceFull) {
            lastNodes = currentMap
            lastPkg = pkg
            lastPopup = popup
            lastFullAt = now
            return current
        }

        val add = JSONArray()
        val update = JSONArray()
        val remove = JSONArray()

        for ((id, n) in currentMap) {
            val prev = lastNodes[id]
            when {
                prev == null -> add.put(n)
                nodeChanged(prev, n) -> update.put(n)
            }
        }
        for (id in lastNodes.keys) {
            if (!currentMap.containsKey(id)) remove.put(id)
        }

        lastNodes = currentMap
        lastPkg = pkg
        lastPopup = popup

        if (add.length() == 0 && update.length() == 0 && remove.length() == 0) {
            return null
        }

        return JSONObject().apply {
            put("type", "patch")
            put("seq", ++seq)
            put("add", add)
            put("update", update)
            put("remove", remove)
        }
    }

    private fun nodeChanged(a: JSONObject, b: JSONObject): Boolean {
        if (a.optString("t") != b.optString("t")) return true
        if (a.optString("h") != b.optString("h")) return true
        if (a.optString("r") != b.optString("r")) return true
        if (a.optString("c") != b.optString("c")) return true
        if (a.optInt("k") != b.optInt("k")) return true
        if (a.optInt("e") != b.optInt("e")) return true
        if (a.optInt("s") != b.optInt("s")) return true
        if (a.optInt("x", -1) != b.optInt("x", -1)) return true
        if (a.optInt("f") != b.optInt("f")) return true
        if (a.optInt("d") != b.optInt("d")) return true
        if (a.optInt("pop") != b.optInt("pop")) return true
        if (a.optInt("win") != b.optInt("win")) return true
        val ba = a.getJSONArray("b")
        val bb = b.getJSONArray("b")
        for (i in 0 until 4) {
            if (ba.getInt(i) != bb.getInt(i)) return true
        }
        return false
    }
}
