package tech.geektoshi.signet.data.model

import kotlinx.serialization.Serializable

/**
 * Dashboard statistics
 */
@Serializable
data class DashboardStats(
    val totalKeys: Int,
    val activeKeys: Int,
    val connectedApps: Int,
    val pendingRequests: Int,
    val recentActivity24h: Int
)

/**
 * Activity entry for dashboard timeline (NIP-46 requests)
 */
@Serializable
data class ActivityEntry(
    val id: Int,
    val timestamp: String,
    val type: String,
    val method: String? = null,
    val eventKind: Int? = null,
    val keyName: String? = null,
    val userPubkey: String? = null,
    val appName: String? = null,
    val autoApproved: Boolean,
    val approvalType: String? = null  // 'manual' | 'auto_trust' | 'auto_permission'
)

/**
 * Admin activity entry for admin events (key lock/unlock, app connect/suspend/resume, daemon start, commands)
 */
@Serializable
data class AdminActivityEntry(
    val id: Int,
    val timestamp: String,
    val category: String,  // Always 'admin'
    val eventType: String,  // 'key_locked' | 'key_unlocked' | 'app_connected' | 'app_suspended' | 'app_unsuspended' | 'daemon_started' | 'status_checked' | 'command_executed'
    val keyName: String? = null,
    val appId: Int? = null,
    val appName: String? = null,
    val clientName: String? = null,
    val clientVersion: String? = null,
    val ipAddress: String? = null,
    val command: String? = null,
    val commandResult: String? = null
)

/**
 * Mixed activity entry - can represent either a NIP-46 activity or an admin event
 * Uses a flat structure with all possible fields, determined by 'category' field
 */
@Serializable
data class MixedActivityEntry(
    val id: Int,
    val timestamp: String,
    // Common fields
    val keyName: String? = null,
    val appName: String? = null,
    // NIP-46 activity fields
    val type: String? = null,  // 'approval' | 'denial'
    val method: String? = null,
    val eventKind: Int? = null,
    val userPubkey: String? = null,
    val autoApproved: Boolean? = null,
    val approvalType: String? = null,
    // Admin event fields
    val category: String? = null,  // 'admin' for admin events
    val eventType: String? = null,  // 'key_locked' | 'key_unlocked' | 'app_connected' | 'app_suspended' | 'app_unsuspended' | 'daemon_started' | 'status_checked' | 'command_executed'
    val appId: Int? = null,
    val clientName: String? = null,
    val clientVersion: String? = null,
    val ipAddress: String? = null,
    val command: String? = null,
    val commandResult: String? = null
) {
    val isAdminEntry: Boolean get() = category == "admin"
}

/**
 * Dashboard API response
 */
@Serializable
data class DashboardResponse(
    val stats: DashboardStats,
    val activity: List<MixedActivityEntry>
)

/**
 * Admin activity response for the admin filter
 */
@Serializable
data class AdminActivityResponse(
    val requests: List<AdminActivityEntry>
)

/**
 * Event preview for signing requests
 */
@Serializable
data class EventPreview(
    val kind: Int,
    val content: String,
    val tags: List<List<String>>
)

/**
 * Pending request
 */
@Serializable
data class PendingRequest(
    val id: String,
    val keyName: String?,
    val method: String,
    val remotePubkey: String,
    val params: String?,
    val eventPreview: EventPreview? = null,
    val createdAt: String,
    val expiresAt: String,
    val ttlSeconds: Int,
    val requiresPassword: Boolean = false,
    val processedAt: String? = null,
    val autoApproved: Boolean,
    val approvalType: String? = null,  // 'manual' | 'auto_trust' | 'auto_permission'
    val appName: String? = null,
    val allowed: Boolean? = null
)

/**
 * Requests list response
 */
@Serializable
data class RequestsResponse(
    val requests: List<PendingRequest>
)

/**
 * Key status
 */
enum class KeyStatus {
    online, locked, offline
}

/**
 * Key information
 */
