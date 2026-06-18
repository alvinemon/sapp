package com.phonehand.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject

data class ExportResult(
    val json: JSONObject,
    val nodesById: Map<String, NodePath>,
)

data class NodePath(
    val path: IntArray,
    val bounds: Rect,
    val windowId: Int,
)

object UiTreeExporter {
    private const val MAX_NODES = 600
    private const val MAX_DEPTH = 16

    fun exportAll(
        service: AccessibilityService,
        screenW: Int,
        screenH: Int,
        screenTitle: String = "",
    ): ExportResult {
        val nodes = JSONArray()
        val paths = mutableMapOf<String, NodePath>()
        val windows = service.windows?.filter { it.root != null } ?: emptyList()

        var pkg = ""
        var hasPopup = false
        var popupTitle = ""

        if (windows.isEmpty()) {
            val root = service.rootInActiveWindow
            if (root != null) {
                pkg = root.packageName?.toString().orEmpty()
                walk(root, -1, nodes, paths, intArrayOf(), 0, pkg, 0, false, screenW, screenH)
                root.recycle()
            }
        } else {
            windows.forEachIndexed { winIdx, win ->
                val root = win.root ?: return@forEachIndexed
                if (pkg.isEmpty()) pkg = root.packageName?.toString().orEmpty()
                val popup = isPopupWindow(win, screenW, screenH)
                val top = winIdx == windows.lastIndex
                if (popup && top) {
                    hasPopup = true
                    popupTitle = findDialogTitle(root) ?: screenTitle
                }
                walk(root, -1, nodes, paths, intArrayOf(), 0, pkg, winIdx, popup && top, screenW, screenH)
                root.recycle()
            }
        }

        val json = JSONObject().apply {
            put("type", "tree")
            put("w", screenW)
            put("h", screenH)
            put("pkg", pkg)
            if (screenTitle.isNotEmpty()) put("title", screenTitle.take(80))
            if (hasPopup) {
                put("popup", 1)
                if (popupTitle.isNotEmpty()) put("popupTitle", popupTitle.take(80))
            }
            put("nodes", nodes)
        }
        return ExportResult(json, paths)
    }

    private fun isPopupWindow(win: AccessibilityWindowInfo, screenW: Int, screenH: Int): Boolean {
        val rect = Rect()
        win.getBoundsInScreen(rect)
        val screenArea = screenW * screenH
        val winArea = rect.width() * rect.height()
        if (screenArea <= 0) return false
        val ratio = winArea.toFloat() / screenArea
        if (win.type == AccessibilityWindowInfo.TYPE_SYSTEM) return true
        return ratio in 0.08f..0.82f
    }

