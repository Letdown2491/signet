package tech.geektoshi.signet.service

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import tech.geektoshi.signet.MainActivity
import tech.geektoshi.signet.R
import tech.geektoshi.signet.SignetApplication
import tech.geektoshi.signet.data.api.ServerEvent
import tech.geektoshi.signet.data.api.SignetApiClient
import tech.geektoshi.signet.data.model.DeadManSwitchStatus
import tech.geektoshi.signet.data.repository.EventBusRepository
import tech.geektoshi.signet.data.repository.SettingsRepository
import tech.geektoshi.signet.util.UiConstants
import tech.geektoshi.signet.util.getMethodLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Foreground service that maintains SSE connection to the Signet daemon.
 * Provides real-time notifications for pending signing requests.
 */
class SignetService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var eventJob: Job? = null
    private var countdownJob: Job? = null
    @Volatile private var pendingCount = 0
    private val isConnected = AtomicBoolean(false)
    private val eventBus = EventBusRepository.getInstance()

    // Debounce notification updates (minimum 500ms between updates)
    private val lastNotificationUpdate = AtomicLong(0L)
    private val notificationDebounceMs = 500L

    // Inactivity lock state
    private var deadManSwitchStatus: DeadManSwitchStatus? = null
    private var lastWarningLevel: WarningLevel = WarningLevel.NONE
    private var apiClient: SignetApiClient? = null

    private enum class WarningLevel {
        NONE, TWELVE_HOURS, ONE_HOUR, PANIC
    }

    override fun onCreate() {
        super.onCreate()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundWithNotification()
        startSSEConnection()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        eventJob?.cancel()
        countdownJob?.cancel()
        apiClient?.close()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun startForegroundWithNotification() {
        val notification = createServiceNotification(ConnectionState.CONNECTING)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                SignetApplication.SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(SignetApplication.SERVICE_NOTIFICATION_ID, notification)
        }
    }

    private fun startSSEConnection() {
        eventJob?.cancel()
        countdownJob?.cancel()

        eventJob = serviceScope.launch {
            val settingsRepository = SettingsRepository(applicationContext)
            val daemonUrl = settingsRepository.daemonUrl.first()

            if (daemonUrl.isBlank()) {
                updateServiceNotification(ConnectionState.DISCONNECTED)
                return@launch
            }

            // Create API client for fetching dead man switch status
            apiClient = SignetApiClient(daemonUrl)

            // Fetch initial dead man switch status
            try {
                deadManSwitchStatus = apiClient?.getDeadManSwitchStatus()
                checkWarningThresholds()
            } catch (e: Exception) {
                // Ignore errors on initial fetch
            }

            // Start countdown ticker for updating remaining time
            startCountdownTicker()

            // Connect using shared EventBusRepository
            eventBus.connect(daemonUrl)

            // Subscribe to events for notifications
            try {
                eventBus.events.collect { event ->
                    handleEvent(event)
                }
            } catch (e: Exception) {
                // Log error but don't crash the service
                android.util.Log.e("SignetService", "SSE event collection error", e)
                // Mark as disconnected
                isConnected.set(false)
                updateServiceNotification(ConnectionState.DISCONNECTED)
            }
        }
    }

    private fun startCountdownTicker() {
        countdownJob?.cancel()
        countdownJob = serviceScope.launch {
            while (isActive) {
                delay(UiConstants.COUNTDOWN_TICKER_INTERVAL_MS)
                // Only tick if dead man switch is active (enabled, not panicked, has remaining time)
                val status = deadManSwitchStatus
                if (status != null && status.enabled && status.panicTriggeredAt == null) {
                    status.remainingSec?.let { remaining ->
                        val newRemaining = (remaining - 60).coerceAtLeast(0)
                        deadManSwitchStatus = status.copy(remainingSec = newRemaining)
                        checkWarningThresholds()
                        updateServiceNotificationDebounced(ConnectionState.CONNECTED)
                    }
                }
            }
        }
    }

    private fun handleEvent(event: ServerEvent) {
        when (event) {
            is ServerEvent.Connected -> {
                isConnected.set(true)
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            is ServerEvent.RequestCreated -> {
                pendingCount++
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
                showRequestNotification(event.request)
            }

            is ServerEvent.RequestApproved,
            is ServerEvent.RequestDenied,
            is ServerEvent.RequestExpired -> {
                if (pendingCount > 0) pendingCount--
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            is ServerEvent.StatsUpdated -> {
                pendingCount = event.stats.pendingRequests
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            is ServerEvent.DeadmanPanic -> {
                deadManSwitchStatus = event.status
                lastWarningLevel = WarningLevel.PANIC
                showPanicNotification()
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            is ServerEvent.DeadmanReset -> {
                deadManSwitchStatus = event.status
                lastWarningLevel = WarningLevel.NONE
                clearInactivityNotifications()
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            is ServerEvent.DeadmanUpdated -> {
                deadManSwitchStatus = event.status
                checkWarningThresholds()
                updateServiceNotificationDebounced(ConnectionState.CONNECTED)
            }

            else -> {
                // Other events don't affect notifications
            }
        }
    }

    private fun checkWarningThresholds() {
        val status = deadManSwitchStatus ?: return
        if (!status.enabled || status.panicTriggeredAt != null) return

        val remainingSec = status.remainingSec ?: return
        val currentLevel = when {
            remainingSec <= 3600 -> WarningLevel.ONE_HOUR
            remainingSec <= 43200 -> WarningLevel.TWELVE_HOURS
            else -> WarningLevel.NONE
        }

        // Only notify when crossing a threshold (from less urgent to more urgent)
        if (currentLevel.ordinal > lastWarningLevel.ordinal) {
            when (currentLevel) {
                WarningLevel.TWELVE_HOURS -> showWarningNotification(remainingSec, false)
                WarningLevel.ONE_HOUR -> showWarningNotification(remainingSec, true)
                else -> {}
            }
            lastWarningLevel = currentLevel
        }
    }

    private fun showWarningNotification(remainingSec: Int, urgent: Boolean) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            SignetApplication.INACTIVITY_NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val timeText = formatDuration(remainingSec)
        val title = if (urgent) {
            getString(R.string.inactivity_warning_urgent_title)
        } else {
            getString(R.string.inactivity_warning_title)
        }

        val notification = NotificationCompat.Builder(this, SignetApplication.INACTIVITY_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(getString(R.string.inactivity_warning_text, timeText))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(if (urgent) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build()

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(SignetApplication.INACTIVITY_NOTIFICATION_ID, notification)
    }

    private fun showPanicNotification() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            SignetApplication.INACTIVITY_NOTIFICATION_ID + 1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, SignetApplication.INACTIVITY_CHANNEL_ID)
            .setContentTitle(getString(R.string.inactivity_panic_title))
            .setContentText(getString(R.string.inactivity_panic_text))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build()

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(SignetApplication.INACTIVITY_NOTIFICATION_ID + 1, notification)
    }

    private fun clearInactivityNotifications() {
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.cancel(SignetApplication.INACTIVITY_NOTIFICATION_ID)
        notificationManager.cancel(SignetApplication.INACTIVITY_NOTIFICATION_ID + 1)
    }

    private fun formatDuration(seconds: Int): String {
        return when {
            seconds >= 86400 -> {
                val days = seconds / 86400
                if (days == 1) "1 day" else "$days days"
            }
            seconds >= 3600 -> {
                val hours = seconds / 3600
                if (hours == 1) "1 hour" else "$hours hours"
            }
            seconds >= 60 -> {
                val minutes = seconds / 60
                if (minutes == 1) "1 minute" else "$minutes minutes"
            }
            else -> "less than a minute"
        }
    }

    private fun showRequestNotification(request: tech.geektoshi.signet.data.model.PendingRequest) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("requestId", request.id)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            request.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val appName = request.appName ?: request.remotePubkey.take(12) + "..."
        val methodLabel = getMethodLabel(request.method, request.eventPreview?.kind)

        val text = getString(R.string.alert_new_request_text, appName, methodLabel.lowercase())

        val notification = NotificationCompat.Builder(this, SignetApplication.ALERT_CHANNEL_ID)
            .setContentTitle(getString(R.string.alert_new_request_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()

        val notificationManager = getSystemService(android.app.NotificationManager::class.java)
        // Use request ID hash to allow multiple notifications
        notificationManager.notify(
            SignetApplication.ALERT_NOTIFICATION_ID + request.id.hashCode(),
            notification
        )
    }

    private enum class ConnectionState {
        CONNECTING, CONNECTED, DISCONNECTED
    }

    private fun updateServiceNotification(state: ConnectionState) {
        val notification = createServiceNotification(state)
        val notificationManager = getSystemService(android.app.NotificationManager::class.java)
        notificationManager.notify(SignetApplication.SERVICE_NOTIFICATION_ID, notification)
    }

    /**
     * Debounced version of updateServiceNotification to reduce notification manager overhead.
     * Skips updates if called within notificationDebounceMs of the last update.
     */
    private fun updateServiceNotificationDebounced(state: ConnectionState) {
        val now = System.currentTimeMillis()
        val lastUpdate = lastNotificationUpdate.get()
        if (now - lastUpdate >= notificationDebounceMs) {
            if (lastNotificationUpdate.compareAndSet(lastUpdate, now)) {
                updateServiceNotification(state)
            }
        }
    }

    private fun createServiceNotification(state: ConnectionState): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val text = when (state) {
            ConnectionState.CONNECTING -> getString(R.string.notification_text_connecting)
            ConnectionState.CONNECTED -> buildConnectedStatusText()
            ConnectionState.DISCONNECTED -> getString(R.string.notification_text_disconnected)
        }

        return NotificationCompat.Builder(this, SignetApplication.SERVICE_CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun buildConnectedStatusText(): String {
        val status = deadManSwitchStatus
        val parts = mutableListOf<String>()

        // Connection/pending status
        if (pendingCount > 0) {
            parts.add(getString(R.string.notification_status_pending, pendingCount))
        } else {
            parts.add(getString(R.string.notification_status_connected))
        }

        // Inactivity lock status
        if (status != null && status.enabled) {
            if (status.panicTriggeredAt != null) {
                parts.add(getString(R.string.notification_status_locked))
            } else {
                status.remainingSec?.let { remaining ->
                    val timeText = formatDuration(remaining)
                    parts.add(getString(R.string.notification_status_timer, timeText))
                }
            }
        }

        return parts.joinToString(" • ")
    }

    companion object {
        fun start(context: android.content.Context) {
            val intent = Intent(context, SignetService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: android.content.Context) {
            val intent = Intent(context, SignetService::class.java)
            context.stopService(intent)
        }
    }
}
