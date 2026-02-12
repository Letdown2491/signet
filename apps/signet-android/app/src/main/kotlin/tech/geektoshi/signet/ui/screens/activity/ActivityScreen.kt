package tech.geektoshi.signet.ui.screens.activity

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Power
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.AdminActivityEntry
import tech.geektoshi.signet.data.model.PendingRequest
import tech.geektoshi.signet.data.repository.EventBusRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.BadgeStatus
import tech.geektoshi.signet.ui.components.EmptyState
import tech.geektoshi.signet.ui.components.RequestDetailSheet
import tech.geektoshi.signet.ui.components.SkeletonRequestCard
import tech.geektoshi.signet.ui.components.StatusBadge
import tech.geektoshi.signet.ui.components.pressScale
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.Info
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import tech.geektoshi.signet.util.DateGroup
import tech.geektoshi.signet.util.formatRelativeTime
import tech.geektoshi.signet.util.getDateGroup
import tech.geektoshi.signet.util.getMethodIcon
import tech.geektoshi.signet.util.getMethodLabelPastTense
import tech.geektoshi.signet.util.toDisplayString
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Sealed class to represent either a NIP-46 request or an admin event in the "All" tab
 */
sealed class ActivityItem {
    abstract val timestamp: String

    data class Request(val request: PendingRequest) : ActivityItem() {
        override val timestamp: String get() = request.createdAt
    }

    data class Admin(val entry: AdminActivityEntry) : ActivityItem() {
        override val timestamp: String get() = entry.timestamp
    }
}

/**
 * Parse ISO8601 timestamp to epoch millis for sorting
 */
private fun parseTimestamp(timestamp: String): Long {
    return try {
        Instant.parse(timestamp).toEpochMilli()
    } catch (_: Exception) {
        0L
    }
}

/**
 * Get date group for an ActivityItem
 */
