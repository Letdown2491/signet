package tech.geektoshi.signet.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.util.ClearSensitiveDataOnDispose
import tech.geektoshi.signet.util.InputValidation
import tech.geektoshi.signet.util.rememberDebouncedClick
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateKeySheet(
    daemonUrl: String,
    onDismiss: () -> Unit,
    onKeyCreated: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    var keyName by remember { mutableStateOf("") }
    val passphraseState = remember { mutableStateOf("") }
    var passphrase by passphraseState
    val confirmPassphraseState = remember { mutableStateOf("") }
    var confirmPassphrase by confirmPassphraseState
    var usePassphrase by remember { mutableStateOf(false) }
    var encryptionFormat by remember { mutableStateOf("nip49") }  // 'nip49' | 'legacy'
    var importExisting by remember { mutableStateOf(false) }
    val nsecState = remember { mutableStateOf("") }
    var nsec by nsecState

    // Detect ncryptsec import
    val isNcryptsecImport = nsec.trim().startsWith("ncryptsec1")

    // Clear sensitive data when sheet is dismissed
    ClearSensitiveDataOnDispose(passphraseState, confirmPassphraseState, nsecState)

    val passphraseMatch = passphrase == confirmPassphrase

    // Real-time validation
    val keyNameValidation = if (keyName.isNotBlank()) InputValidation.validateKeyName(keyName) else null
    val nsecValidation = if (importExisting && nsec.isNotBlank()) InputValidation.validateNsec(nsec) else null

    // For ncryptsec import, we only need passphrase verification (no confirm)
    val canCreate = keyName.isNotBlank() &&
            (keyNameValidation?.isValid ?: false) &&
            (if (isNcryptsecImport) passphrase.isNotBlank() else (!usePassphrase || (passphrase.isNotBlank() && passphraseMatch))) &&
            (!importExisting || (nsec.isNotBlank() && (nsecValidation?.isValid ?: true)))

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
            Text(
                text = "Create New Key",
                style = MaterialTheme.typography.headlineSmall,
                color = TextPrimary
            )

            HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

            // Key Name
            Text(
                text = "Key Name",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )

            OutlinedTextField(
                value = keyName,
                onValueChange = { keyName = it },
                placeholder = { Text("Enter a name for this key") },
                singleLine = true,
                isError = keyNameValidation?.isValid == false,
                supportingText = keyNameValidation?.errorMessage?.let { { Text(it, color = Danger) } },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = if (keyNameValidation?.isValid == false) Danger else SignetPurple,
                    unfocusedBorderColor = if (keyNameValidation?.isValid == false) Danger else BorderDefault,
                    cursorColor = SignetPurple,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedPlaceholderColor = TextMuted,
                    unfocusedPlaceholderColor = TextMuted,
                    focusedContainerColor = BgTertiary,
                    unfocusedContainerColor = BgTertiary
                )
            )

            // Import existing key option
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Checkbox(
                    checked = importExisting,
                    onCheckedChange = { importExisting = it },
                    colors = CheckboxDefaults.colors(
                        checkedColor = SignetPurple,
                        uncheckedColor = TextMuted
                    )
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Import existing key",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextPrimary
                    )
                    Text(
                        text = "Import from nsec",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                }
            }

            if (importExisting) {
                OutlinedTextField(
                    value = nsec,
                    onValueChange = { nsec = it },
                    placeholder = { Text("nsec1... or ncryptsec1...") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    isError = nsecValidation?.isValid == false,
                    supportingText = if (isNcryptsecImport) {
                        { Text("NIP-49 encrypted key detected", color = SignetPurple) }
                    } else {
                        nsecValidation?.errorMessage?.let { { Text(it, color = Danger) } }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = if (nsecValidation?.isValid == false) Danger else SignetPurple,
                        unfocusedBorderColor = if (nsecValidation?.isValid == false) Danger else BorderDefault,
                        cursorColor = SignetPurple,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedPlaceholderColor = TextMuted,
                        unfocusedPlaceholderColor = TextMuted,
                        focusedContainerColor = BgTertiary,
                        unfocusedContainerColor = BgTertiary
                    )
                )

                // Show passphrase field for ncryptsec verification
                if (isNcryptsecImport) {
                    OutlinedTextField(
                        value = passphrase,
                        onValueChange = { passphrase = it },
                        placeholder = { Text("Enter passphrase to verify") },
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
            }

            // Only show password protection option if not importing ncryptsec
            if (!isNcryptsecImport) {
                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                // Password protection option
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = usePassphrase,
                        onCheckedChange = { usePassphrase = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = SignetPurple,
                            uncheckedColor = TextMuted
                        )
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Password protect",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary
                        )
                        Text(
                            text = "Encrypt key with a passphrase",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                }

                if (usePassphrase) {
                    // Encryption format selection
                    Text(
                        text = "Encryption Format",
                        style = MaterialTheme.typography.titleSmall,
                        color = TextSecondary,
                        modifier = Modifier.padding(top = 8.dp)
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = encryptionFormat == "nip49",
                                onCheckedChange = { if (it) encryptionFormat = "nip49" },
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
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = encryptionFormat == "legacy",
                                onCheckedChange = { if (it) encryptionFormat = "legacy" },
                                colors = CheckboxDefaults.colors(
                                    checkedColor = SignetPurple,
                                    uncheckedColor = TextMuted
                                )
                            )
                            Text("Legacy", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                        }
                    }

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

                    OutlinedTextField(
                        value = confirmPassphrase,
                        onValueChange = { confirmPassphrase = it },
                        placeholder = { Text("Confirm passphrase") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = confirmPassphrase.isNotEmpty() && !passphraseMatch,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = if (passphraseMatch) SignetPurple else Danger,
                            unfocusedBorderColor = if (confirmPassphrase.isEmpty() || passphraseMatch) BorderDefault else Danger,
                            cursorColor = SignetPurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedPlaceholderColor = TextMuted,
                            unfocusedPlaceholderColor = TextMuted,
                            focusedContainerColor = BgTertiary,
                            unfocusedContainerColor = BgTertiary
                        )
                    )

                    if (confirmPassphrase.isNotEmpty() && !passphraseMatch) {
                        Text(
                            text = "Passphrases do not match",
                            style = MaterialTheme.typography.bodySmall,
                            color = Danger
                        )
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
                                // Determine encryption type
                                val encryption = when {
                                    isNcryptsecImport -> "nip49"  // Server detects ncryptsec, passphrase for verification
                                    usePassphrase -> encryptionFormat
                                    else -> "none"
                                }
                                val result = client.createKey(
                                    keyName = keyName,
                                    passphrase = if (isNcryptsecImport || usePassphrase) passphrase else null,
                                    confirmPassphrase = if (!isNcryptsecImport && usePassphrase) confirmPassphrase else null,
                                    nsec = if (importExisting) nsec else null,
                                    encryption = encryption
                                )
                                client.close()
                                if (result.ok) {
                                    onKeyCreated()
                                    onDismiss()
                                } else {
                                    error = result.error ?: "Failed to create key"
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Failed to create key"
                            } finally {
                                isLoading = false
                            }
                        }
                    },
                    enabled = !isLoading && canCreate,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = SignetPurple,
                        contentColor = TextPrimary
                    )
                ) {
                    Text(if (importExisting) "Import" else "Create")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
