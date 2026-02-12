package tech.geektoshi.signet.data.api

import tech.geektoshi.signet.data.model.AdminActivityEntry
import tech.geektoshi.signet.data.model.AdminActivityResponse
import tech.geektoshi.signet.data.model.ApproveRequestBody
import tech.geektoshi.signet.data.model.AppsResponse
import tech.geektoshi.signet.data.model.ConnectionTokenResponse
import tech.geektoshi.signet.data.model.CreateKeyRequest
import tech.geektoshi.signet.data.model.CreateKeyResponse
import tech.geektoshi.signet.data.model.EncryptKeyRequest
import tech.geektoshi.signet.data.model.ExportKeyRequest
import tech.geektoshi.signet.data.model.ExportKeyResponse
import tech.geektoshi.signet.data.model.MigrateKeyRequest
import tech.geektoshi.signet.data.model.SuspendAppBody
import tech.geektoshi.signet.data.model.SuspendAllAppsBody
import tech.geektoshi.signet.data.model.SuspendAllAppsResponse
import tech.geektoshi.signet.data.model.ResumeAllAppsResponse
import tech.geektoshi.signet.data.model.LockAllKeysResponse
import tech.geektoshi.signet.data.model.DashboardResponse
import tech.geektoshi.signet.data.model.DeadManSwitchActionBody
import tech.geektoshi.signet.data.model.DeadManSwitchResponse
import tech.geektoshi.signet.data.model.DeadManSwitchStatus
import tech.geektoshi.signet.data.model.DisableDeadManSwitchBody
import tech.geektoshi.signet.data.model.EnableDeadManSwitchBody
import tech.geektoshi.signet.data.model.HealthStatus
import tech.geektoshi.signet.data.model.KeysResponse
import tech.geektoshi.signet.data.model.NostrconnectRequest
import tech.geektoshi.signet.data.model.NostrconnectResponse
import tech.geektoshi.signet.data.model.OperationResponse
import tech.geektoshi.signet.data.model.RelaysResponse
import tech.geektoshi.signet.data.model.RelayTrustScoresRequest
import tech.geektoshi.signet.data.model.RelayTrustScoresResponse
import tech.geektoshi.signet.data.model.RequestsResponse
import tech.geektoshi.signet.data.model.UpdateDeadManSwitchBody
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import tech.geektoshi.signet.BuildConfig
import tech.geektoshi.signet.util.ErrorFormatter
import tech.geektoshi.signet.util.NetworkConstants

