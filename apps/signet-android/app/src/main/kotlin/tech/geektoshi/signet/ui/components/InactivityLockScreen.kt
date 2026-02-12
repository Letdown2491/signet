package tech.geektoshi.signet.ui.components

import android.widget.Toast
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.data.model.KeyInfo
import tech.geektoshi.signet.util.ClearSensitiveDataOnDispose
import tech.geektoshi.signet.ui.theme.BgPrimary
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Full-screen overlay shown when the inactivity lock (panic) has been triggered.
 * All keys are locked and apps are suspended - user must unlock to recover.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InactivityLockScreen(
    triggeredAt: Long?,
    keys: List<KeyInfo>,
    onRecover: suspend (keyName: String, passphrase: String, resumeApps: Boolean) -> Result<Unit>
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Get encrypted locked keys
    val lockedKeys = remember(keys) {
        keys.filter { it.status == "locked" && it.isEncrypted }
    }

    var selectedKeyName by remember(lockedKeys) {
        mutableStateOf(lockedKeys.firstOrNull()?.name ?: "")
    }
    val passphraseState = remember { mutableStateOf("") }
    var passphrase by passphraseState
    var resumeApps by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }

    // Clear sensitive data when screen is dismissed
    ClearSensitiveDataOnDispose(passphraseState)

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgPrimary
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                // Warning icon with pulse effect
                Box(
                    modifier = Modifier
                        .size(80.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = Danger
                    )
                }

                // Title
                Text(
                    text = "Inactivity Lock Triggered",
                    style = MaterialTheme.typography.headlineSmall,
                    color = Danger,
                    textAlign = TextAlign.Center
                )

                // Description
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "All keys have been locked and all apps suspended due to inactivity.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                        textAlign = TextAlign.Center
                    )

                    triggeredAt?.let { timestamp ->
                        val dateFormat = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
                        val formattedDate = dateFormat.format(Date(timestamp * 1000))
                        Text(
                            text = "Triggered $formattedDate",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted,
                            textAlign = TextAlign.Center
                        )
                    }
                }

                // Recovery card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = BgSecondary)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // Card header
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Key,
                                contentDescription = null,
                                tint = TextPrimary,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "Unlock a Key to Recover",
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary
                            )
                        }

                        if (lockedKeys.isEmpty()) {
                            // No locked keys available
                            Text(
                                text = "No locked keys available. All keys may already be unlocked, or no encrypted keys exist.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextMuted,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        } else {
                            // Key selector - dropdown for multiple keys, static text for single key
                            if (lockedKeys.size > 1) {
                                var keyDropdownExpanded by remember { mutableStateOf(false) }

                                ExposedDropdownMenuBox(
                                    expanded = keyDropdownExpanded,
                                    onExpandedChange = { if (!isSubmitting) keyDropdownExpanded = it }
                                ) {
                                    OutlinedTextField(
                                        value = selectedKeyName,
                                        onValueChange = {},
                                        readOnly = true,
                                        label = { Text("Key") },
                                        trailingIcon = {
                                            Icon(
                                                imageVector = Icons.Default.KeyboardArrowDown,
                                                contentDescription = null,
                                                tint = TextMuted
                                            )
                                        },
                                        enabled = !isSubmitting,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .menuAnchor(MenuAnchorType.PrimaryNotEditable),
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
                                        expanded = keyDropdownExpanded,
                                        onDismissRequest = { keyDropdownExpanded = false }
                                    ) {
                                        lockedKeys.forEach { key ->
                                            DropdownMenuItem(
                                                text = { Text(key.name) },
                                                onClick = {
                                                    selectedKeyName = key.name
                                                    keyDropdownExpanded = false
                                                }
                                            )
                                        }
                                    }
                                }
                            } else {
                                // Show which key is being used (single key)
                                Card(
                                    colors = CardDefaults.cardColors(containerColor = BgTertiary)
                                ) {
                                    Text(
                                        text = "Unlocking key: ${lockedKeys.first().name}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = TextSecondary,
                                        modifier = Modifier.padding(12.dp)
                                    )
                                }
                            }

                            // Passphrase input
                            OutlinedTextField(
                                value = passphrase,
                                onValueChange = {
                                    passphrase = it
                                    error = null
                                },
                                label = { Text("Passphrase") },
                                placeholder = { Text("Enter your key passphrase") },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                isError = error != null,
                                supportingText = error?.let { { Text(it, color = Danger) } },
                                enabled = !isSubmitting,
                                modifier = Modifier.fillMaxWidth(),
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

                            // Resume apps checkbox
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = resumeApps,
                                    onCheckedChange = { resumeApps = it },
                                    enabled = !isSubmitting,
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = SignetPurple,
                                        uncheckedColor = TextMuted,
                                        checkmarkColor = TextPrimary
                                    )
                                )
                                Text(
                                    text = "Also resume all suspended apps",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = TextSecondary
                                )
                            }

                            // Submit button
                            Button(
                                onClick = {
                                    if (selectedKeyName.isBlank() || passphrase.isBlank()) return@Button

                                    scope.launch {
                                        isSubmitting = true
                                        error = null

                                        val result = onRecover(selectedKeyName, passphrase, resumeApps)

                                        result.fold(
                                            onSuccess = {
                                                Toast.makeText(context, "Recovery successful", Toast.LENGTH_SHORT).show()
                                                // Screen will be dismissed by parent when panic state clears
                                            },
                                            onFailure = { e ->
                                                error = e.message ?: "Invalid passphrase. Please try again."
                                            }
                                        )

                                        isSubmitting = false
                                    }
                                },
                                enabled = !isSubmitting && passphrase.isNotBlank() && selectedKeyName.isNotBlank(),
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = SignetPurple,
                                    contentColor = TextPrimary
                                )
                            ) {
                                if (isSubmitting) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        color = TextPrimary,
                                        strokeWidth = 2.dp
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Recovering...")
                                } else {
                                    Text("Unlock & Recover")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
