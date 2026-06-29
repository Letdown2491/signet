package tech.geektoshi.signet.ui.screens.setup

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.R
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.ui.components.QRScannerSheet
import tech.geektoshi.signet.util.ErrorFormatter
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary
import kotlinx.coroutines.launch

@Composable
fun SetupScreen(
    settingsRepository: SettingsRepository,
    onSetupComplete: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var daemonUrl by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var isConnecting by remember { mutableStateOf(false) }
    var showQRScanner by remember { mutableStateOf(false) }

    // QR Scanner Sheet
    if (showQRScanner) {
        QRScannerSheet(
            onScanned = { url ->
                daemonUrl = url
                error = null
            },
            onDismiss = { showQRScanner = false }
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(SignetPurple),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_launcher_foreground),
                contentDescription = "Signet logo",
                modifier = Modifier.size(72.dp),
                colorFilter = ColorFilter.tint(Color.White)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Signet",
            style = MaterialTheme.typography.displayMedium,
            color = SignetPurple
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Remote Signer for Nostr",
            style = MaterialTheme.typography.bodyLarge,
            color = TextSecondary
        )

        Spacer(modifier = Modifier.height(48.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Connect to Server",
                    style = MaterialTheme.typography.titleLarge,
                    color = TextPrimary
                )

                Text(
                    text = "Manage signing requests from your Signet daemon. Enter the URL where your server is running.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary
                )

                OutlinedTextField(
                    value = daemonUrl,
                    onValueChange = {
                        daemonUrl = it
                        error = null
                    },
                    label = { Text("Server URL") },
                    placeholder = { Text("http://your-server") },
                    singleLine = true,
                    enabled = !isConnecting,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
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
                        unfocusedContainerColor = BgTertiary,
                        errorBorderColor = MaterialTheme.colorScheme.error
                    )
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = { showQRScanner = true },
                        enabled = !isConnecting,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = SignetPurple
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.QrCodeScanner,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Scan QR")
                    }

                    Button(
                        onClick = {
                            val url = daemonUrl.trim()
                            if (url.isEmpty()) {
                                error = "Please enter a URL"
                                return@Button
                            }
                            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                                error = "URL must start with http:// or https://"
                                return@Button
                            }
                            scope.launch {
                                isConnecting = true
                                error = null
                                val client = SignetApiClient(url)
                                try {
                                    // Throwing variant so the real cause surfaces (TLS/cert vs
                                    // connection-refused vs timeout) instead of a blanket message.
                                    client.pingHealth()
                                    settingsRepository.setDaemonUrl(url)
                                    onSetupComplete()
                                } catch (e: Exception) {
                                    android.util.Log.e("SignetSetup", "Connect to $url failed", e)
                                    val formatted = ErrorFormatter.format(e)
                                    error = formatted.action?.let { "${formatted.message} — $it" }
                                        ?: formatted.message
                                } finally {
                                    client.close()
                                    isConnecting = false
                                }
                            }
                        },
                        enabled = !isConnecting,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SignetPurple,
                            contentColor = TextPrimary
                        )
                    ) {
                        if (isConnecting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = TextPrimary,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("Connect")
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Need help getting started?",
            style = MaterialTheme.typography.bodyMedium,
            color = SignetPurple,
            textDecoration = TextDecoration.Underline,
            modifier = Modifier.clickable {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Letdown2491/signet"))
                context.startActivity(intent)
            }
        )
    }
}
