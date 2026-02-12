package tech.geektoshi.signet.ui.navigation

import android.widget.Toast
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.ConnectedApp
import tech.geektoshi.signet.data.model.DeadManSwitchStatus
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.data.repository.DeepLinkRepository
import tech.geektoshi.signet.data.repository.EventBusRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.DeepLinkConnectSheet
import tech.geektoshi.signet.ui.components.InactivityLockScreen
import tech.geektoshi.signet.ui.screens.activity.ActivityScreen
import tech.geektoshi.signet.ui.screens.apps.AppsScreen
import tech.geektoshi.signet.ui.screens.help.HelpScreen
import tech.geektoshi.signet.ui.screens.home.HomeScreen
import tech.geektoshi.signet.ui.screens.keys.KeysScreen
import tech.geektoshi.signet.ui.screens.settings.SettingsScreen
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary

@Composable
fun SignetNavHost(settingsRepository: SettingsRepository) {
    val context = LocalContext.current
    val daemonUrl by settingsRepository.daemonUrl.collectAsState(initial = "")

    // API client for inactivity lock operations
    var apiClient by remember { mutableStateOf<SignetApiClient?>(null) }

    // Create/close API client when daemonUrl changes
    DisposableEffect(daemonUrl) {
        val client = if (daemonUrl.isNotBlank()) SignetApiClient(daemonUrl) else null
        apiClient = client
        onDispose {
            client?.close()
        }
    }

    // Dead man switch status
    var deadManSwitchStatus by remember { mutableStateOf<DeadManSwitchStatus?>(null) }

    // Keys for passphrase verification
    var keys by remember { mutableStateOf<List<KeyInfo>>(emptyList()) }

    // Apps for resume functionality
    var apps by remember { mutableStateOf<List<ConnectedApp>>(emptyList()) }

    // Fetch initial dead man switch status and keys
    LaunchedEffect(apiClient) {
        apiClient?.let { client ->
            try {
                deadManSwitchStatus = client.getDeadManSwitchStatus()
                keys = client.getKeys().keys
                apps = client.getApps().apps
            } catch (_: Exception) {
                // Ignore errors on initial fetch
            }
        }
    }

    // Subscribe to SSE events for dead man switch updates
    val eventBus = remember { EventBusRepository.getInstance() }
    LaunchedEffect(Unit) {
        eventBus.events.collect { event ->
            when (event) {
                is ServerEvent.DeadmanPanic -> {
                    deadManSwitchStatus = event.status
                    // Refresh keys to get updated lock states
                    apiClient?.let { keys = it.getKeys().keys }
                }
                is ServerEvent.DeadmanReset -> {
                    deadManSwitchStatus = event.status
                }
                is ServerEvent.DeadmanUpdated -> {
                    deadManSwitchStatus = event.status
                }
                is ServerEvent.KeyUnlocked,
                is ServerEvent.KeyLocked,
                is ServerEvent.KeyCreated,
                is ServerEvent.KeyDeleted -> {
                    // Refresh keys on key changes
                    apiClient?.let { keys = it.getKeys().keys }
                }
                is ServerEvent.AppConnected,
                is ServerEvent.AppRevoked,
                is ServerEvent.AppUpdated -> {
                    // Refresh apps on app changes
                    apiClient?.let { apps = it.getApps().apps }
                }
                else -> {}
            }
        }
    }
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    // Handle deep links by showing ConnectAppSheet directly (no navigation needed)
    var showDeepLinkSheet by remember { mutableStateOf(false) }
    var deepLinkUri by remember { mutableStateOf("") }

    // Observe pendingUri and transfer to local state when ready
    val pendingUri by DeepLinkRepository.pendingUri.collectAsState()

    // When we have a URI and client is ready, transfer to local state and show sheet
    // NOTE: Don't call clearPendingUri() here - it causes a race condition that prevents the dialog from showing
    LaunchedEffect(pendingUri, apiClient) {
        if (pendingUri != null && apiClient != null && !showDeepLinkSheet) {
            deepLinkUri = pendingUri!!
            showDeepLinkSheet = true
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = BgSecondary,
                contentColor = TextPrimary
            ) {
                Screen.bottomNavItems.forEach { screen ->
                    val selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true

                    NavigationBarItem(
                        icon = {
                            Icon(
                                imageVector = if (selected) screen.selectedIcon else screen.unselectedIcon,
                                contentDescription = screen.title
                            )
                        },
                        label = {
                            Text(
                                text = screen.title,
                                style = MaterialTheme.typography.labelSmall
                            )
                        },
                        selected = selected,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = SignetPurple,
                            selectedTextColor = SignetPurple,
                            unselectedIconColor = TextMuted,
                            unselectedTextColor = TextMuted,
                            indicatorColor = SignetPurple.copy(alpha = 0.15f)
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier.padding(innerPadding),
            enterTransition = { fadeIn(animationSpec = tween(200)) },
            exitTransition = { fadeOut(animationSpec = tween(200)) },
            popEnterTransition = { fadeIn(animationSpec = tween(200)) },
            popExitTransition = { fadeOut(animationSpec = tween(200)) }
        ) {
            composable(Screen.Home.route) {
                HomeScreen(
                    onNavigateToKeys = {
                        navController.navigate(Screen.Keys.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                saveState = true
                            }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    onNavigateToApps = {
                        navController.navigate(Screen.Apps.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                saveState = true
                            }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                )
            }
            composable(Screen.Activity.route) { ActivityScreen() }
            composable(Screen.Apps.route) { AppsScreen() }
            composable(Screen.Keys.route) { KeysScreen() }
            composable(Screen.Settings.route) {
                SettingsScreen(
                    settingsRepository = settingsRepository,
                    apiClient = apiClient,
                    keys = keys,
                    deadManSwitchStatus = deadManSwitchStatus,
                    onDeadManSwitchStatusChanged = { status ->
                        deadManSwitchStatus = status
                    },
                    onHelpClick = { navController.navigate(Screen.Help.route) }
                )
            }
            composable(Screen.Help.route) {
                HelpScreen(onBack = { navController.popBackStack() })
            }
        }

        // Inactivity Lock Screen overlay
        val isPanicked = deadManSwitchStatus?.panicTriggeredAt != null
        if (isPanicked) {
            InactivityLockScreen(
                triggeredAt = deadManSwitchStatus?.panicTriggeredAt,
                keys = keys,
                onRecover = { keyName, passphrase, resumeApps ->
                    try {
                        val client = apiClient ?: return@InactivityLockScreen Result.failure(
                            Exception("Not connected to daemon")
                        )

                        // Step 1: Unlock the key
                        val unlockResult = client.unlockKey(keyName, passphrase)
                        if (!unlockResult.ok) {
                            return@InactivityLockScreen Result.failure(
                                Exception(unlockResult.error ?: "Failed to unlock key")
                            )
                        }

                        // Step 2: Reset the dead man switch (clears panic state)
                        val resetResult = client.resetDeadManSwitch(keyName, passphrase)
                        if (!resetResult.ok) {
                            return@InactivityLockScreen Result.failure(
                                Exception(resetResult.error ?: "Failed to reset timer")
                            )
                        }

                        // Update local status
                        resetResult.status?.let { deadManSwitchStatus = it }

                        // Step 3: Resume all suspended apps if requested
                        if (resumeApps) {
                            val suspendedApps = apps.filter { it.suspendedAt != null }
                            suspendedApps.forEach { app ->
                                try {
                                    client.unsuspendApp(app.id)
                                } catch (e: Exception) {
                                    // Continue with other apps even if one fails
                                }
                            }
                            // Refresh apps list
                            apps = client.getApps().apps
                        }

                        // Refresh keys list
                        keys = client.getKeys().keys

                        Result.success(Unit)
                    } catch (e: Exception) {
                        Result.failure(e)
                    }
                }
            )
        }

    }

    // Deep link connect sheet - dedicated sheet for deep link connections
    if (showDeepLinkSheet) {
        DeepLinkConnectSheet(
            uri = deepLinkUri,
            keys = keys,
            daemonUrl = daemonUrl,
            onDismiss = {
                showDeepLinkSheet = false
                deepLinkUri = ""
                DeepLinkRepository.clearPendingUri()
            },
            onSuccess = { warning ->
                showDeepLinkSheet = false
                deepLinkUri = ""
                DeepLinkRepository.clearPendingUri()
                val message = if (warning != null) {
                    "App connected, but: $warning"
                } else {
                    "App connected successfully"
                }
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        )
    }
}
