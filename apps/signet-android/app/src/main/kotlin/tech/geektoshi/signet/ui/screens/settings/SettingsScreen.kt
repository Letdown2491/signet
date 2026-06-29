package tech.geektoshi.signet.ui.screens.settings

import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.BuildConfig
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.DeadManSwitchStatus
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.util.ErrorFormatter
import tech.geektoshi.signet.util.TrustLevels
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.QRScannerSheet
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.Success
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import tech.geektoshi.signet.ui.theme.Warning
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settingsRepository: SettingsRepository,
    apiClient: SignetApiClient? = null,
    keys: List<KeyInfo> = emptyList(),
    deadManSwitchStatus: DeadManSwitchStatus? = null,
    onDeadManSwitchStatusChanged: (DeadManSwitchStatus) -> Unit = {},
    onHelpClick: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val savedUrl by settingsRepository.daemonUrl.collectAsState(initial = "")
    val savedTrustLevel by settingsRepository.defaultTrustLevel.collectAsState(initial = "reasonable")
    val appLockEnabled by settingsRepository.appLockEnabled.collectAsState(initial = false)
    val lockTimeoutMinutes by settingsRepository.lockTimeoutMinutes.collectAsState(initial = 1)

    var daemonUrl by remember { mutableStateOf("") }
    var selectedTrustLevel by remember { mutableStateOf("reasonable") }
    var showQRScanner by remember { mutableStateOf(false) }

    // Inactivity Lock state
    var showPassphraseDialog by remember { mutableStateOf(false) }
    var passphraseDialogAction by remember { mutableStateOf<InactivityLockAction?>(null) }
    var passphrase by remember { mutableStateOf("") }
    var passphraseError by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var showConfigDialog by remember { mutableStateOf(false) }
    var timeframeValue by remember { mutableIntStateOf(7) }
    var timeframeUnit by remember { mutableStateOf(TimeUnit.DAYS) }

    // Get encrypted keys for passphrase verification
    val encryptedKeys = remember(keys) { keys.filter { it.isEncrypted } }

    // QR Scanner Sheet
    if (showQRScanner) {
        QRScannerSheet(
            onScanned = { url ->
                daemonUrl = url
            },
            onDismiss = { showQRScanner = false }
        )
    }

    // Passphrase Dialog for Inactivity Lock actions
    if (showPassphraseDialog && passphraseDialogAction != null && apiClient != null) {
        val action = passphraseDialogAction!!
        val firstEncryptedKey = encryptedKeys.firstOrNull()

        AlertDialog(
            onDismissRequest = {
                if (!isLoading) {
                    showPassphraseDialog = false
                    passphrase = ""
                    passphraseError = null
                }
            },
            title = {
                Text(
                    text = when (action) {
                        InactivityLockAction.Disable -> "Disable Inactivity Lock"
                        InactivityLockAction.Reset -> "Reset Timer"
                        is InactivityLockAction.UpdateTimeframe -> "Update Timeframe"
                    },
                    color = TextPrimary
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = when (action) {
                            InactivityLockAction.Disable -> "Enter your key passphrase to disable the inactivity lock."
                            InactivityLockAction.Reset -> "Enter your key passphrase to reset the timer."
                            is InactivityLockAction.UpdateTimeframe -> "Enter your key passphrase to update the timeframe."
                        },
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
                        value = passphrase,
                        onValueChange = {
                            passphrase = it
                            passphraseError = null
                        },
                        label = { Text("Passphrase") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = passphraseError != null,
                        supportingText = passphraseError?.let { { Text(it, color = Danger) } },
                        enabled = !isLoading,
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
                        if (firstEncryptedKey == null || passphrase.isBlank()) return@Button

                        scope.launch {
                            isLoading = true
                            passphraseError = null

                            try {
                                val result = when (action) {
                                    InactivityLockAction.Disable ->
                                        apiClient.disableDeadManSwitch(firstEncryptedKey.name, passphrase)
                                    InactivityLockAction.Reset ->
                                        apiClient.resetDeadManSwitch(firstEncryptedKey.name, passphrase)
                                    is InactivityLockAction.UpdateTimeframe ->
                                        apiClient.updateDeadManSwitchTimeframe(
                                            firstEncryptedKey.name,
                                            passphrase,
                                            action.timeframeSec
                                        )
                                }

                                if (result.ok && result.status != null) {
                                    onDeadManSwitchStatusChanged(result.status)
                                    showPassphraseDialog = false
                                    passphrase = ""
                                    val message = when (action) {
                                        InactivityLockAction.Disable -> "Inactivity lock disabled"
                                        InactivityLockAction.Reset -> "Timer reset"
                                        is InactivityLockAction.UpdateTimeframe -> "Timeframe updated"
                                    }
                                    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                                } else {
                                    passphraseError = result.error ?: "Operation failed"
                                }
                            } catch (e: Exception) {
                                passphraseError = e.message ?: "Operation failed"
                            } finally {
                                isLoading = false
                            }
                        }
                    },
                    enabled = !isLoading && passphrase.isNotBlank() && firstEncryptedKey != null,
                    colors = ButtonDefaults.buttonColors(containerColor = SignetPurple)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = TextPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Confirm")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showPassphraseDialog = false
                        passphrase = ""
                        passphraseError = null
                    },
                    enabled = !isLoading
                ) {
                    Text("Cancel", color = TextMuted)
                }
            },
            containerColor = BgSecondary
        )
    }

    // Configure/Enable Inactivity Lock Dialog
    if (showConfigDialog && apiClient != null) {
        val isEnabling = deadManSwitchStatus?.enabled != true
        val firstEncryptedKey = encryptedKeys.firstOrNull()
        var configPassphrase by remember { mutableStateOf("") }
        var configError by remember { mutableStateOf<String?>(null) }
        var configLoading by remember { mutableStateOf(false) }
        var unitDropdownExpanded by remember { mutableStateOf(false) }

        AlertDialog(
            onDismissRequest = {
                if (!configLoading) {
                    showConfigDialog = false
                    configPassphrase = ""
                    configError = null
                }
            },
            title = {
                Text(
                    text = if (isEnabling) "Enable Inactivity Lock" else "Configure Timeframe",
                    color = TextPrimary
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = if (isEnabling)
                            "When enabled, all keys will be locked and apps suspended if the timer expires without being reset."
                        else
                            "Update the timeframe for the inactivity lock. The timer will be reset when you save.",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium
                    )

                    // Duration input
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = timeframeValue.toString(),
                            onValueChange = { value ->
                                value.toIntOrNull()?.let { timeframeValue = it.coerceAtLeast(1) }
                            },
                            label = { Text("Duration") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
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

                        ExposedDropdownMenuBox(
                            expanded = unitDropdownExpanded,
                            onExpandedChange = { unitDropdownExpanded = it },
                            modifier = Modifier.weight(1f)
                        ) {
                            OutlinedTextField(
                                value = timeframeUnit.label,
                                onValueChange = {},
                                readOnly = true,
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = unitDropdownExpanded) },
                                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = SignetPurple,
                                    unfocusedBorderColor = BorderDefault,
                                    focusedLabelColor = SignetPurple,
                                    unfocusedLabelColor = TextMuted,
                                    focusedTextColor = TextPrimary,
                                    unfocusedTextColor = TextPrimary,
                                    focusedContainerColor = BgTertiary,
                                    unfocusedContainerColor = BgTertiary
                                )
                            )
                            ExposedDropdownMenu(
                                expanded = unitDropdownExpanded,
                                onDismissRequest = { unitDropdownExpanded = false }
                            ) {
                                TimeUnit.entries.forEach { unit ->
                                    DropdownMenuItem(
                                        text = { Text(unit.label, color = TextPrimary) },
                                        onClick = {
                                            timeframeUnit = unit
                                            unitDropdownExpanded = false
                                        }
                                    )
                                }
                            }
                        }
                    }

                    // Passphrase for updating (not needed for initial enable)
                    if (!isEnabling && firstEncryptedKey != null) {
                        Text(
                            text = "Using key: ${firstEncryptedKey.name}",
                            color = TextMuted,
                            style = MaterialTheme.typography.bodySmall
                        )

                        OutlinedTextField(
                            value = configPassphrase,
                            onValueChange = {
                                configPassphrase = it
                                configError = null
                            },
                            label = { Text("Passphrase") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            isError = configError != null,
                            supportingText = configError?.let { { Text(it, color = Danger) } },
                            enabled = !configLoading,
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
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            configLoading = true
                            configError = null

                            try {
                                val timeframeSec = valueUnitToSeconds(timeframeValue, timeframeUnit)

                                val result = if (isEnabling) {
                                    apiClient.enableDeadManSwitch(timeframeSec)
                                } else {
                                    if (firstEncryptedKey == null) {
                                        configError = "No encrypted key available"
                                        return@launch
                                    }
                                    apiClient.updateDeadManSwitchTimeframe(
                                        firstEncryptedKey.name,
                                        configPassphrase,
                                        timeframeSec
                                    )
                                }

                                if (result.ok && result.status != null) {
                                    onDeadManSwitchStatusChanged(result.status)
                                    showConfigDialog = false
                                    configPassphrase = ""
                                    Toast.makeText(
                                        context,
                                        if (isEnabling) "Inactivity lock enabled" else "Timeframe updated",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } else {
                                    configError = result.error ?: "Operation failed"
                                }
                            } catch (e: Exception) {
                                configError = e.message ?: "Operation failed"
                            } finally {
                                configLoading = false
                            }
                        }
                    },
                    enabled = !configLoading && timeframeValue > 0 &&
                            (isEnabling || configPassphrase.isNotBlank()),
                    colors = ButtonDefaults.buttonColors(containerColor = SignetPurple)
                ) {
                    if (configLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = TextPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text(if (isEnabling) "Enable" else "Save")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showConfigDialog = false
                        configPassphrase = ""
                        configError = null
                    },
                    enabled = !configLoading
                ) {
                    Text("Cancel", color = TextMuted)
                }
            },
            containerColor = BgSecondary
        )
    }

    // Check if device supports biometric or device credential authentication
    val biometricManager = remember { BiometricManager.from(context) }
    val canAuthenticate = remember {
        biometricManager.canAuthenticate(BIOMETRIC_STRONG or DEVICE_CREDENTIAL) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }

    // Initialize text field with saved URL
    LaunchedEffect(savedUrl) {
        if (daemonUrl.isEmpty() && savedUrl.isNotEmpty()) {
            daemonUrl = savedUrl
        }
    }

    // Initialize trust level with saved value
    LaunchedEffect(savedTrustLevel) {
        selectedTrustLevel = savedTrustLevel
    }

    val hasUrlChanges = daemonUrl.trim() != savedUrl

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Settings",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )

        // Connection Settings
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Connection",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )
                    if (hasUrlChanges) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    val trimmed = daemonUrl.trim()
                                    val client = SignetApiClient(trimmed)
                                    try {
                                        // Test the connection before saving so a bad URL / TLS
                                        // failure surfaces instead of silently "saving" a dead one.
                                        client.pingHealth()
                                        settingsRepository.setDaemonUrl(trimmed)
                                        Toast.makeText(context, "Connected", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        android.util.Log.e("SignetSettings", "Connect to $trimmed failed", e)
                                        val f = ErrorFormatter.format(e)
                                        val msg = f.action?.let { "${f.message} — $it" } ?: f.message
                                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                                    } finally {
                                        client.close()
                                    }
                                }
                            }
                        ) {
                            Text("Save", color = SignetPurple)
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = daemonUrl,
                        onValueChange = { daemonUrl = it },
                        label = { Text("Daemon URL") },
                        placeholder = { Text("http://your-server") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = SignetPurple,
                            unfocusedBorderColor = BorderDefault,
                            focusedLabelColor = SignetPurple,
                            unfocusedLabelColor = TextMuted,
                            cursorColor = SignetPurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedPlaceholderColor = TextMuted,
                            unfocusedPlaceholderColor = TextMuted,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )

                    IconButton(
                        onClick = { showQRScanner = true }
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.QrCodeScanner,
                            contentDescription = "Scan QR code",
                            tint = SignetPurple,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
            }
        }

        // Trust Level Settings
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            var trustLevelExpanded by remember { mutableStateOf(false) }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Default Trust Level",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary
                )

                ExposedDropdownMenuBox(
                    expanded = trustLevelExpanded,
                    onExpandedChange = { trustLevelExpanded = it }
                ) {
                    OutlinedTextField(
                        value = TrustLevels.label(selectedTrustLevel),
                        onValueChange = {},
                        readOnly = true,
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = trustLevelExpanded) },
                        supportingText = {
                            Text(
                                text = TrustLevels.description(selectedTrustLevel),
                                color = TextMuted
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = SignetPurple,
                            unfocusedBorderColor = BorderDefault,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )

                    ExposedDropdownMenu(
                        expanded = trustLevelExpanded,
                        onDismissRequest = { trustLevelExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(TrustLevels.label("paranoid"), color = TextPrimary)
                                    Text(
                                        TrustLevels.description("paranoid"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted
                                    )
                                }
                            },
                            onClick = {
                                selectedTrustLevel = "paranoid"
                                scope.launch { settingsRepository.setDefaultTrustLevel("paranoid") }
                                trustLevelExpanded = false
                            }
                        )
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(TrustLevels.label("reasonable"), color = TextPrimary)
                                    Text(
                                        TrustLevels.description("reasonable"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted
                                    )
                                }
                            },
                            onClick = {
                                selectedTrustLevel = "reasonable"
                                scope.launch { settingsRepository.setDefaultTrustLevel("reasonable") }
                                trustLevelExpanded = false
                            }
                        )
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(TrustLevels.label("full"), color = TextPrimary)
                                    Text(
                                        TrustLevels.description("full"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted
                                    )
                                }
                            },
                            onClick = {
                                selectedTrustLevel = "full"
                                scope.launch { settingsRepository.setDefaultTrustLevel("full") }
                                trustLevelExpanded = false
                            }
                        )
                    }
                }
            }
        }

        // Security Settings
        if (canAuthenticate || apiClient != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = BgSecondary)
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Security",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary,
                        modifier = Modifier.padding(16.dp)
                    )

                    // App Lock Toggle (only if device supports authentication)
                    if (canAuthenticate) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    scope.launch {
                                        settingsRepository.setAppLockEnabled(!appLockEnabled)
                                    }
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Require unlock",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = TextPrimary
                                )
                                Text(
                                    text = "Use fingerprint, face, or PIN to open app",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextMuted
                                )
                            }
                            Switch(
                                checked = appLockEnabled,
                                onCheckedChange = { enabled ->
                                    scope.launch {
                                        settingsRepository.setAppLockEnabled(enabled)
                                    }
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = TextPrimary,
                                    checkedTrackColor = SignetPurple,
                                    uncheckedThumbColor = TextMuted,
                                    uncheckedTrackColor = BgTertiary
                                )
                            )
                        }

                        // Lock Timeout (only show if app lock is enabled)
                        if (appLockEnabled) {
                            var timeoutExpanded by remember { mutableStateOf(false) }

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Lock after",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = TextSecondary
                                )

                                ExposedDropdownMenuBox(
                                    expanded = timeoutExpanded,
                                    onExpandedChange = { timeoutExpanded = it }
                                ) {
                                    OutlinedTextField(
                                        value = when (lockTimeoutMinutes) {
                                            0 -> "Immediately"
                                            1 -> "1 minute"
                                            5 -> "5 minutes"
                                            15 -> "15 minutes"
                                            else -> "1 minute"
                                        },
                                        onValueChange = {},
                                        readOnly = true,
                                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = timeoutExpanded) },
                                        modifier = Modifier
                                            .width(150.dp)
                                            .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                                        textStyle = MaterialTheme.typography.bodyMedium,
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedBorderColor = SignetPurple,
                                            unfocusedBorderColor = BorderDefault,
                                            focusedTextColor = TextPrimary,
                                            unfocusedTextColor = TextPrimary,
                                            focusedContainerColor = BgTertiary,
                                            unfocusedContainerColor = BgTertiary
                                        )
                                    )

                                    ExposedDropdownMenu(
                                        expanded = timeoutExpanded,
                                        onDismissRequest = { timeoutExpanded = false }
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("Immediately", color = TextPrimary) },
                                            onClick = {
                                                scope.launch { settingsRepository.setLockTimeoutMinutes(0) }
                                                timeoutExpanded = false
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("1 minute", color = TextPrimary) },
                                            onClick = {
                                                scope.launch { settingsRepository.setLockTimeoutMinutes(1) }
                                                timeoutExpanded = false
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("5 minutes", color = TextPrimary) },
                                            onClick = {
                                                scope.launch { settingsRepository.setLockTimeoutMinutes(5) }
                                                timeoutExpanded = false
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("15 minutes", color = TextPrimary) },
                                            onClick = {
                                                scope.launch { settingsRepository.setLockTimeoutMinutes(15) }
                                                timeoutExpanded = false
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Inactivity Lock (only if connected to daemon)
                    if (apiClient != null) {
                        // Add divider if App Lock section is also shown
                        if (canAuthenticate) {
                            HorizontalDivider(
                                color = TextMuted.copy(alpha = 0.2f),
                                modifier = Modifier.padding(horizontal = 16.dp)
                            )
                        }

                        InactivityLockContent(
                            status = deadManSwitchStatus,
                            encryptedKeys = encryptedKeys,
                            isLoading = isLoading,
                            onEnable = {
                                if (encryptedKeys.isEmpty()) {
                                    Toast.makeText(context, "At least one encrypted key is required", Toast.LENGTH_SHORT).show()
                                } else {
                                    showConfigDialog = true
                                }
                            },
                            onDisable = {
                                passphraseDialogAction = InactivityLockAction.Disable
                                showPassphraseDialog = true
                            },
                            onConfigure = {
                                deadManSwitchStatus?.let { status ->
                                    val (value, unit) = secondsToValueUnit(status.timeframeSec)
                                    timeframeValue = value
                                    timeframeUnit = unit
                                }
                                showConfigDialog = true
                            },
                            onResetTimer = {
                                passphraseDialogAction = InactivityLockAction.Reset
                                showPassphraseDialog = true
                            }
                        )
                    }
                }
            }
        }

        // About & Help
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                SettingsRow(
                    title = "Help",
                    subtitle = "Learn how Signet works",
                    onClick = onHelpClick
                )

                HorizontalDivider(
                    color = TextMuted.copy(alpha = 0.2f),
                    modifier = Modifier.padding(horizontal = 16.dp)
                )

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    Text(
                        text = "Signet for Android",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                    Text(
                        text = "Version ${BuildConfig.VERSION_NAME}",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                }
            }
        }

        // Disconnect at bottom
        Spacer(modifier = Modifier.weight(1f))

        TextButton(
            onClick = {
                scope.launch {
                    settingsRepository.setDaemonUrl("")
                    daemonUrl = ""
                }
            },
            modifier = Modifier.align(Alignment.CenterHorizontally)
        ) {
            Text("Disconnect", color = Danger)
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun SettingsRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = TextPrimary
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = TextMuted
        )
    }
}