class SignetApiClient(
    private val baseUrl: String
) {
    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                isLenient = true
                explicitNulls = false
            })
        }
        install(HttpTimeout) {
            requestTimeoutMillis = NetworkConstants.REQUEST_TIMEOUT_MS
            connectTimeoutMillis = NetworkConstants.CONNECTION_TIMEOUT_MS
            socketTimeoutMillis = NetworkConstants.SOCKET_TIMEOUT_MS
        }
        defaultRequest {
            url(baseUrl)
            contentType(ContentType.Application.Json)
            // Bearer auth skips CSRF checks (token value doesn't matter when requireAuth=false)
            bearerAuth("android-client")
            // Identify client for admin activity logging
            header("X-Signet-Client", "Signet Android/${BuildConfig.VERSION_NAME}")
        }
    }

    /**
     * Execute a suspending block with retry logic for transient errors.
     * Uses exponential backoff between attempts.
     */
    private suspend fun <T> withRetry(
        maxAttempts: Int = NetworkConstants.MAX_RETRY_ATTEMPTS,
        block: suspend () -> T
    ): T {
        var lastException: Throwable? = null
        var delayMs = NetworkConstants.INITIAL_RETRY_DELAY_MS

        repeat(maxAttempts) { attempt ->
            try {
                return block()
            } catch (e: Throwable) {
                lastException = e
                if (!ErrorFormatter.isRetryable(e) || attempt == maxAttempts - 1) {
                    throw e
                }
                delay(delayMs)
                delayMs = (delayMs * 2).coerceAtMost(NetworkConstants.MAX_RETRY_DELAY_MS)
            }
        }

        throw lastException ?: IllegalStateException("Retry failed without exception")
    }

    /**
     * Get dashboard stats and recent activity
     */
    suspend fun getDashboard(): DashboardResponse {
        return withRetry { client.get("/dashboard").body() }
    }

    /**
     * Get list of requests
     * @param excludeAdmin When true with status="all", excludes admin events from response
     */
    suspend fun getRequests(
        status: String = "pending",
        limit: Int = 50,
        offset: Int = 0,
        excludeAdmin: Boolean = false
    ): RequestsResponse {
        return withRetry {
            client.get("/requests") {
                parameter("status", status)
                parameter("limit", limit)
                parameter("offset", offset)
                if (excludeAdmin) {
                    parameter("excludeAdmin", "true")
                }
            }.body()
        }
    }

    /**
     * Approve a request
     */
    suspend fun approveRequest(
        id: String,
        trustLevel: String? = null,
        alwaysAllow: Boolean = false,
        appName: String? = null,
        passphrase: String? = null
    ): OperationResponse {
        return client.post("/requests/$id") {
            setBody(ApproveRequestBody(
                trustLevel = trustLevel,
                alwaysAllow = if (alwaysAllow) true else null,
                appName = appName?.ifBlank { null },
                passphrase = passphrase?.ifBlank { null }
            ))
        }.body()
    }

    /**
     * Deny a request
     */
    suspend fun denyRequest(id: String): OperationResponse {
        return client.delete("/requests/$id").body()
    }

    /**
     * Get list of keys
     */
    suspend fun getKeys(): KeysResponse {
        return withRetry { client.get("/keys").body() }
    }

    /**
     * Create a new key with optional encryption
     */
    suspend fun createKey(
        keyName: String,
        passphrase: String? = null,
        confirmPassphrase: String? = null,
        nsec: String? = null,
        encryption: String = "none"  // 'none' | 'legacy' | 'nip49'
    ): CreateKeyResponse {
        return client.post("/keys") {
            setBody(CreateKeyRequest(
                keyName = keyName,
                passphrase = passphrase,
                confirmPassphrase = confirmPassphrase,
                nsec = nsec,
                encryption = encryption
            ))
        }.body()
    }

    /**
     * Delete a key
     */
    suspend fun deleteKey(
        keyName: String,
        passphrase: String? = null
    ): OperationResponse {
        return client.delete("/keys/$keyName") {
            setBody(mapOf(
                "passphrase" to passphrase
            ).filterValues { it != null })
        }.body()
    }

    /**
     * Unlock an encrypted key
     */
    suspend fun unlockKey(
        keyName: String,
        passphrase: String
    ): OperationResponse {
        return client.post("/keys/$keyName/unlock") {
            setBody(mapOf("passphrase" to passphrase))
        }.body()
    }

    /**
     * Lock an active key, removing it from memory.
     * The key remains encrypted on disk; all apps and permissions are preserved.
     */
    suspend fun lockKey(keyName: String): OperationResponse {
        return client.post("/keys/$keyName/lock") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Lock all active (unlocked) keys at once.
     * Keys are removed from memory but remain encrypted on disk.
     */
    suspend fun lockAllKeys(): LockAllKeysResponse {
        return client.post("/keys/lock-all") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Generate a one-time connection token for a key.
     * Returns a bunker URI with a token that expires in 5 minutes and can only be used once.
     */
    suspend fun generateConnectionToken(keyName: String): ConnectionTokenResponse {
        return client.post("/keys/$keyName/connection-token") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Encrypt an unencrypted key with a passphrase
     */
    suspend fun encryptKey(
        keyName: String,
        encryption: String,  // 'nip49' | 'legacy'
        passphrase: String,
        confirmPassphrase: String
    ): OperationResponse {
        return client.post("/keys/$keyName/encrypt") {
            setBody(EncryptKeyRequest(
                encryption = encryption,
                passphrase = passphrase,
                confirmPassphrase = confirmPassphrase
            ))
        }.body()
    }

    /**
     * Migrate a legacy-encrypted key to NIP-49 format
     */
    suspend fun migrateKeyToNip49(
        keyName: String,
        passphrase: String
    ): OperationResponse {
        return client.post("/keys/$keyName/migrate") {
            setBody(MigrateKeyRequest(passphrase = passphrase))
        }.body()
    }

    /**
     * Export a key in nsec or NIP-49 (ncryptsec) format
     */
    suspend fun exportKey(
        keyName: String,
        format: String,  // 'nsec' | 'nip49'
        currentPassphrase: String? = null,
        exportPassphrase: String? = null,
        confirmExportPassphrase: String? = null
    ): ExportKeyResponse {
        return client.post("/keys/$keyName/export") {
            setBody(ExportKeyRequest(
                format = format,
                currentPassphrase = currentPassphrase,
                exportPassphrase = exportPassphrase,
                confirmExportPassphrase = confirmExportPassphrase
            ))
        }.body()
    }

    /**
     * Get list of connected apps
     */
    suspend fun getApps(): AppsResponse {
        return withRetry { client.get("/apps").body() }
    }

    /**
     * Revoke an app
     */
    suspend fun revokeApp(id: Int): OperationResponse {
        return client.post("/apps/$id/revoke") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Update an app's name or trust level
     */
    suspend fun updateApp(
        id: Int,
        description: String? = null,
        trustLevel: String? = null
    ): OperationResponse {
        return client.patch("/apps/$id") {
            setBody(mapOf(
                "description" to description,
                "trustLevel" to trustLevel
            ).filterValues { it != null })
        }.body()
    }

    /**
     * Suspend an app, preventing all requests until unsuspended.
     * @param until Optional ISO8601 timestamp when the suspension should automatically end
     */
    suspend fun suspendApp(id: Int, until: String? = null): OperationResponse {
        return client.post("/apps/$id/suspend") {
            setBody(SuspendAppBody(until = until))
        }.body()
    }

    /**
     * Unsuspend an app, allowing requests again.
     */
    suspend fun unsuspendApp(id: Int): OperationResponse {
        return client.post("/apps/$id/unsuspend") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Suspend all active apps at once.
     * @param until Optional ISO8601 timestamp when suspensions should automatically end
     */
    suspend fun suspendAllApps(until: String? = null): SuspendAllAppsResponse {
        return client.post("/apps/suspend-all") {
            setBody(SuspendAllAppsBody(until = until))
        }.body()
    }

    /**
     * Resume all suspended apps at once.
     */
    suspend fun resumeAllApps(): ResumeAllAppsResponse {
        return client.post("/apps/resume-all") {
            setBody(emptyMap<String, String>())
        }.body()
    }

    /**
     * Connect to an app via nostrconnect:// URI.
     */
    suspend fun connectViaNostrconnect(
        uri: String,
        keyName: String,
        trustLevel: String,
        description: String? = null
    ): NostrconnectResponse {
        return client.post("/nostrconnect") {
            setBody(NostrconnectRequest(
                uri = uri,
                keyName = keyName,
                trustLevel = trustLevel,
                description = description
            ))
        }.body()
    }

    /**
     * Get relay status
     */
    suspend fun getRelays(): RelaysResponse {
        return withRetry { client.get("/relays").body() }
    }

    /**
     * Get trust scores for arbitrary relay URLs.
     * Used by NostrConnect modal to show scores for app-specified relays.
     */
    suspend fun getRelayTrustScores(relays: List<String>): RelayTrustScoresResponse {
        return client.post("/relays/trust-scores") {
            setBody(RelayTrustScoresRequest(relays = relays))
        }.body()
    }

    /**
     * Get full health status from daemon
     */
    suspend fun getHealth(): HealthStatus {
        return withRetry { client.get("/health").body() }
    }

    /**
     * Get admin activity (key lock/unlock, app suspend/resume, daemon start events)
     */
    suspend fun getAdminActivity(
        limit: Int = 50,
        offset: Int = 0
    ): List<AdminActivityEntry> {
        return withRetry {
            client.get("/requests") {
                parameter("status", "admin")
                parameter("limit", limit)
                parameter("offset", offset)
            }.body<AdminActivityResponse>().requests
        }
    }

    /**
     * Check if the daemon is reachable.
     * Returns true if reachable, false otherwise.
     */
    suspend fun healthCheck(): Boolean {
        return try {
            withRetry { client.get("/health") }
            true
        } catch (_: Exception) {
            false
        }
    }

    // ==================== Dead Man's Switch (Inactivity Lock) ====================

    /**
     * Get Dead Man's Switch status
     */
    suspend fun getDeadManSwitchStatus(): DeadManSwitchStatus {
        return withRetry { client.get("/dead-man-switch").body() }
    }

    /**
     * Enable the Dead Man's Switch
     */
    suspend fun enableDeadManSwitch(timeframeSec: Int? = null): DeadManSwitchResponse {
        return client.put("/dead-man-switch") {
            setBody(EnableDeadManSwitchBody(
                enabled = true,
                timeframeSec = timeframeSec
            ))
        }.body()
    }

    /**
     * Disable the Dead Man's Switch
     */
    suspend fun disableDeadManSwitch(
        keyName: String,
        passphrase: String
    ): DeadManSwitchResponse {
        return client.put("/dead-man-switch") {
            setBody(DisableDeadManSwitchBody(
                enabled = false,
                keyName = keyName,
                passphrase = passphrase
            ))
        }.body()
    }

    /**
     * Update the Dead Man's Switch timeframe
     */
    suspend fun updateDeadManSwitchTimeframe(
        keyName: String,
        passphrase: String,
        timeframeSec: Int
    ): DeadManSwitchResponse {
        return client.put("/dead-man-switch") {
            setBody(UpdateDeadManSwitchBody(
                timeframeSec = timeframeSec,
                keyName = keyName,
                passphrase = passphrase
            ))
        }.body()
    }

    /**
     * Reset the Dead Man's Switch timer
     */
    suspend fun resetDeadManSwitch(
        keyName: String,
        passphrase: String
    ): DeadManSwitchResponse {
        return client.post("/dead-man-switch/reset") {
            setBody(DeadManSwitchActionBody(
                keyName = keyName,
                passphrase = passphrase
            ))
        }.body()
    }

    /**
     * Test the panic functionality (for testing)
     */
    suspend fun testDeadManSwitchPanic(
        keyName: String,
        passphrase: String
    ): DeadManSwitchResponse {
        return client.post("/dead-man-switch/test-panic") {
            setBody(DeadManSwitchActionBody(
                keyName = keyName,
                passphrase = passphrase
            ))
        }.body()
    }

    /**
     * Close the client
     */
    fun close() {
        client.close()
    }
}
