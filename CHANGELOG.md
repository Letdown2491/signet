# Changelog

## [1.9.0]

### Added
- **React 19 error handlers**: Enhanced debugging with `onCaughtError` and `onUncaughtError` handlers in main.tsx
  - Errors now log with component stack traces for easier debugging
  - Catches both caught (error boundary) and uncaught errors
- **Instant approval feedback**: Implemented `useOptimistic` hook for approve/deny actions
  - Requests show approved/denied state immediately before API response
  - Falls back gracefully if API call fails
  - Wrapped in `startTransition` for proper React 19 scheduling
- **Graceful shutdown**: Daemon now handles SIGTERM/SIGINT signals properly
  - All services stopped in correct order (backends, subscriptions, relays, HTTP)
  - Database connection closed cleanly
  - Background intervals cleared to prevent process hanging

### Security
- **Kill switch enumeration prevention**: Generic error messages for lock/suspend/resume commands
  - Prevents attackers from discovering valid key/app names via kill switch DMs
  - Success messages still include entity names for usability
- **Minimum passphrase requirement**: Passphrases must be at least 8 characters
  - Prevents weak single-character or trivial passphrases
  - Empty passphrase still allowed for unencrypted keys
  - Validation enforced in daemon, web UI, and Android app
- **ACL cache key collision fix**: Changed delimiter from `:` to null byte
  - Prevents theoretical cache collision if key name contains `:`
- **Android: Encrypted daemon URL storage**: Daemon URL now stored using EncryptedSharedPreferences
  - Uses Android Keystore for AES-256-GCM encryption
  - Automatic migration from unencrypted DataStore on first launch
- **Android: Disabled cloud backup**: Set `android:allowBackup="false"` in manifest
  - Prevents daemon URL and settings from being backed up to Google Drive

### Improved
- **TTL update interval**: Reduced from 1s to 5s in request list
  - 80% reduction in unnecessary re-renders
  - TTL countdown still accurate within 5 seconds
- **Stats emission debouncing**: Added 150ms debounce to dashboard stats updates
  - Reduces database queries when multiple operations happen in quick succession
  - Prevents SSE spam to connected clients
- **Inline SSE event handling**: Request list updates handled without API calls
  - New requests prepended directly from SSE event data
  - Approved/denied/expired requests removed inline
  - Eliminates waterfall API calls when multiple events arrive
- **SSE reconnection race fix**: Prevent multiple simultaneous reconnection attempts
  - Added synchronous ref tracking to avoid async state race conditions
  - Heartbeat handler now checks reconnection state before triggering
  - Eliminates UI flicker and wasted resources from duplicate reconnects

### Android
- **Bug fixes**:
  - Replaced force unwrap (`!!`) operators with safe calls across all screens
  - Added exception handling for SSE event collection in foreground service
  - Fixed EventBus connect() race condition with synchronized block
  - Changed connection state flag to AtomicBoolean for thread safety
- **Resource usage improvements**:
  - Added SSE retry limit (10 consecutive failures before stopping)
  - Debounced notification updates (500ms) to reduce system overhead
  - Countdown ticker only updates when dead man switch is active
- **Performance improvements**:
  - Added LazyColumn keys to all list screens for efficient diffing
  - Moved SSE type extraction regex to class property (compiled once)

### Upgraded
- **React 18 → 19**: Major framework upgrade with performance improvements
  - Automatic batching improvements, optimized rendering
  - New Actions API and hooks available for future enhancements
  - ~32% reduction in render cycles during heavy updates
- **Vite 5 → 7**: Build tooling upgrade
  - Faster builds with improved bundling
  - New `baseline-widely-available` browser target for better compatibility
  - Foundation for future Rolldown bundler integration
- **@vitejs/plugin-react 4 → 5**: Updated for Vite 7 compatibility
- **lucide-react**: Updated for React 19 type compatibility

---

## [1.8.4]

### Fixed
- **Memory leak investigation**: Updated nostr-tools from 2.19.4 to 2.22.1 across daemon and UI
  - SimplePool WebSocket connection management improvements in newer version
  - Monitoring for memory usage improvements
- **TypeScript strict mode fixes**: Fixed type errors in daemon that were masked by skipLibCheck
  - Added missing type exports to @signet/types (`KillSwitchConfig`, `KillSwitchDmType`, `RelayTrustScoreResponse`)
  - Fixed `key:locked` event type missing from SSE event union
  - Updated tsconfig target to ES2022 for `Promise.any` support
  - Fixed Fastify route handler type mismatches with proper type assertions
  - Fixed `ApprovalType` and `TrustLevel` type narrowing issues
  - Replaced deprecated Fastify `PreHandlerHook` import with local `PreHandler` type

### Security
- **Secure default binding**: Changed default `authHost` from `0.0.0.0` to `127.0.0.1`
  - API now binds to localhost only by default, preventing accidental network exposure
  - Users who need network access can explicitly set `authHost: "0.0.0.0"` in config
