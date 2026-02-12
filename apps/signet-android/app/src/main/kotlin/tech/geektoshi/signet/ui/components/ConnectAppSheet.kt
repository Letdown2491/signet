package tech.geektoshi.signet.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.alexzhirkevich.qrose.rememberQrCodePainter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import tech.geektoshi.signet.ui.theme.Warning
import java.time.Instant
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectAppSheet(
    keys: List<KeyInfo>,
    daemonUrl: String,
    initialUri: String = "",
    onDismiss: () -> Unit,
    /** Called on success. Warning is set if relay notification failed (partial success). */
    onSuccess: (warning: String?) -> Unit,
    onScanQR: () -> Unit
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    // Tab state (0 = Bunker URI, 1 = NostrConnect)
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Bunker URI", "NostrConnect")

    // NostrConnect state
    var uri by remember { mutableStateOf(initialUri) }
    var appName by remember { mutableStateOf("") }
    var selectedKeyName by remember { mutableStateOf("") }
    var selectedTrustLevel by remember { mutableStateOf("reasonable") }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var parseError by remember { mutableStateOf<String?>(null) }
    var parsedData by remember { mutableStateOf<ParsedNostrconnect?>(null) }
    var relayScores by remember { mutableStateOf<Map<String, Int?>>(emptyMap()) }
    var loadingScores by remember { mutableStateOf(false) }

    // Bunker URI state
    var bunkerKeyName by remember { mutableStateOf("") }
    var bunkerUri by remember { mutableStateOf<String?>(null) }
    var bunkerLoading by remember { mutableStateOf(false) }
    var bunkerError by remember { mutableStateOf<String?>(null) }
    var expiresAt by remember { mutableStateOf<Instant?>(null) }
    var remainingSeconds by remember { mutableLongStateOf(0L) }

    // Get active keys
    val activeKeys = remember(keys) { keys.filter { it.status == "online" } }

    // Auto-select first active key for both tabs
    LaunchedEffect(activeKeys, selectedKeyName, bunkerKeyName) {
        if (activeKeys.isEmpty()) {
            if (selectedKeyName.isNotEmpty()) selectedKeyName = ""
            if (bunkerKeyName.isNotEmpty()) bunkerKeyName = ""
        } else {
            if (selectedKeyName.isEmpty() || activeKeys.none { it.name == selectedKeyName }) {
                selectedKeyName = activeKeys.first().name
            }
            if (bunkerKeyName.isEmpty() || activeKeys.none { it.name == bunkerKeyName }) {
                bunkerKeyName = activeKeys.first().name
            }
        }
    }

    // Parse URI when it changes
    LaunchedEffect(uri) {
        if (uri.isBlank()) {
            parsedData = null
            parseError = null
            relayScores = emptyMap()
            return@LaunchedEffect
        }

        val result = parseNostrconnectUri(uri)
        result.fold(
            onSuccess = { data ->
                parsedData = data
                parseError = null
                if (appName.isEmpty() && data.name != null) {
                    appName = data.name
                }
            },
            onFailure = { e ->
                parsedData = null
                parseError = e.message
                relayScores = emptyMap()
            }
        )
    }

    // Fetch trust scores when relays are parsed
    LaunchedEffect(parsedData?.relays) {
        val relays = parsedData?.relays
        if (relays.isNullOrEmpty()) {
            relayScores = emptyMap()
            return@LaunchedEffect
        }

        loadingScores = true
        try {
            val client = SignetApiClient(daemonUrl)
            val response = client.getRelayTrustScores(relays)
            client.close()
            relayScores = response.scores
        } catch (_: Exception) {
            // Silently fail - scores are optional
            relayScores = emptyMap()
        } finally {
            loadingScores = false
        }
    }

    // Update URI if initialUri changes (e.g., from QR scan)
    LaunchedEffect(initialUri) {
        if (initialUri.isNotEmpty()) {
            uri = initialUri
            selectedTab = 1 // Switch to NostrConnect tab when URI is provided
        }
    }

    // Countdown timer for bunker URI
    LaunchedEffect(expiresAt) {
        val expiry = expiresAt ?: return@LaunchedEffect
        while (true) {
            val now = Instant.now()
            val remaining = ChronoUnit.SECONDS.between(now, expiry)
            remainingSeconds = maxOf(0, remaining)
            if (remaining <= 0) break
            delay(1000)
        }
    }

    val canConnect = parsedData != null && selectedKeyName.isNotEmpty() && !isLoading
    val isExpired = remainingSeconds <= 0 && expiresAt != null

    // Generate bunker URI
    suspend fun generateBunkerUri() {
        if (bunkerKeyName.isEmpty()) return
        bunkerLoading = true
        bunkerError = null
        bunkerUri = null
        expiresAt = null

        try {
            val client = SignetApiClient(daemonUrl)
            val result = client.generateConnectionToken(bunkerKeyName)
            client.close()

            if (result.ok && result.bunkerUri != null) {
                bunkerUri = result.bunkerUri
                expiresAt = result.expiresAt?.let {
                    try {
                        Instant.parse(it)
                    } catch (e: Exception) {
                        Instant.now().plusSeconds(300)
                    }
                }
            } else {
                bunkerError = result.error ?: "Failed to generate bunker URI"
            }
        } catch (e: Exception) {
            bunkerError = e.message ?: "Failed to generate bunker URI"
        } finally {
            bunkerLoading = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = BgTertiary
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 32.dp)
        ) {
            // Header
            Column(
                modifier = Modifier.padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = if (selectedTab == 0) "Bunker URI" else "Connect via NostrConnect",
                    style = MaterialTheme.typography.headlineSmall,
                    color = TextPrimary
                )
                Text(
                    text = if (selectedTab == 0) "Share this with your Nostr app" else "Scan or paste from your Nostr app",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Tabs
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = Color.Transparent,
                contentColor = SignetPurple,
                indicator = { tabPositions ->
                    TabRowDefaults.SecondaryIndicator(
                        modifier = Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                        color = SignetPurple
                    )
                },
                divider = { HorizontalDivider(color = BorderDefault) }
            ) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = {
                            Text(
                                text = title,
                                color = if (selectedTab == index) SignetPurple else TextMuted
                            )
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Tab content
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 220.dp)
                    .padding(horizontal = 24.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                if (selectedTab == 0) {
                    // ===== BUNKER URI TAB =====

                    // Key Selection
                    Text(
                        text = "Key to share",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    if (activeKeys.isEmpty()) {
                        Text(
                            text = "No active keys. Unlock a key first.",
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
                                    selected = bunkerKeyName == key.name,
                                    onClick = {
                                        bunkerKeyName = key.name
                                        // Clear existing URI when key changes
                                        bunkerUri = null
                                        expiresAt = null
                                    }
                                )
                            }
                        }
                    }

                    // QR Code section
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        when {
                            bunkerLoading -> {
                                Box(
                                    modifier = Modifier
                                        .size(220.dp)
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(Color.White),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(
                                        color = SignetPurple,
                                        modifier = Modifier.size(48.dp)
                                    )
                                }
                                Text(
                                    text = "Generating...",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = TextMuted
                                )
                            }

                            bunkerError != null -> {
                                Box(
                                    modifier = Modifier
                                        .size(220.dp)
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(BgSecondary),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(
                                            text = bunkerError ?: "Error",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = Danger
                                        )
                                        Button(
                                            onClick = { scope.launch { generateBunkerUri() } },
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = SignetPurple,
                                                contentColor = TextPrimary
                                            )
                                        ) {
                                            Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                                            Text("Retry", Modifier.padding(start = 8.dp))
                                        }
                                    }
                                }
                            }

                            bunkerUri != null -> {
                                val qrPainter = rememberQrCodePainter(data = bunkerUri!!)

                                Box(
                                    modifier = Modifier
                                        .size(220.dp)
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(Color.White)
                                        .padding(12.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isExpired) {
                                        Text(
                                            text = "Expired",
                                            style = MaterialTheme.typography.titleLarge,
                                            color = Color.Gray
                                        )
                                    } else {
                                        Image(
                                            painter = qrPainter,
                                            contentDescription = "Bunker URI QR Code",
                                            modifier = Modifier.size(196.dp)
                                        )
                                    }
                                }

                                // Timer
                                if (isExpired) {
                                    Text(
                                        text = "Token expired",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = Danger
                                    )
                                } else {
                                    val minutes = remainingSeconds / 60
                                    val seconds = remainingSeconds % 60
                                    val timerColor = if (remainingSeconds <= 60) Warning else TextSecondary
                                    Text(
                                        text = "Expires in ${minutes}:${seconds.toString().padStart(2, '0')}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = timerColor
                                    )
                                }

                                // Action buttons
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    if (isExpired) {
                                        Button(
                                            onClick = { scope.launch { generateBunkerUri() } },
                                            modifier = Modifier.fillMaxWidth(),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = SignetPurple,
                                                contentColor = TextPrimary
                                            )
                                        ) {
                                            Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                                            Text("Generate New", Modifier.padding(start = 8.dp))
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = {
                                                bunkerUri?.let { uri ->
                                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                                    val clip = ClipData.newPlainText("Bunker URI", uri)
                                                    clipboard.setPrimaryClip(clip)
                                                    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                                                }
                                            },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Icon(Icons.Default.ContentCopy, null, Modifier.size(18.dp))
                                            Text("Copy", Modifier.padding(start = 8.dp))
                                        }
                                        Button(
                                            onClick = { scope.launch { generateBunkerUri() } },
                                            modifier = Modifier.weight(1f),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = SignetPurple,
                                                contentColor = TextPrimary
                                            )
                                        ) {
                                            Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                                            Text("New", Modifier.padding(start = 8.dp))
                                        }
                                    }
                                }
                            }

                            else -> {
                                // Just show the generate button
                                Button(
                                    onClick = { scope.launch { generateBunkerUri() } },
                                    enabled = bunkerKeyName.isNotEmpty(),
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = SignetPurple,
                                        contentColor = TextPrimary
                                    )
                                ) {
                                    Text("Generate Bunker URI")
                                }
                            }
                        }
                    }

                    Text(
                        text = "Scan the QR code or paste the URI in your Nostr app to connect.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Close button for Bunker tab
                    OutlinedButton(
                        onClick = onDismiss,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Close")
                    }

                } else {
                    // ===== NOSTRCONNECT TAB =====

                    // Scan and Paste buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = onScanQR,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.QrCodeScanner,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text("Scan", modifier = Modifier.padding(start = 8.dp))
                        }

                        OutlinedButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                clipboard.primaryClip?.getItemAt(0)?.text?.toString()?.let { text ->
                                    uri = text
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.ContentPaste,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text("Paste", modifier = Modifier.padding(start = 8.dp))
                        }
                    }

                    // URI Input
                    OutlinedTextField(
                        value = uri,
                        onValueChange = { uri = it },
                        placeholder = { Text("nostrconnect://...") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                        maxLines = 4,
                        isError = parseError != null,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = if (parseError != null) Danger else SignetPurple,
                            unfocusedBorderColor = if (parseError != null) Danger else BorderDefault,
                            cursorColor = SignetPurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedPlaceholderColor = TextMuted,
                            unfocusedPlaceholderColor = TextMuted,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )

                    if (parseError != null) {
                        Text(
                            text = parseError ?: "Unknown error",
                            style = MaterialTheme.typography.bodySmall,
                            color = Danger
                        )
                    }

                    // Parsed data display
                    parsedData?.let { data ->
                        HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                        // App Name Input
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

                        // Relays with trust scores
                        Text(
                            text = "Relays",
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary
                        )

                        RelayBadgesGrid(
                            relays = data.relays,
                            scores = relayScores,
                            isLoading = loadingScores
                        )

                        // Key Selection
                        Text(
                            text = "Sign with Key",
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary
                        )

                        if (activeKeys.isEmpty()) {
                            Text(
                                text = "No active keys. Unlock a key first.",
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

                        // Trust Level
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

                        // Requested Permissions
                        if (data.permissions.isNotEmpty()) {
                            Text(
                                text = "App is requesting",
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary
                            )

                            PermissionsBadges(permissions = data.permissions)

                            Text(
                                text = "These are what the app says it needs. Your trust level controls what actually gets auto-approved.",
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

                    HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

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
                                            description = appName.ifBlank { null }
                                        )
                                        client.close()
                                        if (result.ok) {
                                            val warning = if (result.connectResponseSent == false) {
                                                result.connectResponseError ?: "Could not notify the app. It may take a moment for the app to recognize the connection."
                                            } else null
                                            onSuccess(warning)
                                            onDismiss()
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

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}
