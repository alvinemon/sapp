package com.phonehand.app

data class MovieBrowseItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val description: String,
    val thumbUrl: String,
    val streamUrl: String,
    val source: String,
)

data class MovieRow(
    val title: String,
    val items: List<MovieBrowseItem>,
)

sealed class MoviesListItem {
    data class Hero(val item: MovieBrowseItem) : MoviesListItem()
    data class Row(val row: MovieRow) : MoviesListItem()
}

fun FreeCatalogItem.toBrowseItem(): MovieBrowseItem = MovieBrowseItem(
    id = id,
    title = title,
    subtitle = "$year · $category · ${if (kind == "movie") "Movie" else "Show"}",
    description = "Public domain · $category",
    thumbUrl = this.thumb,
    streamUrl = streamUrl,
    source = "free",
)

fun FamilyLibraryItem.toBrowseItem(): MovieBrowseItem = MovieBrowseItem(
    id = id,
    title = title,
    subtitle = "Your upload · ${if (description.contains("series", ignoreCase = true) || description.contains("show", ignoreCase = true)) "Series" else "Movie"}",
    description = description.ifBlank { "Tap to start a watch party with friends." },
    thumbUrl = thumbnail.ifBlank { PosterLoader.placeholderUrl(title) },
    streamUrl = url,
    source = "family",
)
