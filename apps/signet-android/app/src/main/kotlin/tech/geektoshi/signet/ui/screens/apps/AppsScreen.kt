package tech.geektoshi.signet.ui.screens.apps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.ConnectedApp
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.data.repository.EventBusRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.AppDetailSheet
import tech.geektoshi.signet.ui.components.ConnectAppSheet
import tech.geektoshi.signet.ui.components.EmptyState
import tech.geektoshi.signet.ui.components.QRScannerSheet
import tech.geektoshi.signet.ui.components.SkeletonAppCard
import tech.geektoshi.signet.ui.components.SuspendAllAppsSheet
import tech.geektoshi.signet.ui.components.pressScale
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.Success
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.Warning
import tech.geektoshi.signet.util.formatRelativeTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen() {
    val context = LocalContext.current
    val settingsRepository = remember { SettingsRepository(context) }
    val daemonUrl by settingsRepository.daemonUrl.collectAsState(initial = "")
    val scope = rememberCoroutineScope()

    var isLoading by remember { mutableStateOf(true) }
    var isRefreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var apps by remember { mutableStateOf<List<ConnectedApp>>(emptyList()) }
    var keys by remember { mutableStateOf<List<KeyInfo>>(emptyList()) }
    var selectedApp by remember { mutableStateOf<ConnectedApp?>(null) }
    var showConnectSheet by remember { mutableStateOf(false) }
    var showQRScanner by remember { mutableStateOf(false) }
    var showSuspendAllSheet by remember { mutableStateOf(false) }
    var isResumingAll by remember { mutableStateOf(false) }
    var scannedUri by remember { mutableStateOf("") }
    var refreshCounter by remember { mutableIntStateOf(0) }
    val eventBus = remember { EventBusRepository.getInstance() }

    // Calculate app states for the toggle button
    val activeAppsCount = apps.count { it.suspendedAt == null }
    val suspendedAppsCount = apps.count { it.suspendedAt != null }
    val allSuspended = apps.isNotEmpty() && activeAppsCount == 0

    // Connect to SSE when daemon URL is available
    LaunchedEffect(daemonUrl) {
        if (daemonUrl.isNotEmpty()) {
            eventBus.connect(daemonUrl)
        }
    }

    // Subscribe to SSE events for real-time updates
    LaunchedEffect(Unit) {
        eventBus.events.collect { event ->
            when (event) {
                is ServerEvent.AppConnected -> {
                    // New app connected, refresh list
                    refreshCounter++
                }
                is ServerEvent.AppRevoked -> {
                    // App revoked, remove from list
                    apps = apps.filter { it.id != event.appId }
                }
                is ServerEvent.AppUpdated -> {
                    // App updated (trust level or description changed), refresh list
                    refreshCounter++
                }
                // Key state changes - refresh to update available keys for ConnectAppSheet
                is ServerEvent.KeyCreated,
                is ServerEvent.KeyUnlocked,
                is ServerEvent.KeyLocked,
                is ServerEvent.KeyDeleted -> {
                    refreshCounter++
                }
                else -> {}
            }
        }
    }

    // Show bottom sheet when an app is selected
    selectedApp?.let { app ->
        AppDetailSheet(
            app = app,
            daemonUrl = daemonUrl,
            onDismiss = { selectedApp = null; Unit },
            onActionComplete = { refreshCounter++ }
        )
    }

    LaunchedEffect(daemonUrl, refreshCounter) {
        if (daemonUrl.isNotEmpty()) {
            if (!isRefreshing) isLoading = true
            error = null
            val client = SignetApiClient(daemonUrl)
            try {
                apps = client.getApps().apps
                keys = client.getKeys().keys
            } catch (e: Exception) {
                error = e.message ?: "Failed to connect"
            } finally {
                client.close()
                isLoading = false
                isRefreshing = false
            }
        }
    }

    // Connect App Sheet
    if (showConnectSheet) {
        ConnectAppSheet(
            keys = keys,
            daemonUrl = daemonUrl,
            initialUri = scannedUri,
            onDismiss = {
                showConnectSheet = false
                scannedUri = ""
            },
            onSuccess = { warning ->
                refreshCounter++
                val message = if (warning != null) {
                    "App connected, but: $warning"
                } else {
                    "App connected successfully"
                }
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            },
            onScanQR = {
                showConnectSheet = false
                showQRScanner = true
            }
        )
    }

    // QR Scanner Sheet
    if (showQRScanner) {
        QRScannerSheet(
            onScanned = { uri ->
                if (uri.startsWith("nostrconnect://")) {
                    scannedUri = uri
                    showQRScanner = false
                    showConnectSheet = true
                }
            },
            onDismiss = {
                showQRScanner = false
                showConnectSheet = true
            }
        )
    }

    // Suspend All Apps Sheet
    if (showSuspendAllSheet) {
        SuspendAllAppsSheet(
            appCount = activeAppsCount,
            daemonUrl = daemonUrl,
            onDismiss = { showSuspendAllSheet = false },
            onSuccess = { suspendedCount ->
                Toast.makeText(
                    context,
                    "Suspended $suspendedCount app${if (suspendedCount != 1) "s" else ""}",
                    Toast.LENGTH_SHORT
                ).show()
                refreshCounter++
            }
        )
    }

    if (isLoading) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Apps",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground
            )
            Spacer(modifier = Modifier.height(8.dp))
            SkeletonAppCard()
            SkeletonAppCard()
            SkeletonAppCard()
        }
        return
    }

    if (error != null) {
        Box(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "Connection Error",
                    style = MaterialTheme.typography.titleLarge,
                    color = Danger
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = error ?: "Unknown error",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted
                )
            }
        }
        return
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            refreshCounter++
        }
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Connected Apps",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Suspend/Resume toggle button
                        IconButton(
                            onClick = {
                                if (allSuspended) {
                                    // Resume all apps
                                    scope.launch {
                                        isResumingAll = true
                                        try {
                                            val client = SignetApiClient(daemonUrl)
                                            val result = client.resumeAllApps()
                                            client.close()
                                            if (result.ok) {
                                                Toast.makeText(
                                                    context,
                                                    "Resumed ${result.resumedCount} app${if (result.resumedCount != 1) "s" else ""}",
                                                    Toast.LENGTH_SHORT
                                                ).show()
                                                refreshCounter++
                                            } else {
                                                Toast.makeText(
                                                    context,
                                                    result.error ?: "Failed to resume apps",
                                                    Toast.LENGTH_SHORT
                                                ).show()
                                            }
                                        } catch (e: Exception) {
                                            Toast.makeText(
                                                context,
                                                e.message ?: "Failed to resume apps",
                                                Toast.LENGTH_SHORT
                                            ).show()
                                        } finally {
                                            isResumingAll = false
                                        }
                                    }
                                } else {
                                    // Show suspend sheet
                                    showSuspendAllSheet = true
                                }
                            },
                            enabled = apps.isNotEmpty() && !isResumingAll
                        ) {
                            if (isResumingAll) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = SignetPurple
                                )
                            } else {
                                Icon(
                                    imageVector = if (allSuspended) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                                    contentDescription = if (allSuspended) "Resume All Apps" else "Suspend All Apps",
                                    tint = if (apps.isNotEmpty()) SignetPurple else TextMuted
                                )
                            }
                        }
                        // Connect App button
                        IconButton(
                            onClick = { showConnectSheet = true }
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Add,
                                contentDescription = "Connect App",
                                tint = SignetPurple
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
            }

            if (apps.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Outlined.Apps,
                        message = "No connected apps",
                        subtitle = "Tap + for NostrConnect, or share your key's bunker URI with an app"
                    )
                }
            } else {
                items(apps, key = { it.id }) { app ->
                    AppCard(
                        app = app,
                        onClick = { selectedApp = app; Unit }
                    )
                }
            }
        }
    }
}

