package tech.geektoshi.signet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.Warning
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Bottom sheet for suspending all apps at once with duration options.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuspendAllAppsSheet(
    appCount: Int,
    daemonUrl: String,
    onDismiss: () -> Unit,
    onSuccess: (suspendedCount: Int) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var suspendType by remember { mutableStateOf("indefinite") }
    var suspendDate by remember { mutableStateOf(LocalDate.now().plusDays(1)) }
    var suspendTime by remember { mutableStateOf(LocalTime.of(12, 0)) }

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
                text = "Suspend All Apps",
                style = MaterialTheme.typography.headlineSmall,
                color = TextPrimary
            )

            Text(
                text = "This will suspend $appCount active app${if (appCount != 1) "s" else ""}, temporarily blocking all signing requests.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            // Suspend Duration
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

            // Error message
            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger
                )
            }

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
                                val until = if (suspendType == "until") {
                                    suspendDate.atTime(suspendTime)
                                        .atZone(ZoneId.systemDefault())
                                        .toInstant()
                                        .toString()
                                } else null
                                val result = client.suspendAllApps(until)
                                client.close()
                                if (result.ok) {
                                    onSuccess(result.suspendedCount)
                                    onDismiss()
                                } else {
                                    error = result.error ?: "Failed to suspend apps"
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Failed to suspend apps"
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
                    Text(if (isLoading) "Suspending..." else "Suspend All")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