@Serializable
data class KeyInfo(
    val name: String,
    val pubkey: String? = null,
    val npub: String? = null,
    val bunkerUri: String? = null,
    val status: String,
    val isEncrypted: Boolean,
    val encryptionFormat: String = "none",  // 'none' | 'legacy' | 'nip49'
    val userCount: Int,
    val tokenCount: Int,
    val requestCount: Int,
    val lastUsedAt: String? = null
)

/**
 * Keys list response
 */
@Serializable
data class KeysResponse(
    val keys: List<KeyInfo>
)

/**
 * Trust level for apps
 */
enum class TrustLevel {
    paranoid, reasonable, full
}

/**
 * Method usage breakdown
 */
@Serializable
data class MethodBreakdown(
    val sign_event: Int = 0,
    val nip04_encrypt: Int = 0,
    val nip04_decrypt: Int = 0,
    val nip44_encrypt: Int = 0,
    val nip44_decrypt: Int = 0,
    val get_public_key: Int = 0,
    val other: Int = 0
)

/**
 * Connected app
 */
@Serializable
data class ConnectedApp(
    val id: Int,
    val keyName: String,
    val userPubkey: String,
    val description: String? = null,
    val trustLevel: String,
    val permissions: List<String>,
    val connectedAt: String,
    val lastUsedAt: String? = null,
    val requestCount: Int,
    val methodBreakdown: MethodBreakdown,
    val suspendedAt: String? = null,
    val suspendUntil: String? = null
)

/**
 * Request body for suspending an app with optional end time
 */
@Serializable
data class SuspendAppBody(
    val until: String? = null
)

/**
 * Apps list response
 */
@Serializable
data class AppsResponse(
    val apps: List<ConnectedApp>
)

/**
 * Relay status
 */
@Serializable
data class RelayStatus(
    val url: String,
    val connected: Boolean,
    val lastConnected: String? = null,
    val lastDisconnected: String? = null,
    val trustScore: Int? = null
)

/**
 * Relays response
 */
@Serializable
data class RelaysResponse(
    val connected: Int,
    val total: Int,
    val relays: List<RelayStatus>
)

/**
 * Generic operation response
 */
@Serializable
data class OperationResponse(
    val ok: Boolean = false,
    val error: String? = null
)

/**
 * Request body for approving a request
 */
@Serializable
data class ApproveRequestBody(
    val trustLevel: String? = null,
    val alwaysAllow: Boolean? = null,
    val appName: String? = null,
    val passphrase: String? = null
)

/**
 * Response from generating a one-time connection token
 */
@Serializable
data class ConnectionTokenResponse(
    val ok: Boolean = false,
    val bunkerUri: String? = null,
    val expiresAt: String? = null,
    val error: String? = null
)

/**
 * Request body for connecting via nostrconnect
 */
@Serializable
data class NostrconnectRequest(
    val uri: String,
    val keyName: String,
    val trustLevel: String,
    val description: String? = null
)

/**
 * Response from connecting via nostrconnect
 */
@Serializable
data class NostrconnectResponse(
    val ok: Boolean = false,
    val appId: Int? = null,
    val clientPubkey: String? = null,
    val relays: List<String>? = null,
    val connectResponseSent: Boolean? = null,
    val connectResponseError: String? = null,
    val error: String? = null,
    val errorType: String? = null
)

/**
 * Memory usage stats
 */
@Serializable
data class MemoryStats(
    val heapMB: Double,
    val rssMB: Double
)

/**
 * Relay connection counts
 */
@Serializable
data class RelayStats(
    val connected: Int,
    val total: Int
)

/**
 * Key counts by status
 */
@Serializable
data class KeyStats(
    val active: Int,
    val locked: Int,
    val offline: Int
)

/**
 * Health status from /health endpoint
 */
@Serializable
data class HealthStatus(
    val status: String,  // "ok" or "degraded"
    val uptime: Int,
    val memory: MemoryStats,
    val relays: RelayStats,
    val keys: KeyStats,
    val subscriptions: Int,
    val sseClients: Int,
    val lastPoolReset: String? = null
)

