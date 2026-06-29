package tech.geektoshi.signet.data.repository

import android.content.Context
import android.content.SharedPreferences
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val context: Context) {

    private object Keys {
        // Legacy key - kept for migration only
        val DAEMON_URL_LEGACY = stringPreferencesKey("daemon_url")
        val DEFAULT_TRUST_LEVEL = stringPreferencesKey("default_trust_level")
        val BATTERY_PROMPT_SHOWN = booleanPreferencesKey("battery_prompt_shown")
        val APP_LOCK_ENABLED = booleanPreferencesKey("app_lock_enabled")
        val LOCK_TIMEOUT_MINUTES = intPreferencesKey("lock_timeout_minutes")
        val LAST_ACTIVITY_TIMESTAMP = longPreferencesKey("last_activity_timestamp")
    }

    private object EncryptedKeys {
        const val DAEMON_URL = "daemon_url"
        const val MIGRATED = "migrated_from_datastore"
    }

    /**
     * Encrypted SharedPreferences for sensitive data (daemon URL).
     * Uses Android Keystore for key management.
     */
    private val encryptedPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "signet_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    init {
        // Migrate daemon URL from DataStore to EncryptedSharedPreferences on first access
        migrateIfNeeded()
    }

    /**
     * Migrate daemon URL from DataStore to EncryptedSharedPreferences.
     * Only runs once, on first access after update.
     */
    private fun migrateIfNeeded() {
        if (encryptedPrefs.getBoolean(EncryptedKeys.MIGRATED, false)) {
            return
        }

        // Check if there's a legacy daemon URL in DataStore
        runBlocking {
            val legacyUrl = context.dataStore.data.first()[Keys.DAEMON_URL_LEGACY]
            if (!legacyUrl.isNullOrEmpty()) {
                // Migrate to encrypted storage
                encryptedPrefs.edit()
                    .putString(EncryptedKeys.DAEMON_URL, legacyUrl)
                    .putBoolean(EncryptedKeys.MIGRATED, true)
                    .apply()

                // Clear legacy value from DataStore
                context.dataStore.edit { preferences ->
                    preferences.remove(Keys.DAEMON_URL_LEGACY)
                }
            } else {
                // No legacy data, just mark as migrated
                encryptedPrefs.edit()
                    .putBoolean(EncryptedKeys.MIGRATED, true)
                    .apply()
            }
        }
    }

    /**
     * Daemon URL stored in encrypted SharedPreferences, observed reactively so a change at
     * runtime (e.g. completing setup or editing it in Settings) emits immediately — that's
     * what flips the UI from the setup screen to the dashboard without an app restart.
     *
     * Note: EncryptedSharedPreferences delivers *encrypted* key names to the change listener,
     * so we can't match on the key — we just re-read on any change (this prefs file only holds
     * the daemon URL and the migration flag) and let distinctUntilChanged() drop no-ops.
     */
    val daemonUrl: Flow<String> = callbackFlow {
        val read = { encryptedPrefs.getString(EncryptedKeys.DAEMON_URL, "") ?: "" }
        trySend(read())
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> trySend(read()) }
        encryptedPrefs.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { encryptedPrefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    val defaultTrustLevel: Flow<String> = context.dataStore.data.map { preferences ->
        preferences[Keys.DEFAULT_TRUST_LEVEL] ?: "reasonable"
    }

    val batteryPromptShown: Flow<Boolean> = context.dataStore.data.map { preferences ->
        preferences[Keys.BATTERY_PROMPT_SHOWN] ?: false
    }

    val appLockEnabled: Flow<Boolean> = context.dataStore.data.map { preferences ->
        preferences[Keys.APP_LOCK_ENABLED] ?: false
    }

    val lockTimeoutMinutes: Flow<Int> = context.dataStore.data.map { preferences ->
        preferences[Keys.LOCK_TIMEOUT_MINUTES] ?: 1
    }

    val lastActivityTimestamp: Flow<Long> = context.dataStore.data.map { preferences ->
        preferences[Keys.LAST_ACTIVITY_TIMESTAMP] ?: 0L
    }

    suspend fun setDaemonUrl(url: String) {
        encryptedPrefs.edit()
            .putString(EncryptedKeys.DAEMON_URL, url)
            .apply()
    }

    suspend fun setDefaultTrustLevel(level: String) {
        context.dataStore.edit { preferences ->
            preferences[Keys.DEFAULT_TRUST_LEVEL] = level
        }
    }

    suspend fun setBatteryPromptShown(shown: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.BATTERY_PROMPT_SHOWN] = shown
        }
    }

    suspend fun setAppLockEnabled(enabled: Boolean) {
        context.dataStore.edit { preferences ->
            preferences[Keys.APP_LOCK_ENABLED] = enabled
        }
    }

    suspend fun setLockTimeoutMinutes(minutes: Int) {
        context.dataStore.edit { preferences ->
            preferences[Keys.LOCK_TIMEOUT_MINUTES] = minutes
        }
    }

    suspend fun setLastActivityTimestamp(timestamp: Long) {
        context.dataStore.edit { preferences ->
            preferences[Keys.LAST_ACTIVITY_TIMESTAMP] = timestamp
        }
    }
}
