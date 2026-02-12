@file:Suppress("RedundantAssignment")

package tech.geektoshi.signet.ui.components

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.model.DeadManSwitchStatus
import tech.geektoshi.signet.data.model.HealthStatus
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.data.model.RelaysResponse
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.Success
import tech.geektoshi.signet.ui.theme.Teal
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import tech.geektoshi.signet.ui.theme.Warning
import tech.geektoshi.signet.util.formatRelativeTime
import tech.geektoshi.signet.util.formatUptime

enum class UIHealthStatus {
    HEALTHY, DEGRADED, OFFLINE
}

fun HealthStatus?.toUIStatus(): UIHealthStatus = when {
    this == null -> UIHealthStatus.OFFLINE
    this.status == "degraded" -> UIHealthStatus.DEGRADED
    else -> UIHealthStatus.HEALTHY
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SystemStatusSheet(
    health: HealthStatus?,
    relays: RelaysResponse?,
    uiStatus: UIHealthStatus,
    deadManSwitchStatus: DeadManSwitchStatus? = null,
    keys: List<KeyInfo> = emptyList(),
    onReset: (suspend (keyName: String, passphrase: String) -> Result<Unit>)? = null,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var relaysExpanded by remember { mutableStateOf(false) }

    // Reset dialog state
    var showResetDialog by remember { mutableStateOf(false) }
    var resetPassphrase by remember { mutableStateOf("") }
    var resetError by remember { mutableStateOf<String?>(null) }
    var isResetting by remember { mutableStateOf(false) }

    // Get encrypted keys for passphrase verification
    val encryptedKeys = remember(keys) { keys.filter { it.isEncrypted } }

    // Reset Inactivity Lock confirmation dialog
    if (showResetDialog && onReset != null) {
        val firstEncryptedKey = encryptedKeys.firstOrNull()

        AlertDialog(
            onDismissRequest = {
                if (!isResetting) {
                    showResetDialog = false
                    resetPassphrase = ""
                    resetError = null
                }
            },
            title = {
                Text(
                    text = "Reset Inactivity Lock",
                    color = TextPrimary
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Enter your key passphrase to reset the timer.",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium
                    )

                    if (firstEncryptedKey != null) {
                        Text(
                            text = "Using key: ${firstEncryptedKey.name}",
                            color = TextMuted,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    OutlinedTextField(
                        value = resetPassphrase,
                        onValueChange = {
                            resetPassphrase = it
                            resetError = null
                        },
                        label = { Text("Passphrase") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = resetError != null,
                        supportingText = resetError?.let { { Text(it, color = Danger) } },
                        enabled = !isResetting,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = SignetPurple,
                            unfocusedBorderColor = BorderDefault,
                            focusedLabelColor = SignetPurple,
                            unfocusedLabelColor = TextMuted,
                            cursorColor = SignetPurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (firstEncryptedKey == null || resetPassphrase.isBlank()) return@Button

                        scope.launch {
                            isResetting = true
                            resetError = null

                            val result = onReset(firstEncryptedKey.name, resetPassphrase)

                            result.fold(
                                onSuccess = {
                                    showResetDialog = false
                                    resetPassphrase = ""
                                    Toast.makeText(context, "Timer reset", Toast.LENGTH_SHORT).show()
                                    onDismiss()
                                },
                                onFailure = { e ->
                                    resetError = e.message ?: "Failed to reset timer"
                                }
                            )

                            isResetting = false
                        }
                    },
                    enabled = !isResetting && resetPassphrase.isNotBlank() && firstEncryptedKey != null,
                    colors = ButtonDefaults.buttonColors(containerColor = SignetPurple)
                ) {
                    if (isResetting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = TextPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Reset Timer")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showResetDialog = false
                        resetPassphrase = ""
                        resetError = null
                    },
                    enabled = !isResetting
                ) {
                    Text("Cancel", color = TextMuted)
                }
            },
            containerColor = BgSecondary
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = BgTertiary
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            Text(
                text = "System Status",
                style = MaterialTheme.typography.headlineSmall,
                color = TextPrimary
            )

            // Status Badge
            StatusPill(uiStatus = uiStatus)

            if (health != null) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                // Stats Grid
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        StatItem(
                            label = "Uptime",
                            value = formatUptime(health.uptime),
                            modifier = Modifier.weight(1f)
                        )
                        StatItem(
                            label = "Memory",
                            value = "${health.memory.rssMB.toInt()} MB",
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        StatItem(
                            label = "Active Listeners",
                            value = health.subscriptions.toString(),
                            modifier = Modifier.weight(1f)
                        )
                        StatItem(
                            label = "Connected Clients",
                            value = health.sseClients.toString(),
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        StatItem(
                            label = "Last Reset",
                            value = health.lastPoolReset?.let { formatRelativeTime(it) } ?: "Never",
                            modifier = Modifier.weight(1f)
                        )
                        StatItem(
                            label = "Keys",
                            value = buildString {
                                append("${health.keys.active} active")
                                if (health.keys.locked > 0) append(", ${health.keys.locked} locked")
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                // Expandable Relay Section
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { relaysExpanded = !relaysExpanded },
                    color = BgSecondary,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Relays (${health.relays.connected}/${health.relays.total} connected)",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                        Icon(
                            imageVector = if (relaysExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            contentDescription = if (relaysExpanded) "Collapse" else "Expand",
                            tint = TextSecondary
                        )
                    }
                }

                AnimatedVisibility(visible = relaysExpanded && relays != null) {
                    Column(
                        modifier = Modifier.padding(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        relays?.relays?.forEach { relay ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = relay.url,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = TextPrimary
                                    )
                                    val statusText = if (relay.connected) {
                                        relay.lastConnected?.let { "Connected ${formatRelativeTime(it)}" } ?: "Connected"
                                    } else {
                                        relay.lastDisconnected?.let { "Disconnected ${formatRelativeTime(it)}" } ?: "Disconnected"
                                    }
                                    Text(
                                        text = statusText,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted
                                    )
                                }
                                if (relay.connected) {
                                    TrustScoreBadge(score = relay.trustScore)
                                } else {
                                    Icon(
                                        imageVector = Icons.Default.Error,
                                        contentDescription = "Disconnected",
                                        modifier = Modifier.size(20.dp),
                                        tint = Danger
                                    )
                                }
                            }
                        }
                    }
                }

                // Inactivity Lock Section (only show when enabled and callback available)
                if (deadManSwitchStatus?.enabled == true && onReset != null && encryptedKeys.isNotEmpty()) {
                    val isPanicked = deadManSwitchStatus.panicTriggeredAt != null

                    HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = BgSecondary,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = if (isPanicked) Icons.Outlined.Lock else Icons.Outlined.Timer,
                                    contentDescription = null,
                                    tint = if (isPanicked) Danger else TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                                Column {
                                    Text(
                                        text = "Inactivity Lock",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = TextPrimary
                                    )
                                    Text(
                                        text = if (isPanicked) "LOCKED" else {
                                            deadManSwitchStatus.remainingSec?.let { formatDuration(it) } ?: "Active"
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (isPanicked) Danger else TextMuted
                                    )
                                }
                            }

                            if (!isPanicked) {
                                TextButton(
                                    onClick = { showResetDialog = true }
                                ) {
                                    Text("Reset", color = SignetPurple)
                                }
                            }
                        }
                    }
                }
            } else {
                // Offline message
                Text(
                    text = "Unable to connect to daemon",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun StatusPill(uiStatus: UIHealthStatus) {
    val (text, color) = when (uiStatus) {
        UIHealthStatus.HEALTHY -> "Healthy" to Success
        UIHealthStatus.DEGRADED -> "Degraded" to Warning
        UIHealthStatus.OFFLINE -> "Offline" to Danger
    }

    Surface(
        color = color.copy(alpha = 0.15f),
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(8.dp),
                color = color,
                shape = RoundedCornerShape(4.dp)
            ) {}
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = color
            )
        }
    }
}

@Composable
private fun StatItem(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = TextPrimary
        )
    }
}

/**
 * Trust score badge with color based on score thresholds
 */
@Composable
private fun TrustScoreBadge(score: Int?) {
    val (text, color) = when {
        score == null -> "?" to TextMuted
        score >= 80 -> score.toString() to Success
        score >= 60 -> score.toString() to Teal
        score >= 40 -> score.toString() to Warning
        else -> score.toString() to Danger
    }

    Surface(
        color = color.copy(alpha = 0.2f),
        shape = RoundedCornerShape(4.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            color = color
        )
    }
}

/**
 * Format seconds to human-readable duration
 */
private fun formatDuration(seconds: Int): String {
    val days = seconds / 86400
    val hours = (seconds % 86400) / 3600
    val minutes = (seconds % 3600) / 60

    return when {
        days > 0 -> "${days}d ${hours}h"
        hours > 0 -> "${hours}h ${minutes}m"
        minutes > 0 -> "${minutes}m"
        else -> "${seconds}s"
    }
}
