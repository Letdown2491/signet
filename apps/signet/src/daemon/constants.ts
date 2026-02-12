/**
 * Shared constants for the Signet daemon
 */

// Request expiry and polling
export const REQUEST_EXPIRY_MS = 60_000; // 60 seconds
export const POLL_TIMEOUT_MS = 65_000; // 65 seconds (slightly longer than expiry)
export const POLL_INITIAL_INTERVAL_MS = 100;
export const POLL_MAX_INTERVAL_MS = 2_000;
export const POLL_MULTIPLIER = 1.5;

// Web authorization polling (slightly different initial interval for web handlers)
export const WEB_POLL_INITIAL_INTERVAL_MS = 200;

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_BLOCK_DURATION_MS = 60_000; // 1 minute

// JWT
export const JWT_EXPIRY = '7d';

// Relay health monitoring
export const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
export const RECONNECT_INITIAL_DELAY_MS = 1_000; // 1 second
export const RECONNECT_MAX_DELAY_MS = 30_000; // 30 seconds
export const RECONNECT_MULTIPLIER = 2;

// SSE keep-alive
export const SSE_KEEPALIVE_INTERVAL_MS = 30_000; // 30 seconds

// Valid trust levels
export const VALID_TRUST_LEVELS = ['paranoid', 'reasonable', 'full'] as const;

// ACL cache
export const ACL_CACHE_TTL_MS = 30_000; // 30 seconds
export const ACL_CACHE_MAX_SIZE = 1000;

// Subscription manager
export const SUBSCRIPTION_HEALTH_CHECK_INTERVAL_MS = 90_000; // 90 seconds
export const SUBSCRIPTION_RECREATION_TIMEOUT_MS = 10_000; // 10 seconds
export const SUBSCRIPTION_RESTART_DEBOUNCE_MS = 2_000; // 2 seconds

// Relay pool
export const RELAY_WATCHDOG_FAILURE_THRESHOLD = 3; // failures before reset
export const RELAY_WATCHDOG_RESET_COOLDOWN_MS = 5 * 60_000; // 5 minutes between resets
export const RELAY_HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
export const RELAY_SLEEP_DETECTION_THRESHOLD_MS = RELAY_HEARTBEAT_INTERVAL_MS * 3; // 90 seconds

// Input validation limits
export const MAX_KEY_NAME_LENGTH = 64;
export const MAX_APP_NAME_LENGTH = 128;
export const MIN_PASSPHRASE_LENGTH = 8; // Minimum for security
export const MAX_PASSPHRASE_LENGTH = 128;
export const MAX_URI_LENGTH = 2048;
export const MAX_RELAYS_PER_CONNECTION = 10;