private fun getActivityItemDateGroup(item: ActivityItem): DateGroup {
    return getDateGroup(item.timestamp)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen() {
    val context = LocalContext.current
    val settingsRepository = remember { SettingsRepository(context) }
    val daemonUrl by settingsRepository.daemonUrl.collectAsState(initial = "")

    var isLoading by remember { mutableStateOf(true) }
    var isRefreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var requests by remember { mutableStateOf<List<PendingRequest>>(emptyList()) }
    var adminActivity by remember { mutableStateOf<List<AdminActivityEntry>>(emptyList()) }
    var mixedActivity by remember { mutableStateOf<List<ActivityItem>>(emptyList()) }
    var selectedFilter by remember { mutableStateOf("all") }
    var selectedRequest by remember { mutableStateOf<PendingRequest?>(null) }
    val selectRequest: (PendingRequest?) -> Unit = { selectedRequest = it }
    var refreshCounter by remember { mutableIntStateOf(0) }
    val defaultTrustLevel by settingsRepository.defaultTrustLevel.collectAsState(initial = "reasonable")

    val filters = listOf("all", "approved", "denied", "expired", "admin")
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val eventBus = remember { EventBusRepository.getInstance() }

    // Connect to SSE when daemon URL is available
    LaunchedEffect(daemonUrl) {
        if (daemonUrl.isNotEmpty()) {
            eventBus.connect(daemonUrl)
        }
    }

    // Subscribe to SSE events for real-time updates
    LaunchedEffect(selectedFilter) {
        eventBus.events.collect { event ->
            when (event) {
                is ServerEvent.RequestApproved -> {
                    // If viewing 'all' or 'approved', refresh to show updated request
                    if (selectedFilter == "all" || selectedFilter == "approved") {
                        refreshCounter++
                    }
                }
                is ServerEvent.RequestDenied -> {
                    if (selectedFilter == "all" || selectedFilter == "denied") {
                        refreshCounter++
                    }
                }
                is ServerEvent.RequestExpired -> {
                    if (selectedFilter == "all" || selectedFilter == "expired") {
                        refreshCounter++
                    }
                }
                is ServerEvent.RequestAutoApproved -> {
                    if (selectedFilter == "all" || selectedFilter == "approved") {
                        refreshCounter++
                    }
                }
                is ServerEvent.AdminEvent -> {
                    if (selectedFilter == "admin" || selectedFilter == "all") {
                        refreshCounter++
                    }
                }
                is ServerEvent.Ping -> {
                    // Heartbeat - ignore
                }
                else -> {}
            }
        }
    }

    // Show bottom sheet when a request is selected
    selectedRequest?.let { request ->
        RequestDetailSheet(
            request = request,
            daemonUrl = daemonUrl,
            defaultTrustLevel = defaultTrustLevel,
            onDismiss = { selectRequest(null) },
            onActionComplete = { refreshCounter++ }
        )
    }

    LaunchedEffect(daemonUrl, selectedFilter, refreshCounter) {
        if (daemonUrl.isNotEmpty()) {
            if (!isRefreshing) isLoading = true
            error = null
            val client = SignetApiClient(daemonUrl)
            try {
                when (selectedFilter) {
                    "admin" -> {
                        // Fetch admin activity only
                        adminActivity = client.getAdminActivity(limit = 100)
                        requests = emptyList()
                        mixedActivity = emptyList()
                    }
                    "all" -> {
                        // Fetch both NIP-46 requests and admin activity, then merge
                        val nip46Requests = client.getRequests(status = "all", limit = 100, excludeAdmin = true).requests
                        val adminLogs = client.getAdminActivity(limit = 100)

                        // Merge and sort by timestamp (newest first)
                        val merged = (nip46Requests.map { ActivityItem.Request(it) } +
                                adminLogs.map { ActivityItem.Admin(it) })
                            .sortedByDescending { parseTimestamp(it.timestamp) }
                            .take(100)

                        mixedActivity = merged
                        requests = emptyList()
                        adminActivity = emptyList()
                    }
                    else -> {
                        // Fetch regular requests only (approved, denied, expired)
                        requests = client.getRequests(status = selectedFilter, limit = 100).requests
                        adminActivity = emptyList()
                        mixedActivity = emptyList()
                    }
                }
            } catch (e: Exception) {
                error = e.message ?: "Failed to connect"
            } finally {
                client.close()
                isLoading = false
                isRefreshing = false
            }
        }
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            refreshCounter++
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
        Text(
            text = "Activity",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.clickable {
                coroutineScope.launch {
                    listState.animateScrollToItem(0)
                }
            }
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Filter chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            filters.forEach { filter ->
                FilterChip(
                    selected = selectedFilter == filter,
                    onClick = { selectedFilter = filter },
                    label = {
                        Text(
                            text = filter.replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelMedium
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = SignetPurple.copy(alpha = 0.2f),
                        selectedLabelColor = SignetPurple,
                        containerColor = BgTertiary,
                        labelColor = TextSecondary
                    )
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (isLoading) {
            Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                SkeletonRequestCard()
                SkeletonRequestCard()
                SkeletonRequestCard()
                SkeletonRequestCard()
                SkeletonRequestCard()
            }
        } else if (error != null) {
            Box(
                modifier = Modifier.fillMaxSize(),
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
                        color = TextSecondary
                    )
                }
            }
        } else if (selectedFilter == "admin") {
            // Admin activity tab
            if (adminActivity.isEmpty()) {
                EmptyState(
                    icon = Icons.Outlined.AdminPanelSettings,
                    message = "No admin activity"
                )
            } else {
                // Group admin activity by date
                val groupedActivity = adminActivity.groupBy { getDateGroup(it.timestamp) }
                val orderedGroups = listOf(DateGroup.TODAY, DateGroup.YESTERDAY, DateGroup.THIS_WEEK, DateGroup.OLDER)

                LazyColumn(
                    state = listState,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    orderedGroups.forEach { group ->
                        val groupActivity = groupedActivity[group] ?: emptyList()
                        if (groupActivity.isNotEmpty()) {
                            item {
                                Text(
                                    text = group.toDisplayString(),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = TextMuted,
                                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                                )
                            }
                            items(groupActivity, key = { it.id }) { activity ->
                                AdminActivityCard(activity = activity)
                            }
                        }
                    }
                }
            }
        } else if (selectedFilter == "all") {
            // All activity tab - mixed NIP-46 requests and admin events
            if (mixedActivity.isEmpty()) {
                EmptyState(
                    icon = Icons.Outlined.Inbox,
                    message = "No activity"
                )
            } else {
                // Group mixed activity by date
                val groupedActivity = mixedActivity.groupBy { getActivityItemDateGroup(it) }
                val orderedGroups = listOf(DateGroup.TODAY, DateGroup.YESTERDAY, DateGroup.THIS_WEEK, DateGroup.OLDER)

                LazyColumn(
                    state = listState,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    orderedGroups.forEach { group ->
                        val groupItems = groupedActivity[group] ?: emptyList()
                        if (groupItems.isNotEmpty()) {
                            item {
                                Text(
                                    text = group.toDisplayString(),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = TextMuted,
                                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                                )
                            }
                            items(
                                groupItems,
                                key = { item ->
                                    when (item) {
                                        is ActivityItem.Request -> "req-${item.request.id}"
                                        is ActivityItem.Admin -> "admin-${item.entry.id}"
                                    }
                                }
                            ) { item ->
                                when (item) {
                                    is ActivityItem.Request -> RequestCard(
                                        request = item.request,
                                        onClick = { selectRequest(item.request) }
                                    )
                                    is ActivityItem.Admin -> AdminActivityCard(activity = item.entry)
                                }
                            }
                        }
                    }
                }
            }
        } else if (requests.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Inbox,
                message = "No $selectedFilter requests"
            )
        } else {
            // Approved/Denied/Expired tabs - NIP-46 requests only
            val groupedRequests = requests.groupBy { getDateGroup(it.createdAt) }
            val orderedGroups = listOf(DateGroup.TODAY, DateGroup.YESTERDAY, DateGroup.THIS_WEEK, DateGroup.OLDER)

            LazyColumn(
                state = listState,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                orderedGroups.forEach { group ->
                    val groupRequests = groupedRequests[group] ?: emptyList()
                    if (groupRequests.isNotEmpty()) {
                        item {
                            Text(
                                text = group.toDisplayString(),
                                style = MaterialTheme.typography.labelMedium,
                                color = TextMuted,
                                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                            )
                        }
                        items(groupRequests, key = { it.id }) { request ->
                            RequestCard(
                                request = request,
                                onClick = { selectRequest(request) }
                            )
                        }
                    }
                }
            }
        }
        }
    }
}