/**
 * Dead Man's Switch (Inactivity Lock) status
 */
@Serializable
data class DeadManSwitchStatus(
    val enabled: Boolean,
    val timeframeSec: Int,
    val lastResetAt: Long? = null,
    val remainingSec: Int? = null,
    val panicTriggeredAt: Long? = null,
    val remainingAttempts: Int = 5
)

/**
 * Response from Dead Man's Switch operations
 */
@Serializable
data class DeadManSwitchResponse(
    val ok: Boolean = false,
    val status: DeadManSwitchStatus? = null,
    val error: String? = null,
    val remainingAttempts: Int? = null
)

/**
 * Request body for enabling Dead Man's Switch
 */
@Serializable
data class EnableDeadManSwitchBody(
    val enabled: Boolean = true,
    val timeframeSec: Int? = null
)

/**
 * Request body for disabling Dead Man's Switch
 */
@Serializable
data class DisableDeadManSwitchBody(
    val enabled: Boolean = false,
    val keyName: String,
    val passphrase: String
)

/**
 * Request body for updating Dead Man's Switch timeframe
 */
@Serializable
data class UpdateDeadManSwitchBody(
    val timeframeSec: Int,
    val keyName: String,
    val passphrase: String
)

/**
 * Request body for resetting/testing Dead Man's Switch
 */
@Serializable
data class DeadManSwitchActionBody(
    val keyName: String,
    val passphrase: String
)

// ==================== Bulk Operations ====================

/**
 * Response from locking all keys
 */
@Serializable
data class LockAllKeysResponse(
    val ok: Boolean = false,
    val lockedCount: Int = 0,
    val error: String? = null
)

/**
 * Request body for suspending all apps with optional end time
 */
@Serializable
data class SuspendAllAppsBody(
    val until: String? = null
)

/**
 * Response from suspending all apps
 */
@Serializable
data class SuspendAllAppsResponse(
    val ok: Boolean = false,
    val suspendedCount: Int = 0,
    val error: String? = null
)

/**
 * Response from resuming all apps
 */
@Serializable
data class ResumeAllAppsResponse(
    val ok: Boolean = false,
    val resumedCount: Int = 0,
    val error: String? = null
)

// ==================== Key Encryption Operations ====================

/**
 * Request body for creating a key with encryption
 */
@Serializable
data class CreateKeyRequest(
    val keyName: String,
    val passphrase: String? = null,
    val confirmPassphrase: String? = null,
    val nsec: String? = null,
    val encryption: String = "none"  // 'none' | 'legacy' | 'nip49'
)

/**
 * Response from creating a key
 */
@Serializable
data class CreateKeyResponse(
    val ok: Boolean = false,
    val key: KeyInfo? = null,
    val error: String? = null
)

/**
 * Request body for encrypting an unencrypted key
 */
@Serializable
data class EncryptKeyRequest(
    val encryption: String,  // 'nip49' | 'legacy'
    val passphrase: String,
    val confirmPassphrase: String
)

/**
 * Request body for migrating a legacy key to NIP-49
 */
@Serializable
data class MigrateKeyRequest(
    val passphrase: String
)

/**
 * Request body for exporting a key
 */
@Serializable
data class ExportKeyRequest(
    val format: String,  // 'nsec' | 'nip49'
    val currentPassphrase: String? = null,
    val exportPassphrase: String? = null,
    val confirmExportPassphrase: String? = null
)

/**
 * Response from exporting a key
 */
@Serializable
data class ExportKeyResponse(
    val ok: Boolean = false,
    val key: String? = null,
    val format: String? = null,  // 'nsec' | 'ncryptsec'
    val error: String? = null
)

// ==================== Relay Trust Scores ====================

/**
 * Request body for fetching relay trust scores
 */
@Serializable
data class RelayTrustScoresRequest(
    val relays: List<String>
)

/**
 * Response from fetching relay trust scores
 */
@Serializable
data class RelayTrustScoresResponse(
    val scores: Map<String, Int?>
)
