package tech.geektoshi.signet.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.PendingRequest
import tech.geektoshi.signet.ui.theme.BgPrimary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import tech.geektoshi.signet.util.ClearSensitiveDataOnDispose
import tech.geektoshi.signet.util.getKindLabel
import tech.geektoshi.signet.util.getMethodLabel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestDetailSheet(
    request: PendingRequest,
    daemonUrl: String,
    defaultTrustLevel: String = "reasonable",
    onDismiss: () -> Unit,
    onActionComplete: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedTrustLevel by remember { mutableStateOf(defaultTrustLevel) }
    var appName by remember { mutableStateOf("") }
    var alwaysAllow by remember { mutableStateOf(false) }
    val passphraseState = remember { mutableStateOf("") }
    var passphrase by passphraseState
    var rawJsonExpanded by remember { mutableStateOf(false) }

    // Clear sensitive data when sheet is dismissed
    ClearSensitiveDataOnDispose(passphraseState)

    val isPending = request.processedAt == null
    val isConnectRequest = request.method == "connect"
    val isSigningRequest = request.method in listOf("sign_event", "nip04_encrypt", "nip04_decrypt", "nip44_encrypt", "nip44_decrypt")

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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = request.appName ?: "Unknown App",
                    style = MaterialTheme.typography.headlineSmall,
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

            // Remote pubkey
            Text(
                text = request.remotePubkey,
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Method
            InfoRow(label = "Method", value = getMethodLabel(request.method, request.eventPreview?.kind))

            // Key
            InfoRow(label = "Key", value = request.keyName ?: "Unknown")

            // Event preview for sign_event
            if (request.method == "sign_event" && request.eventPreview != null) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                Text(
                    text = "Event Preview",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                InfoRow(label = "Kind", value = "${request.eventPreview.kind} (${getKindLabel(request.eventPreview.kind)})")

                if (request.eventPreview.content.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "Content",
                            style = MaterialTheme.typography.labelMedium,
                            color = TextMuted
                        )
                        Text(
                            text = request.eventPreview.content,
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                            maxLines = 5,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                if (request.eventPreview.tags.isNotEmpty()) {
                    InfoRow(label = "Tags", value = "${request.eventPreview.tags.size} tags")
                }
            }

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Timestamps
            Text(
                text = "Timestamps",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )

            InfoRow(label = "Created", value = formatDateTime(request.createdAt))

            if (request.processedAt != null) {
                InfoRow(label = "Processed", value = formatDateTime(request.processedAt))
            } else {
                InfoRow(label = "Expires", value = formatDateTime(request.expiresAt))
                InfoRow(label = "TTL", value = "${request.ttlSeconds}s")
            }

            // Raw JSON section (collapsible)
            if (!request.params.isNullOrBlank()) {
                val formattedJson = remember(request.params) { formatJson(request.params) }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { rawJsonExpanded = !rawJsonExpanded }
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Raw JSON",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )
                    Icon(
                        imageVector = if (rawJsonExpanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = if (rawJsonExpanded) "Collapse" else "Expand",
                        tint = TextMuted
                    )
                }

                AnimatedVisibility(visible = rawJsonExpanded) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(BgPrimary)
                                .horizontalScroll(rememberScrollState())
                                .padding(12.dp)
                        ) {
                            Text(
                                text = formattedJson,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace
                                ),
                                color = TextSecondary
                            )
                        }

                        OutlinedButton(
                            onClick = {
                                copyToClipboard(context, "Raw JSON", formattedJson)
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = SignetPurple
                            )
                        ) {
                            Text("Copy to Clipboard")
                        }
                    }
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

            // App name input for connect requests
            if (isPending && isConnectRequest) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

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

                Text(
                    text = "Trust Level",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TrustLevelChip(
                        level = "paranoid",
                        label = "Paranoid",
                        selected = selectedTrustLevel == "paranoid",
                        onClick = { selectedTrustLevel = "paranoid" },
                        modifier = Modifier.weight(1f)
                    )
                    TrustLevelChip(
                        level = "reasonable",
                        label = "Reasonable",
                        selected = selectedTrustLevel == "reasonable",
                        onClick = { selectedTrustLevel = "reasonable" },
                        modifier = Modifier.weight(1f)
                    )
                    TrustLevelChip(
                        level = "full",
                        label = "Full",
                        selected = selectedTrustLevel == "full",
                        onClick = { selectedTrustLevel = "full" },
                        modifier = Modifier.weight(1f)
                    )
                }

                Text(
                    text = when (selectedTrustLevel) {
                        "paranoid" -> "Require approval for every request"
                        "reasonable" -> "Auto-approve read operations"
                        "full" -> "Auto-approve all requests"
                        else -> ""
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
            }

            // Always allow checkbox for signing requests
            if (isPending && isSigningRequest) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = alwaysAllow,
                        onCheckedChange = { alwaysAllow = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = SignetPurple,
                            uncheckedColor = TextMuted
                        )
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Always allow",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary
                        )
                        Text(
                            text = "Create a permanent permission for this action",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                }
            }

            // Passphrase input for encrypted keys
            if (isPending && request.requiresPassword) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                Text(
                    text = "Passphrase Required",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                Text(
                    text = "This key is encrypted. Enter the passphrase to approve this request.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )

                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    placeholder = { Text("Enter passphrase") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
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
            }

            // Action buttons for pending requests
            if (isPending) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                isLoading = true
                                error = null
                                try {
                                    val client = SignetApiClient(daemonUrl)
                                    val result = client.denyRequest(request.id)
                                    client.close()
                                    if (result.ok) {
                                        onActionComplete()
                                        onDismiss()
                                    } else {
                                        error = result.error ?: "Failed to deny"
                                    }
                                } catch (e: Exception) {
                                    error = e.message ?: "Failed to deny"
                                } finally {
                                    isLoading = false
                                }
                            }
                        },
                        enabled = !isLoading,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Danger
                        )
                    ) {
                        Text("Deny")
                    }

                    Button(
                        onClick = {
                            scope.launch {
                                isLoading = true
                                error = null
                                try {
                                    val client = SignetApiClient(daemonUrl)
                                    val passphraseToSend = if (request.requiresPassword) passphrase else null
                                    val result = when {
                                        // For connect requests, use trust level and app name
                                        isConnectRequest -> client.approveRequest(
                                            id = request.id,
                                            trustLevel = selectedTrustLevel,
                                            appName = appName.ifBlank { null },
                                            passphrase = passphraseToSend
                                        )
                                        // For signing requests, use alwaysAllow
                                        isSigningRequest -> client.approveRequest(
                                            id = request.id,
                                            alwaysAllow = alwaysAllow,
                                            passphrase = passphraseToSend
                                        )
                                        // For other requests, just approve
                                        else -> client.approveRequest(
                                            id = request.id,
                                            passphrase = passphraseToSend
                                        )
                                    }
                                    client.close()
                                    if (result.ok) {
                                        onActionComplete()
                                        onDismiss()
                                    } else {
                                        error = result.error ?: "Failed to approve"
                                    }
                                } catch (e: Exception) {
                                    error = e.message ?: "Failed to approve"
                                } finally {
                                    isLoading = false
                                }
                            }
                        },
                        enabled = !isLoading && (!request.requiresPassword || passphrase.isNotBlank()),
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SignetPurple,
                            contentColor = TextPrimary
                        )
                    ) {
                        Text("Approve")
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = TextMuted
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary
        )
    }
}

private fun formatDateTime(timestamp: String): String {
    return try {
        if (timestamp.contains("T")) {
            val datePart = timestamp.substringBefore("T")
            val timePart = timestamp.substringAfter("T").substringBefore(".")
            "$datePart $timePart"
        } else {
            timestamp
        }
    } catch (e: Exception) {
        timestamp
    }
}

@Composable
private fun TrustLevelChip(
    level: String,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium
            )
        },
        modifier = modifier,
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = SignetPurple.copy(alpha = 0.2f),
            selectedLabelColor = SignetPurple,
            containerColor = BgTertiary,
            labelColor = TextSecondary
        )
    )
}

private fun formatJson(json: String): String {
    return try {
        // Try parsing as array first (NIP-46 params are often arrays)
        val trimmed = json.trim()
        if (trimmed.startsWith("[")) {
            JSONArray(trimmed).toString(2)
        } else if (trimmed.startsWith("{")) {
            JSONObject(trimmed).toString(2)
        } else {
            json
        }
    } catch (e: Exception) {
        json
    }
}

private fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText(label, text)
    clipboard.setPrimaryClip(clip)
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}