- **Passphrase DoS mitigation**: Reduced `MAX_PASSPHRASE_LENGTH` from 256 to 128 characters
  - Prevents potential DoS via expensive bcrypt hashing of very long passphrases
  - 128 characters is more than sufficient for any reasonable passphrase

---

## [1.8.3]

### Improved
- **ESLint 9 migration**: Upgraded from ESLint 8 to ESLint 9 with flat config format
  - Updated typescript-eslint to v8 unified package
  - Configured underscore-prefix pattern for intentionally unused variables
- **Added typecheck script**: Run `pnpm typecheck` to catch type errors early
  - Added to both daemon and UI packages
  - Root-level script runs typecheck on all packages
- **Dead code cleanup**: Removed unused code paths for cleaner codebase
  - Removed unused `settingPassphrase`/`onSetPassphrase` props from KeyCard/KeysPanel
  - Removed unused bulk selection props from RequestsPanel (functionality preserved in hook)
  - Removed unused `connectionInfo` state from App.tsx
  - Deleted orphaned Header component and related files
  - Removed unused `context` parameter from error formatter functions

---

## [1.8.2]

### Dependencies
- **Daemon**: Updated Prisma 7.2.0→7.3.0, Fastify 5.6.2→5.7.2, @fastify/view 10.0.2→11.1.1, ws 8.18.3→8.19.0, better-sqlite3 12.5.0→12.6.2, eventemitter3 5.0.1→5.0.4, websocket-polyfill 0.0.3→1.0.0, yargs 17.7.2→18.0.0, eslint-config-prettier 8.10.2→10.1.8, vitest 4.0.16→4.0.18, @types/node 20.x→25.x
- **Daemon**: Removed unused dependencies: @scure/base (provided by nostr-tools), @inquirer/prompts, @inquirer/password, dotenv (provided by Prisma)
- **UI**: Updated Express 4.21.2→5.2.1, ESLint 9.38.0→9.39.2, eslint-plugin-react-hooks 5.2.0→7.0.1, vitest 4.0.16→4.0.18, lucide-react 0.562.0→0.563.0, @testing-library/react 16.3.1→16.3.2, focus-trap-react 11.0.4→12.0.0, globals 16.5.0→17.3.0, @types/node 20.x→25.x
- **Requires Node.js 20.19+** due to ESM-only dependencies (yargs 18, @scure/base 2.0)

---

## [1.8.1]

