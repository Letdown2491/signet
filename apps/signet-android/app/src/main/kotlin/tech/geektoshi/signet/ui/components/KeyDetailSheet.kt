package tech.geektoshi.signet.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.util.ClearSensitiveDataOnDispose
import tech.geektoshi.signet.ui.theme.BgPrimary
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
fun KeyDetailSheet(
    key: KeyInfo,
    daemonUrl: String,
    onDismiss: () -> Unit,
    onActionComplete: () -> Unit
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var isLocking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showUnlock by remember { mutableStateOf(false) }
    val passphraseState = remember { mutableStateOf("") }
    var passphrase by passphraseState
    var showBunkerURISheet by remember { mutableStateOf(false) }

    // Encrypt form state
    var showEncryptForm by remember { mutableStateOf(false) }
    var encryptFormat by remember { mutableStateOf("nip49") }
    val encryptPassphraseState = remember { mutableStateOf("") }
    var encryptPassphrase by encryptPassphraseState
    val confirmEncryptPassphraseState = remember { mutableStateOf("") }
    var confirmEncryptPassphrase by confirmEncryptPassphraseState
    var isEncrypting by remember { mutableStateOf(false) }

    // Migrate form state
    var showMigrateForm by remember { mutableStateOf(false) }
    val migratePassphraseState = remember { mutableStateOf("") }
    var migratePassphrase by migratePassphraseState
    var isMigrating by remember { mutableStateOf(false) }

    // Export form state
    var showExportForm by remember { mutableStateOf(false) }
    var exportFormat by remember { mutableStateOf("nsec") }
    val currentPassphraseState = remember { mutableStateOf("") }
    var currentPassphrase by currentPassphraseState
    val exportPassphraseState = remember { mutableStateOf("") }
    var exportPassphrase by exportPassphraseState
    val confirmExportPassphraseState = remember { mutableStateOf("") }
    var confirmExportPassphrase by confirmExportPassphraseState
    var isExporting by remember { mutableStateOf(false) }
    var exportedKey by remember { mutableStateOf<String?>(null) }
    var exportedFormat by remember { mutableStateOf<String?>(null) }

    // Clear sensitive data when sheet is dismissed
    ClearSensitiveDataOnDispose(
        passphraseState,
        encryptPassphraseState,
        confirmEncryptPassphraseState,
        migratePassphraseState,
        currentPassphraseState,
        exportPassphraseState,
        confirmExportPassphraseState
    )

    val isLocked = key.status.lowercase() == "locked"
    val isOnline = key.status.lowercase() == "online"

    // Bunker URI Sheet
    if (showBunkerURISheet && key.npub != null) {
        BunkerURISheet(
            keyName = key.name,
            daemonUrl = daemonUrl,
            onDismiss = { showBunkerURISheet = false }
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
                            .size(10.dp)
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
                        style = MaterialTheme.typography.headlineSmall,
                        color = TextPrimary
                    )
                }
                EncryptionBadge(encryptionFormat = key.encryptionFormat)
            }

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // npub section
            if (key.npub != null) {
                CopyableField(
                    label = "Public Key (npub)",
                    value = key.npub,
                    context = context
                )
            }

            // Bunker URI section (only for online keys)
            if (isOnline && key.pubkey != null) {
                BunkerURIField(
                    pubkey = key.pubkey,
                    onClick = { showBunkerURISheet = true }
                )
            }

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Stats
            Text(
                text = "Statistics",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatColumn(label = "Connected Apps", value = key.userCount.toString())
                StatColumn(label = "Tokens", value = key.tokenCount.toString())
                StatColumn(label = "Requests", value = key.requestCount.toString())
            }

            // Additional info
            if (key.lastUsedAt != null) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))
                InfoRow(label = "Last Used", value = formatDateTime(key.lastUsedAt))
            }

            InfoRow(
                label = "Encryption",
                value = when (key.encryptionFormat) {
                    "nip49" -> "NIP-49 (recommended)"
                    "legacy" -> "Legacy (AES-256-GCM)"
                    else -> "Not encrypted"
                }
            )

            // Error message
            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger
                )
            }

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Unlock section for locked keys
            if (isLocked) {
                if (showUnlock) {
                    Text(
                        text = "Unlock Key",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
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

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                showUnlock = false
                                passphrase = ""
                            },
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
                                        val result = client.unlockKey(key.name, passphrase)
                                        client.close()
                                        if (result.ok) {
                                            onActionComplete()
                                            onDismiss()
                                        } else {
                                            error = result.error ?: "Failed to unlock"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to unlock"
                                    } finally {
                                        isLoading = false
                                    }
                                }
                            },
                            enabled = !isLoading && passphrase.isNotBlank(),
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignetPurple,
                                contentColor = TextPrimary
                            )
                        ) {
                            Text("Unlock")
                        }
                    }
                } else {
                    Button(
                        onClick = { showUnlock = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SignetPurple,
                            contentColor = TextPrimary
                        )
                    ) {
                        Text("Unlock Key")
                    }
                }
            }

            // Lock button for online encrypted keys
            if (isOnline && key.isEncrypted && !showDeleteConfirm) {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            isLocking = true
                            error = null
                            try {
                                val client = SignetApiClient(daemonUrl)
                                val result = client.lockKey(key.name)
                                client.close()
                                if (result.ok) {
                                    onActionComplete()
                                    onDismiss()
                                } else {
                                    error = result.error ?: "Failed to lock"
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Failed to lock"
                            } finally {
                                isLocking = false
                            }
                        }
                    },
                    enabled = !isLocking && !isLoading,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Warning
                    )
                ) {
                    if (isLocking) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = Warning,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Text(
                        text = if (isLocking) "Locking..." else "Lock Key",
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
            }

            // Encrypt section (for unencrypted online keys)
            if (isOnline && !key.isEncrypted && !showDeleteConfirm && !showUnlock) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                if (showEncryptForm) {
                    Text(
                        text = "Encrypt Key",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    Text(
                        text = "Add password protection to this key",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )

                    // Format selection
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = encryptFormat == "nip49",
                                onCheckedChange = { if (it) encryptFormat = "nip49" },
                                colors = CheckboxDefaults.colors(
                                    checkedColor = SignetPurple,
                                    uncheckedColor = TextMuted
                                )
                            )
                            Column {
                                Text("NIP-49", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                                Text("Recommended", style = MaterialTheme.typography.bodySmall, color = SignetPurple)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = encryptFormat == "legacy",
                                onCheckedChange = { if (it) encryptFormat = "legacy" },
                                colors = CheckboxDefaults.colors(
                                    checkedColor = SignetPurple,
                                    uncheckedColor = TextMuted
                                )
                            )
                            Text("Legacy", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                        }
                    }

                    OutlinedTextField(
                        value = encryptPassphrase,
                        onValueChange = { encryptPassphrase = it },
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

                    OutlinedTextField(
                        value = confirmEncryptPassphrase,
                        onValueChange = { confirmEncryptPassphrase = it },
                        placeholder = { Text("Confirm passphrase") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = confirmEncryptPassphrase.isNotEmpty() && encryptPassphrase != confirmEncryptPassphrase,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = if (encryptPassphrase == confirmEncryptPassphrase) SignetPurple else Danger,
                            unfocusedBorderColor = if (confirmEncryptPassphrase.isEmpty() || encryptPassphrase == confirmEncryptPassphrase) BorderDefault else Danger,
                            cursorColor = SignetPurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedPlaceholderColor = TextMuted,
                            unfocusedPlaceholderColor = TextMuted,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )

                    if (confirmEncryptPassphrase.isNotEmpty() && encryptPassphrase != confirmEncryptPassphrase) {
                        Text(
                            text = "Passphrases do not match",
                            style = MaterialTheme.typography.bodySmall,
                            color = Danger
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                showEncryptForm = false
                                encryptPassphrase = ""
                                confirmEncryptPassphrase = ""
                            },
                            enabled = !isEncrypting,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Cancel")
                        }

                        Button(
                            onClick = {
                                scope.launch {
                                    isEncrypting = true
                                    error = null
                                    try {
                                        val client = SignetApiClient(daemonUrl)
                                        val result = client.encryptKey(
                                            keyName = key.name,
                                            encryption = encryptFormat,
                                            passphrase = encryptPassphrase,
                                            confirmPassphrase = confirmEncryptPassphrase
                                        )
                                        client.close()
                                        if (result.ok) {
                                            onActionComplete()
                                            onDismiss()
                                        } else {
                                            error = result.error ?: "Failed to encrypt"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to encrypt"
                                    } finally {
                                        isEncrypting = false
                                    }
                                }
                            },
                            enabled = !isEncrypting && encryptPassphrase.isNotBlank() && encryptPassphrase == confirmEncryptPassphrase,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignetPurple,
                                contentColor = TextPrimary
                            )
                        ) {
                            if (isEncrypting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    color = TextPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text("Encrypt")
                            }
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = { showEncryptForm = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = SignetPurple
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "Add Password Protection",
                            modifier = Modifier.padding(start = 8.dp)
                        )
                    }
                }
            }

            // Migrate section (for legacy-encrypted online keys)
            if (isOnline && key.encryptionFormat == "legacy" && !showDeleteConfirm && !showUnlock) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                if (showMigrateForm) {
                    Text(
                        text = "Migrate to NIP-49",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    Text(
                        text = "Upgrade to the recommended encryption format",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )

                    OutlinedTextField(
                        value = migratePassphrase,
                        onValueChange = { migratePassphrase = it },
                        placeholder = { Text("Enter current passphrase") },
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

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                showMigrateForm = false
                                migratePassphrase = ""
                            },
                            enabled = !isMigrating,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Cancel")
                        }

                        Button(
                            onClick = {
                                scope.launch {
                                    isMigrating = true
                                    error = null
                                    try {
                                        val client = SignetApiClient(daemonUrl)
                                        val result = client.migrateKeyToNip49(key.name, migratePassphrase)
                                        client.close()
                                        if (result.ok) {
                                            onActionComplete()
                                            onDismiss()
                                        } else {
                                            error = result.error ?: "Failed to migrate"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to migrate"
                                    } finally {
                                        isMigrating = false
                                    }
                                }
                            },
                            enabled = !isMigrating && migratePassphrase.isNotBlank(),
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignetPurple,
                                contentColor = TextPrimary
                            )
                        ) {
                            if (isMigrating) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    color = TextPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text("Migrate")
                            }
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = { showMigrateForm = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = SignetPurple
                        )
                    ) {
                        Text("Migrate to NIP-49")
                    }
                }
            }

            // Export section (for online keys)
            if (isOnline && !showDeleteConfirm && !showUnlock) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                if (exportedKey != null) {
                    // Show exported key
                    Text(
                        text = "Exported Key",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    Text(
                        text = if (exportedFormat == "ncryptsec") "NIP-49 encrypted (ncryptsec)" else "Plain secret key (nsec)",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (exportedFormat == "nsec") Warning else SignetPurple
                    )

                    if (exportedFormat == "nsec") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    color = Danger.copy(alpha = 0.1f),
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .padding(12.dp)
                        ) {
                            Text(
                                text = "This is your unencrypted private key. Anyone with access to this key can sign as you. Store it securely.",
                                style = MaterialTheme.typography.bodySmall,
                                color = Danger
                            )
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                color = BgSecondary,
                                shape = RoundedCornerShape(8.dp)
                            )
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = exportedKey!!.take(20) + "..." + exportedKey!!.takeLast(8),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(
                            onClick = {
                                copyToClipboard(context, "Exported Key", exportedKey!!)
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = "Copy",
                                tint = SignetPurple,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    Button(
                        onClick = {
                            exportedKey = null
                            exportedFormat = null
                            showExportForm = false
                            currentPassphrase = ""
                            exportPassphrase = ""
                            confirmExportPassphrase = ""
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SignetPurple,
                            contentColor = TextPrimary
                        )
                    ) {
                        Text("Done")
                    }
                } else if (showExportForm) {
                    Text(
                        text = "Export Key",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimary
                    )

                    // Format selection
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = exportFormat == "nsec",
                                onCheckedChange = { if (it) exportFormat = "nsec" },
                                colors = CheckboxDefaults.colors(
                                    checkedColor = SignetPurple,
                                    uncheckedColor = TextMuted
                                )
                            )
                            Column {
                                Text("nsec", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                                Text("Plain text", style = MaterialTheme.typography.bodySmall, color = Warning)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = exportFormat == "nip49",
                                onCheckedChange = { if (it) exportFormat = "nip49" },
                                colors = CheckboxDefaults.colors(
                                    checkedColor = SignetPurple,
                                    uncheckedColor = TextMuted
                                )
                            )
                            Column {
                                Text("ncryptsec", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                                Text("NIP-49 encrypted", style = MaterialTheme.typography.bodySmall, color = SignetPurple)
                            }
                        }
                    }

                    // Current passphrase (for encrypted keys)
                    if (key.isEncrypted) {
                        OutlinedTextField(
                            value = currentPassphrase,
                            onValueChange = { currentPassphrase = it },
                            placeholder = { Text("Current passphrase") },
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

                    // Export passphrase (for nip49 format)
                    if (exportFormat == "nip49") {
                        OutlinedTextField(
                            value = exportPassphrase,
                            onValueChange = { exportPassphrase = it },
                            placeholder = { Text("Export passphrase") },
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

                        OutlinedTextField(
                            value = confirmExportPassphrase,
                            onValueChange = { confirmExportPassphrase = it },
                            placeholder = { Text("Confirm export passphrase") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            isError = confirmExportPassphrase.isNotEmpty() && exportPassphrase != confirmExportPassphrase,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = if (exportPassphrase == confirmExportPassphrase) SignetPurple else Danger,
                                unfocusedBorderColor = if (confirmExportPassphrase.isEmpty() || exportPassphrase == confirmExportPassphrase) BorderDefault else Danger,
                                cursorColor = SignetPurple,
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary,
                                focusedPlaceholderColor = TextMuted,
                                unfocusedPlaceholderColor = TextMuted,
                                focusedContainerColor = BgTertiary,
                                unfocusedContainerColor = BgTertiary
                            )
                        )

                        if (confirmExportPassphrase.isNotEmpty() && exportPassphrase != confirmExportPassphrase) {
                            Text(
                                text = "Passphrases do not match",
                                style = MaterialTheme.typography.bodySmall,
                                color = Danger
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                showExportForm = false
                                currentPassphrase = ""
                                exportPassphrase = ""
                                confirmExportPassphrase = ""
                            },
                            enabled = !isExporting,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Cancel")
                        }

                        Button(
                            onClick = {
                                scope.launch {
                                    isExporting = true
                                    error = null
                                    try {
                                        val client = SignetApiClient(daemonUrl)
                                        val result = client.exportKey(
                                            keyName = key.name,
                                            format = exportFormat,
                                            currentPassphrase = if (key.isEncrypted) currentPassphrase else null,
                                            exportPassphrase = if (exportFormat == "nip49") exportPassphrase else null,
                                            confirmExportPassphrase = if (exportFormat == "nip49") confirmExportPassphrase else null
                                        )
                                        client.close()
                                        if (result.ok && result.key != null) {
                                            exportedKey = result.key
                                            exportedFormat = result.format
                                        } else {
                                            error = result.error ?: "Failed to export"
                                        }
                                    } catch (e: Exception) {
                                        error = e.message ?: "Failed to export"
                                    } finally {
                                        isExporting = false
                                    }
                                }
                            },
                            enabled = !isExporting &&
                                    (!key.isEncrypted || currentPassphrase.isNotBlank()) &&
                                    (exportFormat != "nip49" || (exportPassphrase.isNotBlank() && exportPassphrase == confirmExportPassphrase)),
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignetPurple,
                                contentColor = TextPrimary
                            )
                        ) {
                            if (isExporting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    color = TextPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text("Export")
                            }
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = { showExportForm = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = SignetPurple
                        )
                    ) {
                        Text("Export Key")
                    }
                }
            }

            // Delete confirmation
            if (showDeleteConfirm) {
                Text(
                    text = "Are you sure you want to delete this key? This action cannot be undone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextPrimary
                )

                if (key.isEncrypted) {
                    OutlinedTextField(
                        value = passphrase,
                        onValueChange = { passphrase = it },
                        placeholder = { Text("Enter passphrase to confirm") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Danger,
                            unfocusedBorderColor = BorderDefault,
                            cursorColor = Danger,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedPlaceholderColor = TextMuted,
                            unfocusedPlaceholderColor = TextMuted,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            showDeleteConfirm = false
                            passphrase = ""
                        },
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
                                    val result = client.deleteKey(
                                        keyName = key.name,
                                        passphrase = if (key.isEncrypted) passphrase else null
                                    )
                                    client.close()
                                    if (result.ok) {
                                        onActionComplete()
                                        onDismiss()
                                    } else {
                                        error = result.error ?: "Failed to delete"
                                    }
                                } catch (e: Exception) {
                                    error = e.message ?: "Failed to delete"
                                } finally {
                                    isLoading = false
                                }
                            }
                        },
                        enabled = !isLoading && (!key.isEncrypted || passphrase.isNotBlank()),
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Danger,
                            contentColor = TextPrimary
                        )
                    ) {
                        Text("Delete")
                    }
                }
            } else if (!showUnlock) {
                OutlinedButton(
                    onClick = { showDeleteConfirm = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Danger
                    )
                ) {
                    Text("Delete Key")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun EncryptionBadge(encryptionFormat: String) {
    val (color, label) = when (encryptionFormat) {
        "nip49" -> Success to "NIP-49"
        "legacy" -> Warning to "Legacy"
        else -> Warning to "Unprotected"
    }

    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = color
    )
}

@Composable
private fun CopyableField(
    label: String,
    value: String,
    context: Context
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = TextMuted
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            IconButton(
                onClick = {
                    copyToClipboard(context, label, value)
                }
            ) {
                Icon(
                    imageVector = Icons.Default.ContentCopy,
                    contentDescription = "Copy",
                    tint = SignetPurple,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun BunkerURIField(
    pubkey: String,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = "Bunker URI",
            style = MaterialTheme.typography.labelMedium,
            color = TextMuted
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "bunker://${pubkey.take(16)}...",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = onClick) {
                Icon(
                    imageVector = Icons.Default.QrCode,
                    contentDescription = "Show QR code",
                    tint = SignetPurple,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun StatColumn(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineMedium,
            color = SignetPurple
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted
        )
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

private fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText(label, text)
    clipboard.setPrimaryClip(clip)
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
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
