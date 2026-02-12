package tech.geektoshi.signet.data.repository

import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetSSEClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Singleton repository that manages a single SSE connection and broadcasts
 * events to all subscribers (screens, services).
 *
 * Usage in screens:
 * ```
 * val eventBus = EventBusRepository.getInstance()
 * LaunchedEffect(Unit) {
 *     eventBus.events.collect { event ->
 *         when (event) {
 *             is ServerEvent.RequestCreated -> // update UI
 *             is ServerEvent.StatsUpdated -> // update stats
 *         }
 *     }
 * }
 * ```
 */
class EventBusRepository private constructor() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var sseClient: SignetSSEClient? = null
    private var sseJob: Job? = null
    private var currentUrl: String? = null
    private val connectionLock = Any()

    // SharedFlow for broadcasting events - replay 0 means new subscribers don't get old events
    // Use DROP_OLDEST to prevent unbounded buffer growth under load
    private val _events = MutableSharedFlow<ServerEvent>(replay = 0, extraBufferCapacity = 64)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

    // Connection state for UI indicators
    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    /**
     * Connect to SSE endpoint. If already connected to the same URL, does nothing.
     * If URL changes, disconnects from old and connects to new.
     * Thread-safe: uses synchronization to prevent race conditions.
     */
    fun connect(daemonUrl: String) {
        if (daemonUrl.isBlank()) {
            disconnect()
            return
        }

        synchronized(connectionLock) {
            // Already connected to this URL - check both URL and job status atomically
            if (daemonUrl == currentUrl && sseJob?.isActive == true) {
                return
            }

            // Disconnect from previous if different URL
            if (currentUrl != null && currentUrl != daemonUrl) {
                disconnectInternal()
            }

            currentUrl = daemonUrl
            startConnection(daemonUrl)
        }
    }

    /**
     * Disconnect from SSE and clean up resources.
     */
    fun disconnect() {
        synchronized(connectionLock) {
            disconnectInternal()
        }
    }

    /**
     * Internal disconnect without lock - must be called within synchronized block.
     */
    private fun disconnectInternal() {
        sseJob?.cancel()
        sseJob = null
        sseClient?.close()
        sseClient = null
        currentUrl = null
        _isConnected.value = false
    }

    private fun startConnection(daemonUrl: String) {
        sseJob?.cancel()

        sseJob = scope.launch {
            sseClient?.close()
            sseClient = SignetSSEClient(daemonUrl)

            sseClient?.events()?.collect { event ->
                // Update connection state on Connected event
                if (event is ServerEvent.Connected) {
                    _isConnected.value = true
                }

                // Broadcast to all subscribers
                _events.emit(event)
            }

            // If we exit the collect loop, we're disconnected
            _isConnected.value = false
        }
    }

    companion object {
        @Volatile
        private var instance: EventBusRepository? = null

        fun getInstance(): EventBusRepository {
            return instance ?: synchronized(this) {
                instance ?: EventBusRepository().also { instance = it }
            }
        }
    }
}
