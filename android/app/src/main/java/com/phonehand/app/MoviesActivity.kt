package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomnavigation.BottomNavigationView
import java.util.concurrent.Executors

/** Netflix-style movie browse home for the Android app. */
class MoviesActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()
    private lateinit var moviesList: RecyclerView
    private lateinit var loading: ProgressBar
    private lateinit var adapter: MoviesAdapter
    private var myListItems: List<MovieBrowseItem> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_movies)

        moviesList = findViewById(R.id.moviesList)
        loading = findViewById(R.id.moviesLoading)
        adapter = MoviesAdapter { item -> openPlayer(item) }
        moviesList.layoutManager = LinearLayoutManager(this)
        moviesList.adapter = adapter

        findViewById<BottomNavigationView>(R.id.bottomNav).setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> {
                    finish()
                    true
                }
                R.id.nav_movies -> true
                R.id.nav_my_list -> {
                    showMyList()
                    false
                }
                else -> false
            }
        }

        loadCatalog()
    }

    private fun loadCatalog() {
        loading.visibility = View.VISIBLE
        val freeItems = FreeCatalog.load(this)
        io.execute {
            val familyItems = FamilyLibraryClient.fetch().map { it.toBrowseItem() }
            val continueItems = ContinueWatchingStore.load(this)
            myListItems = familyItems

            val movies = freeItems.filter { it.kind == "movie" }.map { it.toBrowseItem() }
            val shows = freeItems.filter { it.kind == "tv" }.map { it.toBrowseItem() }
            val trending = freeItems.shuffled().map { it.toBrowseItem() }
            val featured = trending.firstOrNull() ?: movies.firstOrNull() ?: shows.firstOrNull()

            val rows = buildList {
                if (continueItems.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(getString(R.string.movies_continue), continueItems)))
                }
                add(MoviesListItem.Row(MovieRow(getString(R.string.movies_trending), trending)))
                if (movies.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(getString(R.string.movies_free), movies)))
                }
                if (shows.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(getString(R.string.movies_tv), shows)))
                }
                if (familyItems.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(getString(R.string.movies_family), familyItems)))
                }
            }

            val list = buildList {
                featured?.let { add(MoviesListItem.Hero(it)) }
                addAll(rows)
            }

            runOnUiThread {
                loading.visibility = View.GONE
                adapter.submit(list)
            }
        }
    }

    private fun showMyList() {
        if (myListItems.isEmpty()) {
            android.widget.Toast.makeText(this, R.string.movies_my_list_empty, android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        adapter.submit(
            buildList {
                add(MoviesListItem.Row(MovieRow(getString(R.string.movies_nav_my_list), myListItems)))
            },
        )
    }

    private fun openPlayer(item: MovieBrowseItem) {
        ContinueWatchingStore.save(this, item)
        startActivity(
            Intent(this, WatchRoomActivity::class.java).apply {
                putExtra(FreeCatalogActivity.EXTRA_STREAM_URL, item.streamUrl)
                putExtra(FreeCatalogActivity.EXTRA_TITLE, item.title)
            },
        )
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }
}
