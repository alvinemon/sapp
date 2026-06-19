package com.phonehand.app

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class MoviesAdapter(
    private val onPlay: (MovieBrowseItem) -> Unit,
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private val items = mutableListOf<MoviesListItem>()

    fun submit(list: List<MoviesListItem>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int = when (items[position]) {
        is MoviesListItem.Hero -> VIEW_HERO
        is MoviesListItem.Row -> VIEW_ROW
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            VIEW_HERO -> HeroHolder(
                inflater.inflate(R.layout.item_movie_hero, parent, false),
                onPlay,
            )
            else -> RowHolder(
                inflater.inflate(R.layout.item_movie_row, parent, false),
                onPlay,
            )
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is MoviesListItem.Hero -> (holder as HeroHolder).bind(item.item)
            is MoviesListItem.Row -> (holder as RowHolder).bind(item.row)
        }
    }

    override fun getItemCount(): Int = items.size

    private class HeroHolder(
        view: View,
        private val onPlay: (MovieBrowseItem) -> Unit,
    ) : RecyclerView.ViewHolder(view) {
        private val backdrop: ImageView = view.findViewById(R.id.heroBackdrop)
        private val title: TextView = view.findViewById(R.id.heroTitle)
        private val meta: TextView = view.findViewById(R.id.heroMeta)
        private val description: TextView = view.findViewById(R.id.heroDescription)

        fun bind(item: MovieBrowseItem) {
            title.text = item.title
            meta.text = item.subtitle
            description.text = item.description
            PosterLoader.load(item.thumbUrl, backdrop)
            itemView.findViewById<View>(R.id.heroPlay).setOnClickListener { onPlay(item) }
            itemView.findViewById<View>(R.id.heroInfo).setOnClickListener {
                MaterialAlertDialogBuilder(itemView.context)
                    .setTitle(item.title)
                    .setMessage("${item.subtitle}\n\n${item.description}")
                    .setPositiveButton(R.string.movies_play) { _, _ -> onPlay(item) }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            }
        }
    }

    private class RowHolder(
        view: View,
        private val onPlay: (MovieBrowseItem) -> Unit,
    ) : RecyclerView.ViewHolder(view) {
        private val rowTitle: TextView = view.findViewById(R.id.rowTitle)
        private val rowRecycler: RecyclerView = view.findViewById(R.id.rowRecycler)
        private var boundRow: MovieRow? = null

        init {
            rowRecycler.layoutManager = LinearLayoutManager(
                itemView.context,
                LinearLayoutManager.HORIZONTAL,
                false,
            )
        }

        fun bind(row: MovieRow) {
            rowTitle.text = row.title
            if (boundRow?.title == row.title && boundRow?.items === row.items) return
            boundRow = row
            rowRecycler.adapter = PosterAdapter(row.items, onPlay)
        }
    }

    private class PosterAdapter(
        private val items: List<MovieBrowseItem>,
        private val onPlay: (MovieBrowseItem) -> Unit,
    ) : RecyclerView.Adapter<PosterAdapter.PosterHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PosterHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_movie_poster, parent, false)
            return PosterHolder(view, onPlay)
        }

        override fun onBindViewHolder(holder: PosterHolder, position: Int) {
            holder.bind(items[position])
        }

        override fun getItemCount(): Int = items.size

        class PosterHolder(
            view: View,
            private val onPlay: (MovieBrowseItem) -> Unit,
        ) : RecyclerView.ViewHolder(view) {
            private val image: ImageView = view.findViewById(R.id.posterImage)
            private val title: TextView = view.findViewById(R.id.posterTitle)

            fun bind(item: MovieBrowseItem) {
                title.text = item.title
                PosterLoader.load(item.thumbUrl, image)
                itemView.setOnClickListener { onPlay(item) }
            }
        }
    }

    companion object {
        private const val VIEW_HERO = 0
        private const val VIEW_ROW = 1
    }
}