@Composable
private fun AppCard(
    app: ConnectedApp,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = BgSecondary)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Header: Status dot + App name + Trust level
            val isSuspended = app.suspendedAt != null
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Status dot: green = active, gray = suspended
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(
                                color = if (isSuspended) TextMuted else Success,
                                shape = CircleShape
                            )
                    )
                    Text(
                        text = app.description ?: (app.userPubkey.take(12) + "..."),
                        style = MaterialTheme.typography.titleSmall,
                        color = if (isSuspended) TextMuted else TextPrimary
                    )
                }
                TrustLevelBadge(trustLevel = app.trustLevel)
            }

            // Key name • Request count • Last used
            val lastUsed = app.lastUsedAt?.let { formatRelativeTime(it) }
            Text(
                text = listOfNotNull(
                    app.keyName,
                    "${app.requestCount} requests",
                    lastUsed
                ).joinToString(" • "),
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted
            )
        }
    }
}

@Composable
private fun TrustLevelBadge(trustLevel: String) {
    val (color, label, icon) = when (trustLevel.lowercase()) {
        "full" -> Triple(Success, "Full", Icons.Outlined.Security)
        "reasonable" -> Triple(SignetPurple, "Reasonable", Icons.Outlined.Shield)
        "paranoid" -> Triple(Warning, "Paranoid", Icons.Outlined.Shield)
        else -> Triple(TextMuted, trustLevel, Icons.Outlined.Shield)
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier.height(14.dp)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}

