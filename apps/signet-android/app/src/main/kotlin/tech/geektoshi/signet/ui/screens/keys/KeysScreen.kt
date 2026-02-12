package tech.geektoshi.signet.ui.screens.keys

import android.widget.Toast
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
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.data.repository.EventBusRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.CreateKeySheet
import tech.geektoshi.signet.ui.components.EmptyState
import tech.geektoshi.signet.ui.components.KeyDetailSheet
import tech.geektoshi.signet.ui.components.SkeletonKeyCard
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
fun KeysScreen() {
    val context = LocalContext.current
    val settingsRepository = remember { SettingsRepository(context) }
    val daemonUrl by settingsRepository.daemonUrl.collectAsState(initial = "")
    val scope = rememberCoroutineScope()

    var isLoading by remember { mutableStateOf(true) }
    var isRefreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var keys by remember { mutableStateOf<List<KeyInfo>>(emptyList()) }
    var selectedKey by remember { mutableStateOf<KeyInfo?>(null) }
    var showCreateKey by remember { mutableStateOf(false) }
    var showLockAllConfirm by remember { mutableStateOf(false) }
    var isLockingAll by remember { mutableStateOf(false) }
    var refreshCounter by remember { mutableIntStateOf(0) }
    val eventBus = remember { EventBusRepository.getInstance() }

    // Count lockable keys (online + encrypted)
    val lockableKeysCount = keys.count { it.status == "online" && it.isEncrypted }

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
                is ServerEvent.KeyCreated,
                is ServerEvent.KeyUnlocked,
                is ServerEvent.KeyDeleted,
                is ServerEvent.KeyRenamed,
                is ServerEvent.KeyUpdated -> {
                    // Refresh list on any key change
                    refreshCounter++
                }
                else -> {}
            }
        }
    }

    // Show create key sheet
    if (showCreateKey) {
        CreateKeySheet(
            daemonUrl = daemonUrl,
            onDismiss = { showCreateKey = false },
            onKeyCreated = { refreshCounter++ }
        )
    }

    // Lock All confirmation dialog
    if (showLockAllConfirm) {
        AlertDialog(
            onDismissRequest = { showLockAllConfirm = false },
            title = { Text("Lock All Keys") },
            text = {
                Text("Lock all $lockableKeysCount unlocked key${if (lockableKeysCount != 1) "s" else ""}? They will need to be unlocked with their passphrases to sign again.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLockAllConfirm = false
                        scope.launch {
                            isLockingAll = true
                            try {
                                val client = SignetApiClient(daemonUrl)
                                val result = client.lockAllKeys()
                                client.close()
                                if (result.ok) {
                                    Toast.makeText(
                                        context,
                                        "Locked ${result.lockedCount} key${if (result.lockedCount != 1) "s" else ""}",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                    refreshCounter++
                                } else {
                                    Toast.makeText(
                                        context,
                                        result.error ?: "Failed to lock keys",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            } catch (e: Exception) {
                                Toast.makeText(
                                    context,
                                    e.message ?: "Failed to lock keys",
                                    Toast.LENGTH_SHORT
                                ).show()
                            } finally {
                                isLockingAll = false
                            }
                        }
                    }
                ) {
                    Text("Lock All", color = Warning)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLockAllConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Show bottom sheet when a key is selected
    selectedKey?.let { key ->
        KeyDetailSheet(
            key = key,
            daemonUrl = daemonUrl,
            onDismiss = { selectedKey = null },
            onActionComplete = { refreshCounter++ }
        )
    }

    LaunchedEffect(daemonUrl, refreshCounter) {
        if (daemonUrl.isNotEmpty()) {
            if (!isRefreshing) isLoading = true
            error = null
            val client = SignetApiClient(daemonUrl)
            try {
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

    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Keys",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Spacer(modifier = Modifier.height(8.dp))
                SkeletonKeyCard()
                SkeletonKeyCard()
                SkeletonKeyCard()
            }
            return@Box
        }

        if (error != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
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
            return@Box
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
                            text = "Keys",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Lock All button
                            IconButton(
                                onClick = { showLockAllConfirm = true },
                                enabled = lockableKeysCount > 0 && !isLockingAll
                            ) {
                                if (isLockingAll) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        strokeWidth = 2.dp,
                                        color = SignetPurple
                                    )
                                } else {
                                    Icon(
                                        imageVector = Icons.Outlined.Lock,
                                        contentDescription = "Lock All Keys",
                                        tint = if (lockableKeysCount > 0) SignetPurple else TextMuted
                                    )
                                }
                            }
                            // Create Key button
                            IconButton(
                                onClick = { showCreateKey = true }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Add,
                                    contentDescription = "Create Key",
                                    tint = SignetPurple
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                if (keys.isEmpty()) {
                    item {
                        EmptyState(
                            icon = Icons.Outlined.Key,
                            message = "No keys configured",
                            subtitle = "Tap + to create a new key"
                        )
                    }
                } else {
                    items(keys, key = { it.name }) { key ->
                        KeyCard(
                            key = key,
                            onClick = { selectedKey = key }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun KeyCard(
    key: KeyInfo,
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
            // Header: Status dot + Key name + Encryption badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Status dot: green = online, orange = locked, gray = offline
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(
                                color = when (key.status.lowercase()) {
                                    "online" -> Success
                                    "locked" -> Warning
                                    else -> TextMuted
                                },
                                shape = CircleShape
                            )
                    )
                    Text(
                        text = key.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = TextPrimary
                    )
                }
                EncryptionBadge(isEncrypted = key.isEncrypted)
            }

            // Truncated npub
            key.npub?.let { npub ->
                Text(
                    text = "${npub.take(12)}...${npub.takeLast(4)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
            }

            // Summary: apps • requests • relative time
            val lastUsed = key.lastUsedAt?.let { formatRelativeTime(it) }
            Text(
                text = listOfNotNull(
                    "${key.userCount} apps",
                    "${key.requestCount} requests",
                    lastUsed
                ).joinToString(" • "),
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted
            )
        }
    }
}

@Composable
private fun EncryptionBadge(isEncrypted: Boolean) {
    val (color, label) = if (isEncrypted) {
        Success to "Encrypted"
    } else {
        Warning to "Unprotected"
    }

    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = color
    )
}

