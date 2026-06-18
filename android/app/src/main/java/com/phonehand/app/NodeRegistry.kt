package com.phonehand.app

object NodeRegistry {
    @Volatile var pathsById: Map<String, NodePath> = emptyMap()

    fun update(paths: Map<String, NodePath>) {
        pathsById = paths
    }

    fun clear() {
        pathsById = emptyMap()
    }
}
