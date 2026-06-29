package tech.geektoshi.signet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.ConnectedApp
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.Success
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.Warning
import tech.geektoshi.signet.util.formatRelativeTime
import tech.geektoshi.signet.util.formatFutureTime
import tech.geektoshi.signet.util.TrustLevels
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppDetailSheet(
    app: ConnectedApp,
    daemonUrl: String,
    onDismiss: () -> Unit,
    onActionComplete: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var appName by remember { mutableStateOf(app.description ?: "") }
    var selectedTrustLevel by remember { mutableStateOf(app.trustLevel) }
    var showRevokeConfirm by remember { mutableStateOf(false) }
    var showSuspendDialog by remember { mutableStateOf(false) }
    var suspendType by remember { mutableStateOf("indefinite") }
    var suspendDate by remember { mutableStateOf(LocalDate.now().plusDays(1)) }
    var suspendTime by remember { mutableStateOf(LocalTime.of(12, 0)) }

    val hasChanges = appName != (app.description ?: "") || selectedTrustLevel != app.trustLevel

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
            // Header: App name + badges
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = app.description ?: "Unknown App",
                    style = MaterialTheme.typography.headlineSmall,
                    color = TextPrimary
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (app.suspendedAt != null) {
                        SuspendedBadge(suspendUntil = app.suspendUntil)
                    }
                    TrustLevelBadge(trustLevel = app.trustLevel)
                }
            }

            // Summary: key • requests • last used
            val lastUsed = app.lastUsedAt?.let { formatRelativeTime(it) }
            Text(
                text = listOfNotNull(
                    app.keyName,
                    "${app.requestCount} requests",
                    lastUsed
                ).joinToString(" • "),
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Edit App Name
            Text(
                text = "App Name",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )

            OutlinedTextField(
                value = appName,
                onValueChange = { appName = it },
                placeholder = { Text("Enter a name for this app") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = SignetPurple,
                    unfocusedBorderColor = BorderDefault,
                    cursorColor = SignetPurple,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedPlaceholderColor = TextMuted,
                    unfocusedPlaceholderColor = TextMuted,
                    focusedContainerColor = BgTertiary,
                    unfocusedContainerColor = BgTertiary
                )
            )

            // Trust Level
            Text(
                text = "Trust Level",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )

            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TrustLevels.ORDER.forEach { level ->
                    TrustLevelOption(
                        label = TrustLevels.label(level),
                        description = TrustLevels.description(level),
                        selected = selectedTrustLevel == level,
                        onClick = { selectedTrustLevel = level }
                    )
                }
            }

            // Error message
            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger
                )
            }

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Action buttons
            if (showRevokeConfirm) {
                Text(
                    text = "Are you sure you want to revoke this app's access?",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextPrimary
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = { showRevokeConfirm = false },
                        enabled = !isLoading,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Cancel")
                    }

                    Button(
                        onClick = {
                            scope.launch {
                                isLoading = true
                                error = null
                                try {
                                    val client = SignetApiClient(daemonUrl)
                                    val result = client.revokeApp(app.id)
                                    client.close()
                                    if (result.ok) {
                                        onActionComplete()
                                        onDismiss()
                                    } else {
                                        error = result.error ?: "Failed to revoke"
                                    }
                                } catch (e: Exception) {
                                    error = e.message ?: "Failed to revoke"
                                } finally {
                                    isLoading = false
                                }
                            }
                        },
                        enabled = !isLoading,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Danger,
                            contentColor = TextPrimary
                        )
                    ) {
                        Text("Revoke")
                    }
                }
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Suspend/Resume button
                    val isSuspended = app.suspendedAt != null
                    if (isSuspended) {
                        Button(
                            onClick = {
                                scope.launch {
                                    isLoading = true
                                    error = null
                                    try {
                                        val client = SignetApiClient(daemonUrl)
                                        val result = client.unsuspendApp(app.id)
                                        client.close()
                                        if (result.ok) {
                                            onActionComplete()
                                            onDismiss()
                                        } else {
                                            error = result.error ?: "Failed to resume"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to resume"
                                    } finally {
                                        isLoading = false
                                    }
                                }
                            },
                            enabled = !isLoading,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Success,
                                contentColor = TextPrimary
                            )
                        ) {
                            Text("Resume App")
                        }
                    } else if (showSuspendDialog) {
                        // Suspend dialog content
                        Text(
                            text = "Suspend Duration",
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary
                        )

                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // Indefinite option
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(
                                        width = 1.dp,
                                        color = if (suspendType == "indefinite") SignetPurple else BorderDefault,
                                        shape = RoundedCornerShape(8.dp)
                                    )
                                    .background(if (suspendType == "indefinite") SignetPurple.copy(alpha = 0.1f) else BgTertiary)
                                    .clickable { suspendType = "indefinite" }
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(20.dp)
                                        .border(2.dp, if (suspendType == "indefinite") SignetPurple else TextMuted, CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (suspendType == "indefinite") {
                                        Box(modifier = Modifier.size(10.dp).background(SignetPurple, CircleShape))
                                    }
                                }
                                Text("Until I turn it back on", color = TextPrimary)
                            }

                            // Timed option
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(
                                        width = 1.dp,
                                        color = if (suspendType == "until") SignetPurple else BorderDefault,
                                        shape = RoundedCornerShape(8.dp)
                                    )
                                    .background(if (suspendType == "until") SignetPurple.copy(alpha = 0.1f) else BgTertiary)
                                    .clickable { suspendType = "until" }
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(20.dp)
                                        .border(2.dp, if (suspendType == "until") SignetPurple else TextMuted, CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (suspendType == "until") {
                                        Box(modifier = Modifier.size(10.dp).background(SignetPurple, CircleShape))
                                    }
                                }
                                Text("Until a specific date and time", color = TextPrimary)
                            }
                        }

                        // Date/time inputs when timed option selected
                        if (suspendType == "until") {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                OutlinedTextField(
                                    value = suspendDate.format(DateTimeFormatter.ofPattern("MMM d, yyyy")),
                                    onValueChange = { },
                                    readOnly = true,
                                    label = { Text("Date") },
                                    modifier = Modifier.weight(1f),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = SignetPurple,
                                        unfocusedBorderColor = BorderDefault,
                                        focusedTextColor = TextPrimary,
                                        unfocusedTextColor = TextPrimary,
                                        focusedLabelColor = SignetPurple,
                                        unfocusedLabelColor = TextMuted
                                    )
                                )
                                OutlinedTextField(
                                    value = suspendTime.format(DateTimeFormatter.ofPattern("h:mm a")),
                                    onValueChange = { },
                                    readOnly = true,
                                    label = { Text("Time") },
                                    modifier = Modifier.weight(1f),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = SignetPurple,
                                        unfocusedBorderColor = BorderDefault,
                                        focusedTextColor = TextPrimary,
                                        unfocusedTextColor = TextPrimary,
                                        focusedLabelColor = SignetPurple,
                                        unfocusedLabelColor = TextMuted
                                    )
                                )
                            }

                            // Quick date buttons
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedButton(
                                    onClick = {
                                        suspendDate = LocalDate.now()
                                        suspendTime = LocalTime.now().plusHours(1)
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("+1h", style = MaterialTheme.typography.bodySmall)
                                }
                                OutlinedButton(
                                    onClick = {
                                        suspendDate = LocalDate.now()
                                        suspendTime = LocalTime.now().plusHours(8)
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("+8h", style = MaterialTheme.typography.bodySmall)
                                }
                                OutlinedButton(
                                    onClick = {
                                        suspendDate = LocalDate.now().plusDays(1)
                                        suspendTime = LocalTime.of(9, 0)
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Tomorrow", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            OutlinedButton(
                                onClick = { showSuspendDialog = false },
                                enabled = !isLoading,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Cancel")
                            }

                            Button(
                                onClick = {
                                    scope.launch {
                                        isLoading = true
                                        error = null
                                        try {
                                            val client = SignetApiClient(daemonUrl)
                                            val until = if (suspendType == "until") {
                                                suspendDate.atTime(suspendTime)
                                                    .atZone(ZoneId.systemDefault())
                                                    .toInstant()
                                                    .toString()
                                            } else null
                                            val result = client.suspendApp(app.id, until)
                                            client.close()
                                            if (result.ok) {
                                                onActionComplete()
                                                onDismiss()
                                            } else {
                                                error = result.error ?: "Failed to suspend"
                                            }
                                        } catch (e: Exception) {
                                            error = e.message ?: "Failed to suspend"
                                        } finally {
                                            isLoading = false
                                        }
                                    }
                                },
                                enabled = !isLoading,
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Warning,
                                    contentColor = TextPrimary
                                )
                            ) {
                                Text("Suspend")
                            }
                        }
                    } else {
                        Button(
                            onClick = { showSuspendDialog = true },
                            enabled = !isLoading,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Warning,
                                contentColor = TextPrimary
                            )
                        ) {
                            Text("Suspend App")
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = { showRevokeConfirm = true },
                            enabled = !isLoading,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = Danger
                            )
                        ) {
                            Text("Revoke")
                        }

                        Button(
                            onClick = {
                                scope.launch {
                                    isLoading = true
                                    error = null
                                    try {
                                        val client = SignetApiClient(daemonUrl)
                                        val result = client.updateApp(
                                            id = app.id,
                                            description = if (appName != (app.description ?: "")) appName.ifBlank { null } else null,
                                            trustLevel = if (selectedTrustLevel != app.trustLevel) selectedTrustLevel else null
                                        )
                                        client.close()
                                        if (result.ok) {
                                            onActionComplete()
                                            onDismiss()
                                        } else {
                                            error = result.error ?: "Failed to update"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to update"
                                    } finally {
                                        isLoading = false
                                    }
                                }
                            },
                            enabled = !isLoading && hasChanges,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignetPurple,
                                contentColor = TextPrimary
                            )
                        ) {
                            Text("Save")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun TrustLevelBadge(trustLevel: String) {
    val color = when (trustLevel.lowercase()) {
        "full" -> Success
        "reasonable" -> SignetPurple
        "paranoid" -> Warning
        else -> TextMuted
    }

    Text(
        text = TrustLevels.label(trustLevel.lowercase()),
        style = MaterialTheme.typography.labelMedium,
        color = color
    )
}

@Composable
fun SuspendedBadge(suspendUntil: String? = null) {
    val text = if (suspendUntil != null) {
        "Until ${formatFutureTime(suspendUntil)}"
    } else {
        "Suspended"
    }
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = Warning,
        modifier = Modifier
            .background(
                color = Warning.copy(alpha = 0.15f),
                shape = RoundedCornerShape(4.dp)
            )
            .padding(horizontal = 6.dp, vertical = 2.dp)
    )
}

@Composable
private fun TrustLevelOption(
    label: String,
    description: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (selected) SignetPurple else BorderDefault,
                shape = RoundedCornerShape(8.dp)
            )
            .background(if (selected) SignetPurple.copy(alpha = 0.1f) else BgTertiary)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Radio indicator
        Box(
            modifier = Modifier
                .size(20.dp)
                .border(
                    width = 2.dp,
                    color = if (selected) SignetPurple else TextMuted,
                    shape = CircleShape
                ),
            contentAlignment = Alignment.Center
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(SignetPurple, CircleShape)
                )
            }
        }

        // Label and description
        Column {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = TextPrimary
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted
            )
        }
    }
}

