package tech.geektoshi.signet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.Warning

/**
 * Simplified connect sheet for deep links / share intents.
 * Shows only the essential info needed to approve a connection.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeepLinkConnectSheet(
    uri: String,
    keys: List<KeyInfo>,
    daemonUrl: String,
    onDismiss: () -> Unit,
    onSuccess: (warning: String?) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    // Parse the URI
    var parsedData by remember { mutableStateOf<ParsedNostrconnect?>(null) }
    var parseError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(uri) {
        val result = parseNostrconnectUri(uri)
        result.fold(
            onSuccess = { data ->
                parsedData = data
                parseError = null
            },
            onFailure = { e ->
                parsedData = null
                parseError = e.message
            }
        )
    }

    // Form state
    var selectedKeyName by remember { mutableStateOf("") }
    var selectedTrustLevel by remember { mutableStateOf("reasonable") }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Get active keys
    val activeKeys = remember(keys) { keys.filter { it.status == "online" } }

    // Auto-select first active key
    LaunchedEffect(activeKeys) {
        if (activeKeys.isNotEmpty() && selectedKeyName.isEmpty()) {
            selectedKeyName = activeKeys.first().name
        }
    }

    val canConnect = parsedData != null && selectedKeyName.isNotEmpty() && !isLoading
    val appName = parsedData?.name ?: "Unknown App"

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
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "Connect $appName?",
                    style = MaterialTheme.typography.headlineSmall,
                    color = TextPrimary
                )

                // Relay summary
                val relaySummary = parsedData?.let { data ->
                    val firstRelay = data.relays.firstOrNull()?.removePrefix("wss://") ?: "unknown relay"
                    when (data.relays.size) {
                        1 -> "via $firstRelay"
                        2 -> "via $firstRelay and 1 other"
                        else -> "via $firstRelay and ${data.relays.size - 1} others"
                    }
                } ?: ""

                Text(
                    text = relaySummary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted
                )
            }

            // Parse error
            if (parseError != null) {
                Text(
                    text = parseError ?: "Unknown error",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Danger,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Danger.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            }

            // Content - only show if parsed successfully
            parsedData?.let { data ->

                // Key selection
                Text(
                    text = "Sign with Key",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                if (activeKeys.isEmpty()) {
                    Text(
                        text = "No unlocked keys available. Unlock a key first.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Warning,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Warning.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        activeKeys.forEach { key ->
                            KeyOption(
                                keyName = key.name,
                                selected = selectedKeyName == key.name,
                                onClick = { selectedKeyName = key.name }
                            )
                        }
                    }
                }

                // Trust level
                Text(
                    text = "Trust Level",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TrustLevelOption(
                        label = "Reasonable",
                        description = "Auto-approve common operations",
                        selected = selectedTrustLevel == "reasonable",
                        recommended = true,
                        onClick = { selectedTrustLevel = "reasonable" }
                    )
                    TrustLevelOption(
                        label = "Paranoid",
                        description = "Require approval for every request",
                        selected = selectedTrustLevel == "paranoid",
                        onClick = { selectedTrustLevel = "paranoid" }
                    )
                    TrustLevelOption(
                        label = "Full",
                        description = "Auto-approve all requests",
                        selected = selectedTrustLevel == "full",
                        onClick = { selectedTrustLevel = "full" }
                    )
                }

                // Requested permissions
                if (data.permissions.isNotEmpty()) {
                    Text(
                        text = "App is requesting",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    PermissionsBadges(permissions = data.permissions)

                    Text(
                        text = "Your trust level controls what actually gets auto-approved.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
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

            Spacer(modifier = Modifier.height(8.dp))

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onDismiss,
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
                                val result = client.connectViaNostrconnect(
                                    uri = uri,
                                    keyName = selectedKeyName,
                                    trustLevel = selectedTrustLevel,
                                    description = appName
                                )
                                client.close()
                                if (result.ok) {
                                    val warning = if (result.connectResponseSent == false) {
                                        result.connectResponseError
                                            ?: "Could not notify the app. It may take a moment for the app to recognize the connection."
                                    } else null
                                    onSuccess(warning)
                                } else {
                                    error = result.error ?: "Failed to connect"
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Failed to connect"
                            } finally {
                                isLoading = false
                            }
                        }
                    },
                    enabled = canConnect,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = SignetPurple,
                        contentColor = TextPrimary
                    )
                ) {
                    Text(if (isLoading) "Connecting..." else "Connect")
                }
            }
        }
    }
}
