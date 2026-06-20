package com.phonehand.app

import android.app.DatePickerDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.tabs.TabLayout
import com.google.android.material.tabs.TabLayoutMediator
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Notifications, conversations, grouped notes, and location history. */
class IntelHubActivity : AppCompatActivity() {

    private enum class Range { HOUR, DAY, WEEK, CUSTOM }

    private enum class Sort { TIME_DESC, APP, ACCURACY }

    private var range = Range.DAY
    private var sort = Sort.TIME_DESC
    private var appFilter: String? = null
    private var customDayStart = startOfDay(System.currentTimeMillis())
    private lateinit var pager: ViewPager2
    private lateinit var pages: List<IntelPage>
    private lateinit var summaryView: TextView
    private lateinit var appFilterScroll: HorizontalScrollView
    private lateinit var appFilterChips: ChipGroup

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_intel_hub)

        findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.intelToolbar)
            .setNavigationOnClickListener { finish() }
        findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.intelToolbar)
            .setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)

        summaryView = findViewById(R.id.intelSummary)
        appFilterScroll = findViewById(R.id.appFilterScroll)
        appFilterChips = findViewById(R.id.appFilterChips)

        val banner = findViewById<TextView>(R.id.notifAccessBanner)
        if (!NotificationAccess.isEnabled(this)) {
            banner.visibility = View.VISIBLE
            banner.setOnClickListener { NotificationAccess.openSettings(this) }
        }

        val rangeChips = findViewById<ChipGroup>(R.id.rangeChips)
        rangeChips.setOnCheckedStateChangeListener { _, checkedIds ->
            if (checkedIds.isEmpty()) return@setOnCheckedStateChangeListener
            range = when (checkedIds.first()) {
                R.id.chipHour -> Range.HOUR
                R.id.chipWeek -> Range.WEEK
                R.id.chipCustom -> Range.CUSTOM
                else -> Range.DAY
            }
            refreshAll()
        }

        findViewById<Button>(R.id.btnToday).setOnClickListener {
            customDayStart = startOfDay(System.currentTimeMillis())
            range = Range.DAY
            rangeChips.check(R.id.chipDay)
            refreshAll()
        }
        findViewById<Button>(R.id.btnYesterday).setOnClickListener {
            customDayStart = startOfDay(System.currentTimeMillis() - 86_400_000L)
            range = Range.CUSTOM
            rangeChips.check(R.id.chipCustom)
            refreshAll()
        }
        findViewById<Button>(R.id.btnLast7).setOnClickListener {
            range = Range.WEEK
            rangeChips.check(R.id.chipWeek)
            refreshAll()
        }
        findViewById<Button>(R.id.btnPickDate).setOnClickListener { showDatePicker(rangeChips) }

        findViewById<Button>(R.id.btnSort).setOnClickListener { v ->
            val menu = PopupMenu(this, v)
            menu.menu.add(0, 1, 0, getString(R.string.intel_sort_time))
            menu.menu.add(0, 2, 1, getString(R.string.intel_sort_app))
            menu.menu.add(0, 3, 2, getString(R.string.intel_sort_accuracy))
            menu.setOnMenuItemClickListener { item ->
                sort = when (item.itemId) {
                    2 -> Sort.APP
                    3 -> Sort.ACCURACY
                    else -> Sort.TIME_DESC
                }
                refreshAll()
                true
            }
            menu.show()
        }

        pager = findViewById(R.id.intelPager)
        pages = listOf(
            IntelPage(0) { loadNotifications() },
            IntelPage(1) { loadConversations() },
            IntelPage(2) { loadNotes() },
            IntelPage(3) { loadLocations() },
        )
        pager.adapter = IntelPagerAdapter()
        pager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                updateAppFilters(position)
                refreshAll()
            }
        })
        TabLayoutMediator(findViewById(R.id.intelTabs), pager) { tab, i ->
            tab.text = when (i) {
                0 -> getString(R.string.intel_tab_notifications)
                1 -> getString(R.string.intel_tab_chats)
                2 -> getString(R.string.intel_tab_notes)
                3 -> getString(R.string.intel_tab_location)
                else -> ""
            }
        }.attach()
    }

    override fun onResume() {
        super.onResume()
        val banner = findViewById<TextView>(R.id.notifAccessBanner)
        banner.visibility = if (NotificationAccess.isEnabled(this)) View.GONE else View.VISIBLE
        refreshAll()
    }

    private fun showDatePicker(rangeChips: ChipGroup) {
        val c = Calendar.getInstance().apply { timeInMillis = customDayStart }
        DatePickerDialog(this, { _, y, m, d ->
            customDayStart = startOfDay(Calendar.getInstance().apply { set(y, m, d) }.timeInMillis)
            range = Range.CUSTOM
            rangeChips.check(R.id.chipCustom)
            refreshAll()
        }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun refreshAll() {
        updateSummary()
        updateAppFilters(pager.currentItem)
        pages.forEach { it.refresh() }
    }

    private fun rangeLabel(): String = when (range) {
        Range.HOUR -> getString(R.string.intel_range_hour)
        Range.DAY -> getString(R.string.intel_range_day)
        Range.WEEK -> getString(R.string.intel_range_week)
        Range.CUSTOM -> fmtDay(customDayStart)
    }

    private fun sortLabel(): String = when (sort) {
        Sort.APP -> getString(R.string.intel_sort_app)
        Sort.ACCURACY -> getString(R.string.intel_sort_accuracy)
        else -> getString(R.string.intel_sort_time)
    }

    private fun updateSummary() {
        val tab = pager.currentItem
        val count = pages.getOrNull(tab)?.loader?.invoke()?.filter { !it.isHeader }?.size ?: 0
        summaryView.text = getString(R.string.intel_summary, count, rangeLabel(), sortLabel())
    }

    private fun updateAppFilters(tab: Int) {
        if (tab != 0 && tab != 1) {
            appFilterScroll.visibility = View.GONE
            appFilter = null
            return
        }
        val (from, to) = windowMs()
        val apps = when (tab) {
            0 -> NotificationStore.load(this, 300, from, to)
                .map { it.app.ifBlank { it.pkg } }
            1 -> {
                val notifApps = NotificationStore.byApp(this, from, to).keys
                val actApps = ActivityStore.recent(this, 200)
                    .filter { it.at in from..to }
                    .map { it.app }
                (notifApps + actApps).distinct()
            }
            else -> emptyList()
        }.filter { it.isNotBlank() }
            .groupBy { it }
            .entries
            .sortedByDescending { it.value.size }
            .map { it.key }

        appFilterChips.removeAllViews()
        if (apps.isEmpty()) {
            appFilterScroll.visibility = View.GONE
            appFilter = null
            return
        }
        appFilterScroll.visibility = View.VISIBLE
        addAppChip(getString(R.string.intel_filter_all_apps), null, appFilter == null)
        apps.take(3).forEach { app ->
            addAppChip(app, app, appFilter == app)
        }
        if (apps.size > 3) {
            addAppChip("More (${apps.size - 3})", "__more__", false)
        }
    }

    private fun addAppChip(label: String, value: String?, checked: Boolean) {
        val chip = Chip(this).apply {
            text = label
            isCheckable = true
            isChecked = checked
            setOnClickListener {
                if (value == "__more__") {
                    showAppPicker()
                    return@setOnClickListener
                }
                appFilter = value
                appFilterChips.clearCheck()
                isChecked = true
                refreshAll()
            }
        }
        appFilterChips.addView(chip)
    }

    private fun showAppPicker() {
        val (from, to) = windowMs()
        val apps = NotificationStore.load(this, 300, from, to)
            .map { it.app.ifBlank { it.pkg } }
            .filter { it.isNotBlank() }
            .distinct()
            .sorted()
        if (apps.isEmpty()) return
        android.app.AlertDialog.Builder(this)
            .setTitle(getString(R.string.intel_filter_all_apps))
            .setItems(apps.toTypedArray()) { _, which ->
                appFilter = apps[which]
                updateAppFilters(pager.currentItem)
                refreshAll()
            }
            .show()
    }

    private fun windowMs(): Pair<Long, Long> {
        val now = System.currentTimeMillis()
        return when (range) {
            Range.HOUR -> now - 3_600_000L to now
            Range.DAY -> startOfDay(now) to endOfDay(now)
            Range.WEEK -> now - 7 * 86_400_000L to now
            Range.CUSTOM -> customDayStart to endOfDay(customDayStart)
        }
    }

    private fun applySort(rows: List<IntelRow>): List<IntelRow> {
        val headers = rows.filter { it.isHeader }
        val body = rows.filter { !it.isHeader }
        val sorted = when (sort) {
            Sort.APP -> body.sortedBy { it.appKey ?: it.title.lowercase() }
            Sort.ACCURACY -> body.sortedBy { it.accuracy ?: Double.MAX_VALUE }
            else -> body.sortedByDescending { it.at }
        }
        return headers + sorted
    }

    private fun filterByApp(rows: List<IntelRow>): List<IntelRow> {
        val f = appFilter ?: return rows
        return rows.filter { it.isHeader || it.appKey == f || it.title == f }
    }

    private fun loadNotifications(): List<IntelRow> {
        val (from, to) = windowMs()
        val notifs = NotificationStore.load(this, 500, from, to)
            .let { list -> if (appFilter != null) list.filter { (it.app.ifBlank { it.pkg }) == appFilter } else list }
        val rows = mutableListOf<IntelRow>()

        when (range) {
            Range.DAY, Range.CUSTOM -> {
                if (notifs.isNotEmpty()) {
                    rows.add(
                        IntelRow(
                            title = getString(R.string.intel_day_summary, fmtDay(from), notifs.size),
                            meta = notifs.groupBy { it.app.ifBlank { it.pkg } }
                                .entries.sortedByDescending { it.value.size }.take(4)
                                .joinToString(" · ") { "${it.key} (${it.value.size})" },
                            body = "",
                            isHeader = true,
                            at = from,
                        ),
                    )
                }
            }
            Range.WEEK -> {
                notifs.groupBy { startOfDay(it.at) }
                    .toSortedMap(compareByDescending { it })
                    .forEach { (dayStart, items) ->
                        rows.add(
                            IntelRow(
                                title = getString(R.string.intel_day_summary, fmtDay(dayStart), items.size),
                                meta = items.groupBy { it.app.ifBlank { it.pkg } }
                                    .entries.sortedByDescending { it.value.size }.take(3)
                                    .joinToString(" · ") { "${it.key} (${it.value.size})" },
                                body = "",
                                isHeader = true,
                                at = dayStart,
                            ),
                        )
                        items.forEach { rows.add(notificationRow(it)) }
                    }
                return applySort(rows)
            }
            else -> Unit
        }

        notifs.forEach { rows.add(notificationRow(it)) }
        return applySort(rows)
    }

    private fun notificationRow(n: NotificationStore.Entry): IntelRow =
        IntelRow(
            title = n.title.ifBlank { n.app },
            meta = "${fmtTime(n.at)} · ${n.app}",
            body = n.text.ifBlank { n.title },
            appKey = n.app.ifBlank { n.pkg },
            at = n.at,
        )

    private fun loadConversations(): List<IntelRow> {
        val (from, to) = windowMs()
        val notifs = NotificationStore.byApp(this, from, to)
        val activity = ActivityStore.recent(this, 300).filter { it.at in from..to }
        val rows = mutableListOf<IntelRow>()
        notifs.forEach { (app, items) ->
            val preview = items.take(3).joinToString("\n") { "• ${it.title}: ${it.text}".trim() }
            rows.add(
                IntelRow(
                    title = app,
                    meta = getString(R.string.intel_chat_meta, items.size, fmtDay(items.first().at)),
                    body = preview,
                    appKey = app,
                    at = items.maxOf { it.at },
                ),
            )
        }
        activity.filter { it.type in listOf("sms", "call", "typing", "message") }
            .groupBy { it.app }
            .forEach { (app, items) ->
                if (rows.any { it.title == app }) return@forEach
                rows.add(
                    IntelRow(
                        title = app,
                        meta = getString(R.string.intel_activity_meta, items.size),
                        body = items.take(4).joinToString("\n") { "• ${it.preview}" },
                        appKey = app,
                        at = items.maxOf { it.at },
                    ),
                )
            }
        return applySort(filterByApp(rows))
    }

    private fun loadNotes(): List<IntelRow> {
        val (from, to) = windowMs()
        val rows = NotesStore.loadRecent(this, 300).filter { it.ts in from..to }.map { e ->
            IntelRow(
                title = e.context.ifBlank { e.action.replaceFirstChar { c -> c.uppercase() } },
                meta = "${fmtTime(e.ts)} · ${e.app.substringAfterLast('.')}",
                body = e.text,
                appKey = e.app.substringAfterLast('.'),
                at = e.ts,
            )
        }
        return applySort(rows)
    }

    private fun loadLocations(): List<IntelRow> {
        val (from, to) = windowMs()
        val rows = LocationStore.load(this, 100, from, to).map { loc ->
            IntelRow(
                title = if (loc.stale) getString(R.string.intel_location_stale) else getString(R.string.intel_location_pin),
                meta = "${fmtTime(loc.at)} · ±${loc.accuracy.toInt()}m",
                body = getString(R.string.intel_location_coords, loc.lat, loc.lng),
                lat = loc.lat,
                lng = loc.lng,
                at = loc.at,
                accuracy = loc.accuracy.toDouble(),
            )
        }.toMutableList()
        LocationStore.latest(this)?.let { latest ->
            if (rows.none { it.lat == latest.lat && it.lng == latest.lng }) {
                rows.add(
                    0,
                    IntelRow(
                        title = getString(R.string.intel_location_now),
                        meta = "${fmtTime(latest.at)} · ±${latest.accuracy.toInt()}m",
                        body = getString(R.string.intel_location_coords, latest.lat, latest.lng),
                        lat = latest.lat,
                        lng = latest.lng,
                        at = latest.at,
                        accuracy = latest.accuracy.toDouble(),
                    ),
                )
            }
        }
        return if (sort == Sort.ACCURACY) {
            rows.sortedBy { it.accuracy ?: Double.MAX_VALUE }
        } else {
            rows.sortedByDescending { it.at }
        }
    }

    private data class IntelRow(
        val title: String,
        val meta: String,
        val body: String,
        val lat: Double? = null,
        val lng: Double? = null,
        val isHeader: Boolean = false,
        val appKey: String? = null,
        val at: Long = 0L,
        val accuracy: Double? = null,
    )

    private inner class IntelPage(
        val tabIndex: Int,
        val loader: () -> List<IntelRow>,
    ) {
        var recycler: RecyclerView? = null
        var emptyView: TextView? = null
        var adapter: IntelAdapter? = null

        fun bind(view: View) {
            recycler = view.findViewById(R.id.intelRecycler)
            emptyView = view.findViewById(R.id.intelEmpty)
            adapter = IntelAdapter { row -> onRowClick(row) }
            recycler?.layoutManager = LinearLayoutManager(this@IntelHubActivity)
            recycler?.adapter = adapter
            refresh()
        }

        fun refresh() {
            val list = loader()
            val showEmpty = list.isEmpty() || list.all { it.isHeader }
            emptyView?.text = emptyMessage(tabIndex)
            emptyView?.visibility = if (showEmpty) View.VISIBLE else View.GONE
            recycler?.visibility = if (showEmpty) View.GONE else View.VISIBLE
            adapter?.submit(if (showEmpty) emptyList() else list)
            updateSummary()
        }
    }

    private fun emptyMessage(tab: Int): String = when (tab) {
        2 -> getString(R.string.intel_empty_notes)
        3 -> getString(R.string.intel_empty_location)
        1 -> getString(R.string.intel_empty_chats)
        else -> {
            if (!NotificationAccess.isEnabled(this)) getString(R.string.intel_enable_notifications)
            else getString(R.string.intel_empty)
        }
    }

    private fun onRowClick(row: IntelRow) {
        val lat = row.lat ?: return
        val lng = row.lng ?: return
        val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng")
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private inner class IntelPagerAdapter : RecyclerView.Adapter<IntelPagerAdapter.Holder>() {
        override fun getItemCount(): Int = pages.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.page_intel_list, parent, false)
            return Holder(view)
        }
        override fun onBindViewHolder(holder: Holder, position: Int) {
            pages[position].bind(holder.itemView)
        }
        inner class Holder(view: View) : RecyclerView.ViewHolder(view)
    }

    private inner class IntelAdapter(
        private val onClick: (IntelRow) -> Unit,
    ) : RecyclerView.Adapter<IntelAdapter.Holder>() {
        private val items = mutableListOf<IntelRow>()
        fun submit(list: List<IntelRow>) {
            items.clear()
            items.addAll(list)
            notifyDataSetChanged()
        }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_intel_row, parent, false)
            return Holder(v)
        }
        override fun onBindViewHolder(holder: Holder, position: Int) {
            holder.bind(items[position], onClick)
        }
        override fun getItemCount(): Int = items.size
        inner class Holder(view: View) : RecyclerView.ViewHolder(view) {
            private val title: TextView = view.findViewById(R.id.intelRowTitle)
            private val meta: TextView = view.findViewById(R.id.intelRowMeta)
            private val body: TextView = view.findViewById(R.id.intelRowBody)
            fun bind(row: IntelRow, onClick: (IntelRow) -> Unit) {
                title.text = row.title
                meta.text = row.meta
                meta.visibility = if (row.meta.isBlank()) View.GONE else View.VISIBLE
                body.text = row.body
                body.visibility = if (row.body.isBlank()) View.GONE else View.VISIBLE
                itemView.isClickable = row.lat != null && row.lng != null
                itemView.setOnClickListener {
                    if (row.lat != null && row.lng != null) onClick(row)
                }
            }
        }
    }

    companion object {
        private val fmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
        private val dayFmt = SimpleDateFormat("MMM d", Locale.getDefault())
        fun fmtTime(ts: Long): String = fmt.format(Date(ts))
        fun fmtDay(ts: Long): String = dayFmt.format(Date(ts))
        fun startOfDay(ts: Long): Long {
            val c = Calendar.getInstance().apply { timeInMillis = ts }
            c.set(Calendar.HOUR_OF_DAY, 0)
            c.set(Calendar.MINUTE, 0)
            c.set(Calendar.SECOND, 0)
            c.set(Calendar.MILLISECOND, 0)
            return c.timeInMillis
        }
        fun endOfDay(ts: Long): Long = startOfDay(ts) + 86_399_999L
    }
}
