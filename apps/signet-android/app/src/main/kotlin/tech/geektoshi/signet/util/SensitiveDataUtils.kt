package tech.geektoshi.signet.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableState

/**
 * Utilities for handling sensitive data like passphrases and private keys.
 */
object SensitiveDataUtils {

    /**
     * Clear a string by overwriting its characters.
     * Note: In Kotlin/JVM, strings are immutable, so this creates a new empty string.
     * The original string content may still be in memory until garbage collected.
     * For truly secure clearing, use CharArray instead.
     */
    fun clearString(value: String): String {
        return ""
    }

    /**
     * Clear a CharArray by overwriting all characters with zeros.
     * This is the preferred method for sensitive data as it actually clears memory.
     */
    fun clearCharArray(chars: CharArray) {
        chars.fill('\u0000')
    }

    /**
     * Clear multiple MutableState<String> values.
     */
    fun clearStates(vararg states: MutableState<String>) {
        states.forEach { it.value = "" }
    }
}

/**
 * Composable effect that clears sensitive state values when the composable is disposed.
 * Use this to ensure passphrases and other sensitive data are cleared when sheets/dialogs close.
 *
 * @param states The MutableState<String> values to clear on dispose
 */
@Composable
fun ClearSensitiveDataOnDispose(vararg states: MutableState<String>) {
    DisposableEffect(Unit) {
        onDispose {
            SensitiveDataUtils.clearStates(*states)
        }
    }
}
