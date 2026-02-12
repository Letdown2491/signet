package tech.geektoshi.signet.util

/**
 * Network-related constants for API and SSE connections.
 */
object NetworkConstants {
    /** Request timeout in milliseconds */
    const val REQUEST_TIMEOUT_MS = 30_000L

    /** Connection timeout in milliseconds */
    const val CONNECTION_TIMEOUT_MS = 10_000L

    /** Socket timeout in milliseconds */
    const val SOCKET_TIMEOUT_MS = 30_000L

    /** Initial delay before first SSE reconnect attempt */
    const val SSE_INITIAL_RECONNECT_DELAY_MS = 1_000L

    /** Maximum delay between SSE reconnect attempts */
    const val SSE_MAX_RECONNECT_DELAY_MS = 30_000L

    /** Maximum number of retry attempts for transient errors */
    const val MAX_RETRY_ATTEMPTS = 3

    /** Initial retry delay in milliseconds */
    const val INITIAL_RETRY_DELAY_MS = 1_000L

    /** Maximum retry delay in milliseconds */
    const val MAX_RETRY_DELAY_MS = 10_000L
}

/**
 * API-related constants.
 */
object ApiConstants {
    /** Default limit for paginated requests */
    const val DEFAULT_REQUEST_LIMIT = 50

    /** Default offset for paginated requests */
    const val DEFAULT_REQUEST_OFFSET = 0

    /** Default request status filter */
    const val DEFAULT_REQUEST_STATUS = "pending"
}

/**
 * UI-related constants.
 */
object UiConstants {
    /** Maximum number of activity items to display in recent activity list */
    const val ACTIVITY_LIST_MAX_SIZE = 20

    /** Countdown ticker interval in milliseconds */
    const val COUNTDOWN_TICKER_INTERVAL_MS = 60_000L
}

/**
 * Input validation constants.
 */
object ValidationConstants {
    /** Maximum length for key names */
    const val KEY_NAME_MAX_LENGTH = 64

    /** Maximum length for app names/descriptions */
    const val APP_NAME_MAX_LENGTH = 128

    /** Regex pattern for valid key names (alphanumeric, underscore, hyphen) */
    const val KEY_NAME_PATTERN = "^[a-zA-Z0-9_-]+$"

    /** Minimum passphrase length (when provided, must be at least this long) */
    const val PASSPHRASE_MIN_LENGTH = 8

    /** Maximum passphrase length */
    const val PASSPHRASE_MAX_LENGTH = 128
}