@Composable
private fun RequestCard(
    request: PendingRequest,
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
            // Header: App name + Status badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = request.appName ?: (request.remotePubkey.take(12) + "..."),
                    style = MaterialTheme.typography.titleSmall,
                    color = TextPrimary
                )
                StatusBadge(
                    status = when {
                        request.processedAt == null -> BadgeStatus.PENDING
                        request.allowed == false -> BadgeStatus.DENIED
                        request.allowed == true && request.approvalType == "manual" -> BadgeStatus.APPROVED
                        request.allowed == true && request.approvalType == "auto_trust" -> BadgeStatus.AUTO_TRUST
                        request.allowed == true && request.approvalType == "auto_permission" -> BadgeStatus.AUTO_PERMISSION
                        request.allowed == true && request.autoApproved -> BadgeStatus.AUTO_APPROVED  // Backwards compat
                        request.allowed == true -> BadgeStatus.APPROVED
                        else -> BadgeStatus.EXPIRED
                    }
                )
            }

            // Method icon + label
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    imageVector = getMethodIcon(request.method),
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = SignetPurple
                )
                Text(
                    text = getMethodLabelPastTense(request.method, request.eventPreview?.kind),
                    style = MaterialTheme.typography.bodySmall,
                    color = SignetPurple
                )
            }

            // Timestamp + Key name
            Text(
                text = "${formatRelativeTime(request.createdAt)} • ${request.keyName ?: "Unknown key"}",
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted
            )
        }
    }
}

@Composable
private fun AdminActivityCard(activity: AdminActivityEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = BgSecondary)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Header: Entity name + Admin badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = when (activity.eventType) {
                        "daemon_started" -> activity.clientVersion?.let { "v$it" } ?: "Signet"
                        "status_checked" -> "System status"
                        "command_executed" -> activity.command ?: "Unknown command"
                        "auth_failed" -> "Authentication"
                        "panic_triggered" -> "All keys locked"
                        "deadman_reset" -> "Timer"
                        else -> activity.keyName ?: activity.appName ?: "Unknown"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    color = TextPrimary
                )
                StatusBadge(status = BadgeStatus.ADMIN)
            }

            // Event icon + label
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    imageVector = getAdminEventIcon(activity.eventType),
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = Info
                )
                Text(
                    text = getAdminEventLabel(activity.eventType),
                    style = MaterialTheme.typography.bodySmall,
                    color = Info
                )
            }

            // Timestamp + optional client/IP info
            val details = buildList {
                add(formatRelativeTime(activity.timestamp))
                activity.clientName?.let { add(it) }
                activity.ipAddress?.let { add(it) }
            }.joinToString(" • ")

            Text(
                text = details,
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted
            )
        }
    }
}

// Helper function to get icon for admin event types
private fun getAdminEventIcon(eventType: String): ImageVector {
    return when (eventType) {
        "key_locked" -> Icons.Outlined.Lock
        "key_unlocked" -> Icons.Outlined.LockOpen
        "key_encrypted" -> Icons.Outlined.Lock
        "key_migrated" -> Icons.Outlined.Key
        "key_exported" -> Icons.Outlined.FileDownload
        "auth_failed" -> Icons.Outlined.Warning
        "app_connected" -> Icons.Outlined.Link
        "app_suspended" -> Icons.Outlined.Pause
        "app_unsuspended" -> Icons.Outlined.PlayArrow
        "daemon_started" -> Icons.Outlined.Power
        "status_checked" -> Icons.Outlined.Search
        "command_executed" -> Icons.Outlined.Build
        "panic_triggered" -> Icons.Outlined.Warning
        "deadman_reset" -> Icons.Outlined.Timer
        else -> Icons.Outlined.Info
    }
}

// Helper function to get label for admin event types
private fun getAdminEventLabel(eventType: String): String {
    return when (eventType) {
        "key_locked" -> "Key locked"
        "key_unlocked" -> "Key unlocked"
        "key_encrypted" -> "Key encrypted"
        "key_migrated" -> "Encryption migrated"
        "key_exported" -> "Key exported"
        "auth_failed" -> "Auth failed"
        "app_connected" -> "App connected"
        "app_suspended" -> "App suspended"
        "app_unsuspended" -> "App resumed"
        "daemon_started" -> "Daemon started"
        "status_checked" -> "Status checked"
        "command_executed" -> "Command executed"
        "panic_triggered" -> "Panic triggered"
        "deadman_reset" -> "Inactivity timer reset"
        else -> eventType
    }
}