### Added
- **NIP-46 `switch_relays` method**: Clients can request the signer's preferred relay list
  - Returns JSON array of relay URLs for connected apps
  - Requires existing connection (KeyUser record) - unauthenticated clients receive "Not authorized"
  - Implements [NIP-46 switch_relays proposal](https://github.com/nostr-protocol/nips/pull/2193)

---

## [1.8.0]

### Added
- **Relay trust scores**: Integration with trustedrelays.xyz API for relay reputation
  - Daemon fetches trust scores on startup and refreshes hourly
  - Scores displayed as color-coded badges in sidebar and System Status modal
  - NostrConnect modal shows trust scores for app-specified relays (fetched on-demand)
  - New API endpoint `POST /relays/trust-scores` for on-demand score lookups
  - Score thresholds: ≥80 green (excellent), 60-79 teal (good), 40-59 yellow (fair), <40 red (poor)
  - Shows "?" badge when score unavailable
  - URL normalization strips trailing slashes for consistent cache keys
  - Informational only - does not affect relay usage
- **Android: Trust score badges** in System Status and Connect App sheets
  - Same color-coded display as Web UI
  - Two-column grid layout for relay badges in Connect App sheet
  - Added Teal color to theme for "good" score range
- **Help documentation**: Added "Relay Trust Scores" section to Help page (Web UI and Android)

### Improved
- **Web UI: NostrConnect modal redesign**
  - Cleaner sectioned layout: "Detected App", "Details" (collapsible), "Connection Settings"
  - Relays displayed as two-column grid with trust score badges
  - Technical details (client ID, URL, permissions) collapsed by default
  - Reduced textarea rows for more compact appearance

---

## [1.7.0]

### Added
- **NIP-49 encryption support**: Industry-standard key encryption using XChaCha20-Poly1305 with scrypt KDF
  - New keys can be encrypted with NIP-49 (recommended) or legacy AES-256-GCM format
  - Import existing `ncryptsec` keys directly without re-encryption
  - Interactive encryption format selection during key creation (web UI and CLI)
- **Key export functionality**: Export keys for backup or migration
  - Choose between NIP-49 (ncryptsec) or plaintext (nsec) format
  - Downloads as a text file with key name, npub, and secret
  - Requires passphrase verification for encrypted keys
- **Key encryption migration**: Upgrade existing keys from legacy to NIP-49 encryption
  - "Migrate to NIP-49" option in key details for legacy-encrypted keys
  - Requires current passphrase and new passphrase confirmation
  - Logged as `key_migrated` admin event for audit trail
- **CLI encryption flags**: Non-interactive key management
  - `signet add --nip49`: Use NIP-49 encryption (recommended)
  - `signet add --legacy`: Use legacy AES-256-GCM encryption
  - `signet add --no-encrypt`: Store key unencrypted (not recommended)
  - Interactive prompt when no flag specified (defaults to NIP-49)
- **New admin event types**: Extended activity tracking
  - `key_encrypted`: Key encryption applied during creation
  - `key_migrated`: Key encryption migrated to NIP-49
  - `key_exported`: Key exported (ncryptsec or nsec)
  - `auth_failed`: Authentication failure
  - `panic_triggered`: Dead man switch panic triggered
  - `deadman_reset`: Inactivity timer reset
- **NIP-49 unit tests**: Spec test vector verification for encryption/decryption
- **Health endpoint: Log buffer stats**: `/health` now includes log buffer memory usage
  - Shows entries count, max capacity, and estimated memory in KB
  - Helps monitor in-memory log buffer overhead

### Improved
- **Web UI: Key details redesign**
  - Connected Apps section now collapsible with count badge (replaces "Show X more" pattern)
  - Export section uses expandable label pattern (cleaner than separate label + button)
  - Removed redundant "Online"/"Locked" text badges (status dot is sufficient)
- **Web UI: Sidebar + button** now opens create key form and navigates to Keys page
- **Human-readable admin event labels**: All admin events now display user-friendly text
  - `key_migrated` → "Encryption migrated"
  - `key_exported` → "Key exported"
  - `panic_triggered` → "Panic triggered"
  - `deadman_reset` → "Inactivity timer reset"
- **Android: Admin event labels** updated to match web UI
- **Web UI: Real-time system status** via SSE (no polling)
  - Backend emits `health:updated` every 10 seconds for metrics (memory, uptime)
  - Key operations (unlock, lock, create, delete) emit health updates instantly
  - ~50% less bandwidth than polling (SSE messages vs HTTP requests)
  - Initial fetch on page load, then SSE-only

### Fixed
- **Key export**: Fixed response format mismatch causing export button to appear non-functional
- **Import ncryptsec**: Fixed incorrect passphrase confirmation requirement when importing already-encrypted keys
- **Delete unlocked key**: Fixed "passphrase required" error when deleting an already-unlocked encrypted key
- **Memory leak: Rate limit store**: Replaced unbounded Map with TTLCache
  - Under high traffic, the rate limit store could grow indefinitely since cleanup only ran every 60s
  - Now uses TTLCache with 10,000 max entries, automatic cleanup every 30s, and LRU eviction
  - TTL set to block duration + window to ensure blocked entries persist appropriately

### Dependencies
- **nostr-tools**: Upgraded from 2.17.0 to 2.19.4 for bug fixes and memory improvements

---

## [1.6.2]

### Fixed
- **Daemon: Memory leak in AdminCommandService reconnection timers**
  - Reconnection `setTimeout` calls were not tracked or cleared during refresh/shutdown
  - Closures in timers held references to relay URLs, filters, and generation counters
  - Added `reconnectTimers` Set to track pending timers, cleared on `closeAllWebsockets()`
  - Added exponential backoff with max 10 retries per relay
  - Retry counts reset on successful connection

- **Daemon: Memory leak in AdminCommandService publishEvent**
  - WebSockets created for publishing confirmation DMs were not cleaned up after `Promise.any()` resolved
  - Orphaned sockets and their timeouts accumulated when publishing to multiple relays
  - Added try/finally cleanup that closes all WebSockets and clears timeouts after publish completes

- **Daemon: Memory leak in ACL cache**
  - Manual Map-based cache only cleaned expired entries on access
  - Entries that were never re-accessed persisted until max size forced eviction
  - Migrated to `TTLCache` with automatic background cleanup every 60 seconds
  - Provides proper LRU eviction and stats via `getAllCacheStats()`

---

## [1.6.1]

### Fixed
- **Android: Biometric unlock button unresponsive after cancellation** ([#39](https://github.com/Letdown2491/signet/issues/39))
  - Pressing "Unlock" after dismissing the biometric prompt did nothing
  - Changed from boolean flag to counter so each button press triggers a new prompt
- **Android: Force-close bypassed app lock requirement** ([#39](https://github.com/Letdown2491/signet/issues/39))
  - App lock was incorrectly bypassed when force-closing and reopening the app
  - Now persists last activity timestamp to survive app restarts
  - Timeout setting (immediately, 1 min, 5 min, 15 min) now works correctly for both backgrounding and closing the app
- **Daemon: Memory leak in AdminCommandService (kill switch)**
  - WebSocket event listeners were not removed when connections closed during refresh cycles
  - Each refresh created new connections with 4 event handlers that kept references to captured variables
  - Added `ws.removeAllListeners()` before closing WebSockets to properly release memory
  - Reduced `processedEventIds` cache TTL from 24 hours to 1 hour to limit memory usage
- **Daemon: Memory leak in SSE event handlers**
  - Event listeners registered on request/response objects were never removed after cleanup
  - Refactored to use named handler functions that are explicitly removed with `.off()` on disconnect
  - Prevents closure accumulation when SSE clients reconnect

---

## [1.6.0]

### Added
- **Android: Deep link and share target support for nostrconnect:// URIs**
  - Tap `nostrconnect://` links from any app to open directly in Signet
  - Share text containing `nostrconnect://` URIs to Signet via Android share sheet
  - New dedicated `DeepLinkConnectSheet` for streamlined connection flow
  - Automatically extracts app name, relays, and permissions from URI
- **Daemon: Structured logging with timestamps** ([#35](https://github.com/Letdown2491/signet/issues/35))
  - All log entries now include ISO timestamps for easier debugging and log aggregation
  - New `LOG_LEVEL` environment variable: `debug`, `info`, `warn`, `error` (default: `info`)
  - New `LOG_FORMAT` environment variable: `pretty` (default) or `json` for log aggregators
  - Zero dependencies - custom logger with pino-compatible API for future migration
  - Structured data support: `logger.info('message', { key: 'value' })`
  - Child loggers for contextual logging (e.g., per-key context)
  - Works seamlessly with systemd `StandardOutput=append:` for log file redirection
- **Web UI: Logs page for real-time daemon log viewing**
  - New "Logs" entry in sidebar between Activity and Keys
  - In-memory ring buffer stores last 1000 log entries
  - Real-time streaming via SSE - logs appear instantly as they're generated
  - Filter by log level (debug, info, warn, error)
  - Text search across log messages
  - Pause/resume live updates
  - Expandable metadata view for structured log data
  - `GET /logs` API endpoint with level, search, and limit query params
- **Daemon: Centralized utilities for better code quality**
  - `lib/errors.ts`: Safe error message extraction from unknown types, HTML escaping for XSS prevention
  - `lib/validation.ts`: Input validation for key names, app names, passphrases, URIs, and relay lists
  - `lib/parse.ts`: Safe NIP-46 param parsing that handles both array and object formats
  - `lib/ttl-cache.ts`: Generic TTL cache with LRU eviction, background cleanup, and stats reporting
- **Web UI: Structured API client error handling**
  - `ApiError` class preserves HTTP status code with helper methods (`isCsrfError`, `isAuthError`, `isServerError`)
  - `TimeoutError` class for request timeout handling
  - Request deduplication prevents multiple simultaneous identical requests
  - Configurable request timeout with AbortController-based cancellation
- **Web UI: Hook refactoring for better separation of concerns**
  - `useRequestFilters.ts`: Extracted filter, search, and sort logic from useRequests
  - `useRequestSelection.ts`: Extracted bulk selection state management from useRequests
- **Web UI: Copy bunker URI button in sidebar keys**
  - Each online key now has a copy icon button for quick bunker URI access
  - Generates a one-time connection token and copies the full bunker URI
  - Shows loading spinner while generating, checkmark on success
- **Web UI: Bulk key and app management**
  - Keys page: Lock All button (lock icon) locks all unlocked keys with confirmation
  - Apps page: Suspend/Resume toggle button (pause/play icon)
    - Shows pause icon when any apps active → opens suspend modal with duration picker
    - Shows play icon when all apps suspended → resumes all immediately
  - New API endpoints: `POST /keys/lock-all`, `POST /apps/suspend-all`, `POST /apps/resume-all`
- **Android: Bulk key and app management**
  - Keys screen: Lock All button (lock icon) with confirmation dialog
    - Only enabled when lockable keys exist (online + encrypted)
    - Shows spinner during operation, toast on completion
  - Apps screen: Suspend/Resume toggle button (pause/play icon)
    - Pause icon when any apps active → opens SuspendAllAppsSheet with duration picker
    - Play icon when all apps suspended → resumes all immediately
    - Duration options: indefinite or until specific date/time with quick buttons (+1h, +8h, Tomorrow)
- **Android: Centralized constants** (`util/Constants.kt`)
  - `NetworkConstants`: HTTP timeouts, SSE reconnect delays, retry attempts
  - `ApiConstants`: Default pagination values
  - `UiConstants`: Activity list size, countdown interval
  - `ValidationConstants`: Key name patterns, passphrase limits
- **Android: Error formatting utility** (`util/ErrorFormatter.kt`)
  - User-friendly error messages for network errors, HTTP 4xx/5xx, timeouts, SSL issues
  - Suggested actions for each error type
  - `isRetryable()` function to determine if an error is transient
- **Android: HTTP timeout and retry configuration**
  - Configurable request, connection, and socket timeouts
  - Automatic retry with exponential backoff for transient errors
  - Applied to all read operations (getDashboard, getRequests, getKeys, getApps, etc.)
- **Android: Sensitive data cleanup** (`util/SensitiveDataUtils.kt`)
  - `ClearSensitiveDataOnDispose` composable clears passphrase fields when sheets close
  - Applied to CreateKeySheet, KeyDetailSheet, RequestDetailSheet, InactivityLockScreen
- **Android: Input validation** (`util/InputValidation.kt`)
  - Validators for key names, daemon URLs, app names, passphrases, nsec keys
  - Real-time validation feedback in CreateKeySheet
- **Android: Button debouncing** (`util/Debounce.kt`)
  - `rememberDebouncedClick()` composable prevents rapid repeated clicks

### Improved
- **Android: Simplified NostrConnect UI**
  - Replaced verbose client info box with compact "via relay.example.com and X others" summary
  - Consistent UX between deep link flow and manual connect flow (Apps → + button)
  - Reduced visual noise while preserving essential connection information
- **Android: Refactored connect app components for better maintainability**
  - Extracted shared components (`KeyOption`, `TrustLevelOption`, `PermissionsBadges`) to `ConnectAppComponents.kt`
  - `ConnectAppSheet` and `DeepLinkConnectSheet` now share common UI components

## [1.5.1]

### Improved
- Daemon: Consistent error handling across all routes using centralized utilities
- Daemon: Input validation applied to all user-provided data (key names, passphrases, URIs)
- Web UI: useRequests hook is now smaller and more maintainable through composition
- Android: SSE client uses centralized constants instead of hardcoded delay values
- Android: SignetService uses centralized constants for countdown ticker interval
- Android: CreateKeySheet shows real-time validation errors for key name and nsec fields
- **Unified status indicators across Web UI and Android**
  - Keys: Green dot = online, Orange dot = locked, Gray dot = offline
  - Apps: Green dot = active, Gray dot = suspended
  - Suspended app names now display with muted text
  - Web UI Apps page shows "Suspended" instead of last active time for suspended apps
- **System Status widget: "Lock Now" renamed to "Reset"** for consistency with sidebar's "Reset Inactivity Lock" action (both Web UI and Android)
- Android: KeyDetailSheet layout updated to match KeyCard (status dot + encryption badge instead of lock icon + status text)
- Android: Removed duplicate key status indicators (lock icon next to name removed, StatusBadge replaced with EncryptionBadge)

### Fixed
- **Web UI: Inactivity lock countdown stopping after extended periods**
  - Countdown now calculates remaining time from `lastResetAt` timestamp on each tick
  - Self-corrects for any drift caused by browser throttling background tabs
  - Previously, the interval-based decrement would eventually stop updating
- **Web UI: Clipboard copy not working in non-secure contexts** ([#9](https://github.com/Letdown2491/signet/issues/9))
  - Fixed regression in ConnectAppModal where "Copy URI" button used `navigator.clipboard.writeText()` directly
  - Now uses `copyToClipboard()` utility with legacy `execCommand` fallback for HTTP access (e.g., Tailscale IP)

---

## [1.5.0]

### Added
- **Unified Connect App modal**: Two tabs for both connection methods in one place
  - **Bunker URI tab**: Generate and share bunker URIs with QR code, expiry countdown, copy button
  - **NostrConnect tab**: Paste or scan nostrconnect:// URIs from apps
  - Web UI: QR code scanning via camera (uses html5-qrcode library)
  - Android: QR code scanning via camera (existing ML Kit integration)
  - Both platforms support paste-from-clipboard for quick URI entry
  - Parses and validates URI components (client pubkey, relays, secret, permissions)
  - Shows app name, client info, and requested permissions before connecting
  - Trust level selection during connection
- New API endpoint: `POST /nostrconnect` for connecting via nostrconnect:// URI
- New API endpoint: `POST /connections/refresh` for forcing relay pool reset when connections are silently dead
- Documentation: Added fail2ban integration guide to DEPLOYMENT.md for recovering from silent WebSocket connection failures
- **Per-app relay subscriptions**: NIP-46 spec-compliant relay handling for nostrconnect apps
  - Apps connected via nostrconnect:// can use their own relays for NIP-46 requests
  - Responses are published to both daemon's relays and the app's specified relays
  - Subscriptions are automatically cleaned up when apps are revoked
- **Inactivity Lock in System Status**: Both platforms now show lock status and "Lock Now" button
  - Web UI: System Status modal shows countdown timer with urgency coloring (normal/warning/critical)
  - Web UI: "Lock Now" button triggers passphrase confirmation dialog
  - Android: System Status sheet shows countdown timer and Lock Now functionality
  - Key selector shown when multiple active keys exist
- **Activity logging for nostrconnect connections**: Apps connected via nostrconnect:// now appear in Activity
  - New `app_connected` admin event logged when connecting via nostrconnect:// URI
  - Displays in Recent widget and Activity page with Link icon
  - Shows app name, key name, and connection source (web UI or Android)
  - Provides visibility parity with bunker:// connections which already logged activity

### Improved
- Web UI: Bundle code splitting for faster initial load
  - Vendor chunks for React, QR libraries, and nostr-tools
  - QR scanner lazy-loaded only when needed
- Empty state messaging now explains both connection methods:
  - "Tap/Click + for NostrConnect, or share your key's bunker URI with an app"
- Permissions vs trust level clarification in Connect App modal/sheet:
  - Added hint text: "These are what the app says it needs. Your trust level controls what actually gets auto-approved."
- Partial success handling: Shows warning when app is connected but relay notification failed
- Better duplicate app detection with clearer error message
- **Android Settings page condensed**:
  - Trust level selection now uses dropdown instead of full-height rows
  - App Lock timeout selection now uses inline dropdown
  - App Lock and Inactivity Lock merged into single "Security" card
  - Removed Test Panic button (functionality moved to System Status sheet)
- **Android Inactivity Lock screen**: Now allows key selection when multiple locked keys exist

### Fixed
- Android: Key state changes (lock/unlock) now properly refresh available keys in Connect App sheet
- Android: Activity page filter tabs now scroll horizontally on narrow screens
- Android: Admin event badges and text now use blue to match web UI
- Web UI: Key selection resets when selected key becomes unavailable
- QR scanner feedback for invalid codes (bunker:// URIs, web URLs, other non-nostrconnect content)
- Relay URL validation catches malformed URLs before connection attempt
- Android: Fixed memory leak in SignetNavHost where API client wasn't closed on URL change
- Android: Fixed API client resource leak in 5 screens (HomeScreen, ActivityScreen, AppsScreen, KeysScreen, SetupScreen) - client now closed in finally block
- Daemon: Denied requests now include app name in activity feed (previously only showed npub)
- Daemon: Fixed silent WebSocket connection failures causing NIP-46 subscriptions to stop working (#28)
  - Health check now recreates actual managed subscriptions instead of throwaway ping subscriptions
  - Each health check both tests AND refreshes one subscription (round-robin rotation)
  - Guarantees all subscriptions get fresh connections every N×90s (where N = number of keys)
  - Previously, health checks could pass while actual NIP-46 subscriptions remained dead on stale connections

### Security
- Daemon logs warning at startup when CORS wildcard origin (*) is configured (fine for testing, but not production)
- Config file permissions now set to 0600 (owner read/write only) after creation

---

## [1.4.0]

### Added
- Admin activity logging: Track key lock/unlock, app suspend/resume, and daemon start events
  - New "Admin" tab in Activity page to view admin-only events
  - Admin events appear in Recent activity widget on Home page
  - Admin events included in "All" filter on Activity page
  - Events show source: "via Signet UI", "via Kill Switch", or "via Signet Android"
- Kill switch command audit logging: All DM commands are now logged
  - New `command_executed` event type records every command and its result
  - Commands logged even when no state change occurs (e.g., locking already-locked key)
  - Provides full audit trail for security review
- Kill switch status command: Send `status` DM to check daemon state
  - Returns active/locked keys, suspended apps count
  - Logged as `status_checked` admin event
- Web UI: System Status widget replaces Relays widget on dashboard
  - Shows daemon uptime with health status label (Healthy/Degraded/Offline)
  - HeartPulse icon color indicates status (green/yellow/red)
  - Click opens System Status modal with full details:
    - Status badge, uptime, memory usage, active listeners, connected clients, last pool reset, key stats
    - Expandable relay section showing per-relay connection status
- Android: System Status widget replaces Relays widget on dashboard (matches web UI)
  - Shows daemon uptime with health status label (Healthy/Degraded/Offline)
  - Heart icon color indicates status (green/yellow/red)
  - Tap opens System Status sheet with full health details and expandable relay section
- Android: X-Signet-Client header sent with all API requests for client identification

### Improved
- SSE real-time updates: Activity feeds now update instantly without API refresh
  - `request:approved`, `request:denied`, and `request:auto_approved` events now include `activity` field
  - Web UI Recent activity widget updates in real-time for all approval types
  - Android Home screen Recent activity updates via SSE data (no API refresh needed)
  - New `ping` event type for SSE heartbeat (fixes reconnection issues)
- Daemon: Enhanced health monitoring
  - Health status now logged every 30 minutes (was 1 hour)
  - Event-triggered logging after pool reset and key lock/unlock
  - Rich `/health` endpoint returns full JSON status for programmatic monitoring
  - Response includes: uptime, memory, relay connections, key counts, subscriptions, SSE clients, last pool reset
- Uptime display: More compact formatting with 2 significant units max
  - Short uptimes: `45s`, `5m`, `2h 30m`, `3d 12h`
  - Long uptimes switch to months/years: `2mo 15d`, `1y 3mo`
  - Consistent across web UI and Android
- Added KILLSWITCH.md to document new killswitch by DM feature

### Fixed
- Daemon: NIP-46 requests now work correctly after system suspend/resume
  - RelayPool detects sleep/wake cycles (30s heartbeat, >90s gap triggers reset)
  - SubscriptionManager has fallback detection (60s health check, >3min gap triggers reset)
  - Two-layer detection ensures recovery even after very long sleep periods
  - Pool reset creates fresh SimplePool and emits events for dependent services
  - SubscriptionManager recreates NIP-46 subscriptions on pool reset
  - AdminCommandService (kill switch) refreshes its WebSocket connections on wake
- Docker: Custom SIGNET_PORT now works correctly (#27)
  - Fixed port mapping to use dynamic port on both sides
  - Fixed healthcheck to use configured port
  - Fixed DAEMON_URL to use configured port for UI→daemon communication

---

## [1.3.0]

### Security
- Bunker URIs now use one-time connection tokens instead of persistent secrets
  - Each "Generate bunker URI" click creates a fresh token that expires in 5 minutes
  - Tokens can only be redeemed once (atomic redemption prevents race conditions)
  - Existing `admin.secret` connections continue to work as fallback for backwards compatibility
  - Once a client connects, their pubkey is remembered—no token needed for future requests

### Added
- Approval type tracking: Activity now shows why requests were approved (#20)
  - ✓ Approved (checkmark) - manually approved by you
  - 🛡 Approved (shield) - auto-approved by app's trust level
  - 🔁 Approved (repeat) - auto-approved by saved "Always Allow" permission
  - Tooltips explain each badge on hover (web UI)
  - Help page documents badge meanings
  - Consistent across web UI and Android app
- Lock/unlock icons in sidebar for quick key management
  - Lock icon (open padlock) shown for unlocked encrypted keys
  - Unlock icon (closed padlock) shown for locked keys
  - Click to lock/unlock without navigating to Keys page
- Timed app suspension: suspend apps until a specific date and time
  - Choose "Until I turn it back on" for indefinite suspension
  - Or select a specific date and time for automatic resumption
  - Suspension badge shows "Suspended until [time]" for timed suspensions
  - Apps automatically resume when the suspension period ends

### Changed
- Web UI: Bunker URI button now opens a modal with QR code display, countdown timer, and copy button
- Android: Bunker URI button now opens a sheet with QR code display, countdown timer, and copy button
- Android: Suspend dialog now shows duration options with quick presets (+1h, +8h, Tomorrow)
- Android: Password fields now support autofill for password managers (Proton Pass, 1Password, etc.)

### Fixed
- Web UI & Android: Bunker URI preview now correctly shows hex pubkey format instead of bech32 (npub)
- Web UI: Added full favicon support for all browsers (PNG icons, apple-touch-icon, web manifest) to fix missing icons in pinned tabs
- Data migration backfills `approvalType` for historical records, ensuring consistent badge display
- Android: Fixed incorrect GitHub URL in Help screen

### Improved
- Daemon stability: Added comprehensive monitoring and recovery mechanisms
  - Global exception handlers catch and log unhandled errors instead of crashing silently
  - Hourly health status logging (uptime, memory usage, SSE clients, relay connections)
  - Watchdog automatically resets relay pool after 3 consecutive health check failures
  - SSE client cleanup now handles error and socket close events to prevent resource leaks
- Documentation: Added PM2 and Docker Compose sections to DEPLOYMENT.md with restart policies and health checks

---

## [1.2.1]

### Added
- Android: Added collapsible "Raw JSON" view to request details sheet with copy to clipboard
- Android: Trust level badges in Apps list now show icons
- Android: Trust level options in Settings now show icons
- Android: Dashboard stat cards now show icons
- Documentation: Added sample systemd and runit service files for daemon and UI to DEPLOYMENT.md

### Changed
- Web UI: Home page widgets now use two-line layout matching Android (app name first, event details below)
- Web UI: Activity page and Recent widget cards redesigned with two-line format: app name • key + status badge on first line, event info (Details) • timestamp on second line
- Web UI: Status indicators now display as colored pill badges (Auto Approved, Approved, Denied, Expired, Pending)
- Web UI & Android: Changed "Auto" badge text to "Auto Approved" for clarity

### Fixed
- Android: Fixed serialization error when using "Always allow" checkbox (#19)
- Web UI: Added "Always allow" checkbox to Home page Pending widget which was previously only available on Activity page
- Web UI: Pending widget now shows app name instead of npub when available
- Web UI: Fixed Recent widget icons not displaying correctly (was checking wrong status values)

---

## [1.2.0]

### Security
- Fixed CVE-2024-21536: Upgraded http-proxy-middleware from 2.0.6 to 3.0.5 (DoS vulnerability)
- Replaced unmaintained http-proxy with http-proxy-3 via pnpm override

### Added
- Daemon startup now shows QR code for each network address (Local and Tailscale) instead of only when one address exists
- Tailscale IPs (100.64.0.0/10 range) are now labeled as "(Tailscale)" in startup output
- Documentation: Added WireGuard deployment guide to DEPLOYMENT.md

### Changed
- Build scripts now use pnpm filter syntax instead of npm workspace to eliminates npm config warnings
- Daemon startup script calls prisma directly instead of via npm to eliminate Node.js deprecation warnings
- UI production server refactored for http-proxy-middleware v3 API

### Fixed
- Eliminated all startup warnings in both daemon and UI server
- Docker: UI Dockerfile now copies full signet-types before install to fix prepare script failure
- Docker: UI runtime pins express@4 and http-proxy-middleware@3 to fix Express v5 incompatibility
- Docker: Fixed UI_PORT environment variable not working correctly in docker-compose

---

## [1.1.1]

### Added
- Daemon now shows local network IP addresses on startup for easier mobile setup
- QR code displayed on startup when a single network address is detected (for quick Android app configuration)
- Container detection: when running in Docker, shows helpful message instead of container-internal IP
- Android app: QR code scanner for quick server URL configuration (scan the QR code from daemon startup)

### Fixed
- Fixed "Failed to resolve entry for package @signet/types" error when running `pnpm run dev` after fresh clone (types package now builds automatically on install)
- Android app: Fixed confusing placeholder text in server URL field (was emulator-specific `10.0.2.2`)

---

## [1.1.0]

### Added
- Android app: Dashboard stat widgets (Active Keys, Apps, Relays) are now tappable. Active Keys and Apps navigate to their respective pages, Relays opens a status sheet showing connection details
- Web UI: Dashboard stat cards are now clickable. Active Keys, Apps, and Activity navigate to their pages; Relays opens a modal showing connection details for each relay
- Active Keys widget now shows "active/total" format" to indicate how many keys are unlocked
- Added single `VERSION` file at repo root, used by all apps (run `pnpm sync-version` after updating)

### Improved
- Android app: Setup screen now explains what the app does and links to documentation
- Android app: Setup screen tests server connection before proceeding, with helpful error messages

### Fixed
- Android app: Revoking apps now works correctly (fixed empty JSON body causing "Bad request" error)
- Android app: All screens now update in real-time via SSE (Dashboard stats, Keys, Apps, Activity pages)
- Web UI: All screens now update in real-time via SSE (Dashboard stats, Keys, Apps, Activity pages)

---

## [1.0.0]

### Added
- Native Android app for mobile key management
- App names displayed throughout UI instead of truncated npubs
- Auto-approved requests now logged and visible in Activity feed
- All NIP-46 events (sign_event, nip04/nip44 encrypt/decrypt) now appear in Activity
- Denied requests tracked and visible in Activity feed with dedicated Denied tab
- Real-time updates via Server-Sent Events
- Batch approval for multiple pending requests
- Search and filtering for requests and apps
- Command palette (Cmd+K / Ctrl+K)
- Relay health monitoring with auto-reconnect
- Help page with documentation and keyboard shortcuts
- NIP-04 encryption support for legacy clients
- Added DEPLOYMENT.md to document how to run Signet behind Tailscale
- Added dashboard and help page screenshots
- SSE events for app revoke/update and key rename/passphrase changes
- SSE connection reliability: heartbeat monitoring, page visibility handling, network status awareness, automatic state refresh on reconnection
- Default trust level setting for new app connections

### Changed
- CSRF protection now skipped for Bearer token authentication (API clients using `Authorization: Bearer` header no longer need CSRF tokens)
- Complete UI redesign with dark theme and sidebar navigation
- WCAG 2.1 AA accessibility compliance
- Connect flow now always requires manual approval with trust level selection
- Simplified trust level labels: "Always Ask", "Auto-approve Safe", "Auto-approve All"
- User-friendly method labels throughout UI (e.g., "Sign a note" instead of "sign_event")
- Activity page tabs reorganized: "All" (default), "Approved", "Denied", "Expired" (removed "Pending" since Home handles it)
- Switched Docker images from node:20-alpine to node:20-slim to avoid building better-sqlite3 from source on image rebuids.
- Updated all documentation to reflect current state of backend and frontend
- SSE keep-alive interval reduced from 30s to 15s for better proxy compatibility

### Removed
- OAuth account creation flow
- NDK dependency (replaced with nostr-tools)
- Auto-refresh settings (SSE handles all real-time updates)

### Fixed
- Relay subscriptions now recover after system sleep/wake
- Pending count excludes expired requests
- Various race conditions and error handling improvements
- All approved requests now logged to Activity (not just trust-level auto-approvals)
- Trust level changes now properly enforced: downgrading from "full" removes explicit permissions that would bypass trust level checks

### Security
- JWT authentication required for all sensitive endpoints
- Upgraded to AES-256-GCM encryption with PBKDF2 (600k iterations)
- CSRF protection, rate limiting, timing-safe comparisons

---

## [0.10.5]

Initial public release of Signet fork from nsecbunkerd.

### Added
- Modern React dashboard UI
- NIP-46 remote signing support
- Multi-key management
- Web-based request approval flow
- Docker Compose deployment
