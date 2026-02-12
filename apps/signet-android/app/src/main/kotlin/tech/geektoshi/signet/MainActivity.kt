package tech.geektoshi.signet

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import android.widget.Toast
import tech.geektoshi.signet.data.repository.DeepLinkRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.service.SignetService
import tech.geektoshi.signet.ui.components.BatteryOptimizationDialog
import tech.geektoshi.signet.ui.components.LockScreen
import tech.geektoshi.signet.ui.components.isIgnoringBatteryOptimizations
import tech.geektoshi.signet.ui.navigation.SignetNavHost
import tech.geektoshi.signet.ui.screens.setup.SetupScreen
import tech.geektoshi.signet.ui.theme.SignetTheme
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
    }

    // Track whether the app is ready (DataStore loaded)
    private var isReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install splash screen before super.onCreate()
        val splashScreen = installSplashScreen()

        // Keep native splash visible until DataStore has loaded
        splashScreen.setKeepOnScreenCondition { !isReady }

        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Handle deep link if app was launched via nostrconnect:// URI
        handleDeepLink(intent)

        // Request notification permission using legacy API (compatible with FragmentActivity)
        requestNotificationPermission()

        setContent {
            val settingsRepository = remember { SettingsRepository(this) }
            val daemonUrl by settingsRepository.daemonUrl.collectAsState(initial = null)

            // Dismiss native splash once DataStore has loaded
            LaunchedEffect(daemonUrl) {
                if (daemonUrl != null) {
                    isReady = true
                }
            }

            val batteryPromptShown by settingsRepository.batteryPromptShown.collectAsState(initial = true)
            val appLockEnabled by settingsRepository.appLockEnabled.collectAsState(initial = false)
            val lockTimeoutMinutes by settingsRepository.lockTimeoutMinutes.collectAsState(initial = 1)
            val lastActivityTimestamp by settingsRepository.lastActivityTimestamp.collectAsState(initial = 0L)
            val scope = rememberCoroutineScope()

            var showBatteryDialog by remember { mutableStateOf(false) }
            var isUnlocked by remember { mutableStateOf(false) }
            var backgroundTimestamp by remember { mutableLongStateOf(0L) }

            // Check on startup if we should auto-unlock based on persisted timestamp
            LaunchedEffect(appLockEnabled, lockTimeoutMinutes, lastActivityTimestamp) {
                if (appLockEnabled && lockTimeoutMinutes > 0 && lastActivityTimestamp > 0 && !isUnlocked) {
                    val elapsedMinutes = (System.currentTimeMillis() - lastActivityTimestamp) / 60_000
                    if (elapsedMinutes < lockTimeoutMinutes) {
                        isUnlocked = true
                    }
                }
            }

            // Handle lifecycle for background timeout
            val lifecycleOwner = LocalLifecycleOwner.current
            DisposableEffect(lifecycleOwner, appLockEnabled, lockTimeoutMinutes) {
                val observer = LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_PAUSE -> {
                            backgroundTimestamp = System.currentTimeMillis()
                            // Persist timestamp for app close/reopen scenario
                            scope.launch {
                                settingsRepository.setLastActivityTimestamp(backgroundTimestamp)
                            }
                        }
                        Lifecycle.Event.ON_RESUME -> {
                            if (appLockEnabled && isUnlocked && backgroundTimestamp > 0) {
                                val elapsedMinutes = (System.currentTimeMillis() - backgroundTimestamp) / 60_000
                                if (elapsedMinutes >= lockTimeoutMinutes) {
                                    isUnlocked = false
                                }
                            }
                        }
                        else -> {}
                    }
                }
                lifecycleOwner.lifecycle.addObserver(observer)
                onDispose {
                    lifecycleOwner.lifecycle.removeObserver(observer)
                }
            }

            // Check if we should show battery optimization dialog
            LaunchedEffect(daemonUrl, batteryPromptShown) {
                if (!daemonUrl.isNullOrEmpty() &&
                    !batteryPromptShown &&
                    !isIgnoringBatteryOptimizations(this@MainActivity)
                ) {
                    showBatteryDialog = true
                }
            }

            // Start service when URL is configured
            LaunchedEffect(daemonUrl) {
                if (!daemonUrl.isNullOrEmpty() && hasNotificationPermission()) {
                    SignetService.start(this@MainActivity)
                }
            }

            SignetTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // Show lock screen if app lock is enabled and not unlocked
                    val requiresUnlock = appLockEnabled && !isUnlocked && !daemonUrl.isNullOrEmpty()

                    when {
                        // Show lock screen
                        requiresUnlock -> {
                            LockScreen(
                                onUnlocked = { isUnlocked = true }
                            )
                        }
                        // Still loading - native splash screen handles this
                        daemonUrl == null -> {
                            // Empty - native splash is still visible
                        }
                        // No URL configured - show setup
                        daemonUrl!!.isEmpty() -> {
                            SetupScreen(
                                settingsRepository = settingsRepository,
                                onSetupComplete = {
                                    // Start service after setup completes
                                    if (hasNotificationPermission()) {
                                        SignetService.start(this@MainActivity)
                                    }
                                }
                            )
                        }
                        // URL configured - show main app
                        else -> {
                            SignetNavHost(settingsRepository = settingsRepository)
                        }
                    }

                    // Battery optimization dialog (only show when unlocked)
                    if (showBatteryDialog && !requiresUnlock) {
                        BatteryOptimizationDialog(
                            onDismiss = {
                                showBatteryDialog = false
                                scope.launch {
                                    settingsRepository.setBatteryPromptShown(true)
                                }
                            },
                            onOpenSettings = {
                                showBatteryDialog = false
                                scope.launch {
                                    settingsRepository.setBatteryPromptShown(true)
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    NOTIFICATION_PERMISSION_REQUEST_CODE
                )
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted - service will be started by LaunchedEffect when URL is set
            }
        }
    }

    private fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        if (intent == null) return

        // Handle direct nostrconnect:// URI (from deep link)
        val uri = intent.data
        if (uri?.scheme == "nostrconnect") {
            DeepLinkRepository.setPendingUri(uri.toString())
            return
        }

        // Handle shared text containing nostrconnect:// URI
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
            val extracted = extractNostrConnectUri(sharedText)
            if (extracted != null) {
                DeepLinkRepository.setPendingUri(extracted)
            }
        }
    }

    /**
     * Extract a nostrconnect:// URI from text that may contain other content.
     */
    private fun extractNostrConnectUri(text: String): String? {
        // Look for nostrconnect:// URI in the text
        val regex = Regex("""nostrconnect://[^\s]+""")
        return regex.find(text)?.value
    }
}
