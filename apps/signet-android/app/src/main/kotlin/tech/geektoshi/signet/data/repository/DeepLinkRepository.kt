package tech.geektoshi.signet.data.repository

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Singleton repository for handling deep link URIs.
 * Used to pass nostrconnect:// URIs from MainActivity to SignetNavHost.
 */
object DeepLinkRepository {
    private val _pendingUri = MutableStateFlow<String?>(null)
    val pendingUri: StateFlow<String?> = _pendingUri.asStateFlow()

    /**
     * Set a pending URI to be consumed by SignetNavHost.
     */
    fun setPendingUri(uri: String) {
        _pendingUri.value = uri
    }

    /**
     * Clear the pending URI after it has been handled.
     */
    fun clearPendingUri() {
        _pendingUri.value = null
    }

    /**
     * Check if there's a pending URI without consuming it.
     */
    fun hasPendingUri(): Boolean = _pendingUri.value != null
}
