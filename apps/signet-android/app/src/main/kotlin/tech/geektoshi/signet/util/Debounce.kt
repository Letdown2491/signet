package tech.geektoshi.signet.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Default debounce interval in milliseconds.
 */
private const val DEFAULT_DEBOUNCE_MS = 500L

/**
 * Creates a debounced click handler that prevents rapid repeated clicks.
 *
 * @param debounceMs Minimum time between clicks in milliseconds
 * @param onClick The click handler to debounce
 * @return A debounced click handler
 */
@Composable
fun rememberDebouncedClick(
    debounceMs: Long = DEFAULT_DEBOUNCE_MS,
    onClick: () -> Unit
): () -> Unit {
    var lastClickTime by remember { mutableLongStateOf(0L) }

    return remember(onClick) {
        {
            val currentTime = System.currentTimeMillis()
            if (currentTime - lastClickTime >= debounceMs) {
                lastClickTime = currentTime
                onClick()
            }
        }
    }
}

/**
 * Extension function to create a debounced version of a lambda.
 * Use this for non-Composable contexts.
 */
class ClickDebouncer(
    private val debounceMs: Long = DEFAULT_DEBOUNCE_MS
) {
    private var lastClickTime = 0L

    /**
     * Execute the action if enough time has passed since the last click.
     * @return true if the action was executed, false if it was debounced
     */
    fun debounce(action: () -> Unit): Boolean {
        val currentTime = System.currentTimeMillis()
        return if (currentTime - lastClickTime >= debounceMs) {
            lastClickTime = currentTime
            action()
            true
        } else {
            false
        }
    }

    /**
     * Reset the debouncer state.
     */
    fun reset() {
        lastClickTime = 0L
    }
}
