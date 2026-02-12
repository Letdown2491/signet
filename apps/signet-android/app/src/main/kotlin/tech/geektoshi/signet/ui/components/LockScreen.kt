package tech.geektoshi.signet.ui.components

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import tech.geektoshi.signet.ui.theme.BgPrimary
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary

@Composable
fun LockScreen(
    onUnlocked: () -> Unit
) {
    val context = LocalContext.current
    var errorMessage by remember { mutableStateOf<String?>(null) }
    // Use a counter instead of boolean so each button press triggers a new prompt
    var promptTrigger by remember { mutableIntStateOf(0) }

    // Show biometric prompt when trigger changes
    LaunchedEffect(promptTrigger) {
        if (promptTrigger > 0) {
            showBiometricPrompt(
                activity = context as FragmentActivity,
                onSuccess = onUnlocked,
                onError = { error ->
                    errorMessage = error
                }
            )
        }
    }

    // Auto-show prompt on first composition
    LaunchedEffect(Unit) {
        promptTrigger = 1
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgPrimary
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = SignetPurple
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Signet is Locked",
                style = MaterialTheme.typography.headlineSmall,
                color = TextPrimary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Unlock to access your keys",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            errorMessage?.let { error ->
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    errorMessage = null
                    promptTrigger++
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = SignetPurple,
                    contentColor = TextPrimary
                )
            ) {
                Text("Unlock")
            }
        }
    }
}

private fun showBiometricPrompt(
    activity: FragmentActivity,
    onSuccess: () -> Unit,
    onError: (String) -> Unit
) {
    val executor = ContextCompat.getMainExecutor(activity)

    val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            super.onAuthenticationSucceeded(result)
            onSuccess()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            super.onAuthenticationError(errorCode, errString)
            // Don't show error for user cancellation
            if (errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                errorCode != BiometricPrompt.ERROR_CANCELED
            ) {
                onError(errString.toString())
            }
        }

        override fun onAuthenticationFailed() {
            super.onAuthenticationFailed()
            // Don't show error - user can try again
        }
    }

    val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Unlock Signet")
        .setSubtitle("Verify your identity to continue")
        .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
        .build()

    val biometricPrompt = BiometricPrompt(activity, executor, callback)
    biometricPrompt.authenticate(promptInfo)
}