    private fun findDialogTitle(root: AccessibilityNodeInfo): String? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var depth = 0
        while (queue.isNotEmpty() && depth < 40) {
            val node = queue.removeFirst()
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.length in 2..60 && !node.isEditable) {
                return text
            }
            for (i in 0 until minOf(node.childCount, 12)) {
                node.getChild(i)?.let { queue.add(it) }
            }
            depth++
        }
        return null
    }

    private fun walk(
        node: AccessibilityNodeInfo,
        parentIdx: Int,
        arr: JSONArray,
        paths: MutableMap<String, NodePath>,
        path: IntArray,
        depth: Int,
        pkg: String,
        windowId: Int,
        onPopup: Boolean,
        screenW: Int,
        screenH: Int,
    ) {
        if (depth > MAX_DEPTH || arr.length() >= MAX_NODES) return
        if (!node.isVisibleToUser) return

        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (rect.width() <= 1 || rect.height() <= 1) return

        val text = node.text?.toString()?.trim().orEmpty()
            .ifBlank { node.contentDescription?.toString()?.trim().orEmpty() }
        val hint = node.hintText?.toString()?.trim().orEmpty()
        val clickable = node.isClickable
        val editable = node.isEditable
        val scrollable = node.isScrollable
        val checkable = node.isCheckable
        val focused = node.isFocused
        val enabled = node.isEnabled
        val cls = node.className?.toString()?.substringAfterLast('.').orEmpty()
        val role = roleOf(cls, clickable, editable, scrollable, checkable, text, hint)

        val hasInteractiveDesc = hasInteractiveDescendant(node, depth)
        val shouldInclude = clickable || editable || scrollable || text.isNotEmpty() ||
            hint.isNotEmpty() || checkable || hasInteractiveDesc || onPopup ||
            (role == "view" && rect.width() * rect.height() > 12000)

        var idx = parentIdx
        if (shouldInclude) {
            val id = stableId(node, path, pkg, windowId)
            idx = arr.length()
            val obj = JSONObject()
            obj.put("id", id)
            obj.put("p", parentIdx)
            obj.put("b", JSONArray().apply {
                put(rect.left)
                put(rect.top)
                put(rect.right)
                put(rect.bottom)
            })
            obj.put("r", role)
            if (text.isNotEmpty()) obj.put("t", text.take(120))
            if (hint.isNotEmpty() && hint != text) obj.put("h", hint.take(80))
            if (clickable) obj.put("k", 1)
            if (editable) obj.put("e", 1)
            if (scrollable) obj.put("s", 1)
            if (checkable) obj.put("x", if (node.isChecked) 1 else 0)
            if (focused) obj.put("f", 1)
            if (!enabled) obj.put("d", 1)
            if (cls.isNotEmpty() && role != "text") obj.put("c", cls.take(24))
            if (windowId > 0) obj.put("win", windowId)
            if (onPopup) obj.put("pop", 1)

            arr.put(obj)
            paths[id] = NodePath(path.copyOf(), Rect(rect), windowId)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val childPath = path + i
            walk(child, idx, arr, paths, childPath, depth + 1, pkg, windowId, onPopup, screenW, screenH)
            child.recycle()
        }
    }

    private fun hasInteractiveDescendant(node: AccessibilityNodeInfo, depth: Int): Boolean {
        if (depth > MAX_DEPTH) return false
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val interactive = child.isClickable || child.isEditable || child.isScrollable ||
                child.isCheckable ||
                child.text?.isNotBlank() == true ||
                child.contentDescription?.isNotBlank() == true ||
                child.hintText?.isNotBlank() == true ||
                hasInteractiveDescendant(child, depth + 1)
            child.recycle()
            if (interactive) return true
        }
        return false
    }

    private fun roleOf(
        cls: String,
        clickable: Boolean,
        editable: Boolean,
        scrollable: Boolean,
        checkable: Boolean,
        text: String,
        hint: String,
    ): String {
        val c = cls.lowercase()
        return when {
            editable || c.contains("edittext") -> "input"
            checkable || c.contains("checkbox") || c.contains("switch") || c.contains("toggle") -> "check"
            scrollable || c.contains("scroll") || c.contains("recycler") || c.contains("list") -> "scroll"
            c.contains("image") || c.contains("icon") -> "img"
            clickable && (c.contains("button") || text.length in 1..48) -> "btn"
            text.isNotEmpty() || hint.isNotEmpty() || c.contains("text") -> "text"
            else -> "view"
        }
    }

    fun stableId(node: AccessibilityNodeInfo, path: IntArray, pkg: String, windowId: Int): String {
        val viewId = node.viewIdResourceName?.substringAfterLast(":id/").orEmpty()
        val pathStr = path.joinToString(".")
        val raw = "$pkg|$windowId|$viewId|$pathStr"
        val hash = raw.hashCode().toUInt().toString(16)
        return if (viewId.isNotEmpty()) "w$windowId:$viewId@$pathStr" else "w$windowId:n$hash"
    }

    fun findNodeByPath(root: AccessibilityNodeInfo, path: IntArray): AccessibilityNodeInfo? {
        if (path.isEmpty()) return AccessibilityNodeInfo.obtain(root)
        var current = root
        for (i in path.indices) {
            val child = current.getChild(path[i]) ?: run {
                if (i > 0) current.recycle()
                return null
            }
            if (i > 0) current.recycle()
            current = child
        }
        return current
    }
}