// ==================== Inactivity Lock Section ====================

/**
 * Actions that require passphrase verification
 */
private sealed class InactivityLockAction {
    data object Disable : InactivityLockAction()
    data object Reset : InactivityLockAction()
    data class UpdateTimeframe(val timeframeSec: Int) : InactivityLockAction()
}

/**
 * Time units for duration input
 */
private enum class TimeUnit(val label: String, val seconds: Int) {
    MINUTES("Minutes", 60),
    HOURS("Hours", 3600),
    DAYS("Days", 86400)
}

/**
 * Convert seconds to value and unit
 */
private fun secondsToValueUnit(seconds: Int): Pair<Int, TimeUnit> {
    return when {
        seconds % TimeUnit.DAYS.seconds == 0 -> seconds / TimeUnit.DAYS.seconds to TimeUnit.DAYS
        seconds % TimeUnit.HOURS.seconds == 0 -> seconds / TimeUnit.HOURS.seconds to TimeUnit.HOURS
        else -> seconds / TimeUnit.MINUTES.seconds to TimeUnit.MINUTES
    }
}

/**
 * Convert value and unit to seconds
 */
private fun valueUnitToSeconds(value: Int, unit: TimeUnit): Int {
    return (value * unit.seconds).coerceAtLeast(60)
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

/**
 * Format countdown with urgency awareness
 */
private fun formatCountdown(remainingSec: Int?): String {
    if (remainingSec == null || remainingSec < 0) return "--"
    return formatDuration(remainingSec)
}

/**
 * Get urgency level based on remaining time
 */
private fun getUrgency(remainingSec: Int?): Urgency {
    if (remainingSec == null) return Urgency.NORMAL
    return when {
        remainingSec <= 3600 -> Urgency.CRITICAL  // <= 1 hour
        remainingSec <= 43200 -> Urgency.WARNING  // <= 12 hours
        else -> Urgency.NORMAL
    }
}

private enum class Urgency {
    NORMAL, WARNING, CRITICAL
}

@Composable
private fun InactivityLockContent(
    status: DeadManSwitchStatus?,
    encryptedKeys: List<KeyInfo>,
    isLoading: Boolean,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onConfigure: () -> Unit,
    onResetTimer: () -> Unit
) {
    val isEnabled = status?.enabled == true
    val isPanicked = status?.panicTriggeredAt != null
    val urgency = getUrgency(status?.remainingSec)

    // Header with toggle
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Inactivity Lock",
                style = MaterialTheme.typography.bodyMedium,
                color = TextPrimary
            )
            Text(
                text = if (isPanicked) "Panic triggered"
                       else if (isEnabled) "Lock keys after inactivity"
                       else "Lock keys after inactivity",
                style = MaterialTheme.typography.bodySmall,
                color = if (isPanicked) Danger else TextMuted
            )
        }

        Switch(
            checked = isEnabled,
            onCheckedChange = { checked ->
                if (checked) onEnable() else onDisable()
            },
            enabled = !isLoading && encryptedKeys.isNotEmpty(),
            colors = SwitchDefaults.colors(
                checkedThumbColor = TextPrimary,
                checkedTrackColor = SignetPurple,
                uncheckedThumbColor = TextMuted,
                uncheckedTrackColor = BgTertiary
            )
        )
    }

    // Show details when enabled
    if (isEnabled && !isPanicked) {
        HorizontalDivider(
            color = TextMuted.copy(alpha = 0.2f),
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        // Status row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "Time Remaining",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Text(
                    text = formatCountdown(status?.remainingSec),
                    style = MaterialTheme.typography.titleLarge,
                    color = when (urgency) {
                        Urgency.CRITICAL -> Danger
                        Urgency.WARNING -> Warning
                        Urgency.NORMAL -> Success
                    }
                )
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "Timeframe",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
                Text(
                    text = status?.timeframeSec?.let { formatDuration(it) } ?: "--",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary
                )
            }
        }

        HorizontalDivider(
            color = TextMuted.copy(alpha = 0.2f),
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        // Action buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = onResetTimer,
                enabled = !isLoading,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = SignetPurple
                )
            ) {
                Text("Reset Timer")
            }

            OutlinedButton(
                onClick = onConfigure,
                enabled = !isLoading,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = TextSecondary
                )
            ) {
                Text("Configure")
            }
        }

        Spacer(modifier = Modifier.height(4.dp))
    }

    // Warning if no encrypted keys
    if (encryptedKeys.isEmpty()) {
        Text(
            text = "Requires at least one encrypted key",
            style = MaterialTheme.typography.bodySmall,
            color = Warning,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
    }
}
