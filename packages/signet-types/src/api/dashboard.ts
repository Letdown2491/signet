/**
 * Dashboard statistics summary
 */
export interface DashboardStats {
    totalKeys: number;
    activeKeys: number;
    connectedApps: number;
    pendingRequests: number;
    recentActivity24h: number;
}

/**
 * Approval type for activity tracking
 * - manual: User explicitly approved via web UI or API
 * - auto_trust: Auto-approved by trust level rules
 * - auto_permission: Auto-approved by previous "Always Allow" (SigningCondition)
 */
export type ApprovalType = 'manual' | 'auto_trust' | 'auto_permission';

/**
 * A single activity entry for the dashboard timeline (NIP-46 requests)
 */
export interface ActivityEntry {
    id: number;
    timestamp: string;
    type: string;
    method?: string;
    eventKind?: number;
    keyName?: string;
    userPubkey?: string;
    appName?: string;
    autoApproved: boolean;
    approvalType?: ApprovalType;
}

/**
 * Admin event types for admin activity tracking
 */
export type AdminEventType =
    | 'key_locked'
    | 'key_unlocked'
    | 'key_encrypted'
    | 'key_migrated'
    | 'key_exported'
    | 'auth_failed'
    | 'app_connected'
    | 'app_suspended'
    | 'app_unsuspended'
    | 'daemon_started'
    | 'status_checked'
    | 'command_executed'
    | 'panic_triggered'
    | 'deadman_reset';

/**
 * An admin activity entry (key lock/unlock, app suspend/unsuspend, daemon start, status check, command executed)
 */
export interface AdminActivityEntry {
    id: number;
    timestamp: string;
    category: 'admin';
    eventType: AdminEventType;
    keyName?: string;
    appId?: number;
    appName?: string;
    clientName?: string;
    clientVersion?: string;
    ipAddress?: string;
    command?: string;
    commandResult?: string;
}

/**
 * Union type for mixed activity feed (NIP-46 requests + admin events)
 */
export type MixedActivityEntry = ActivityEntry | AdminActivityEntry;

/**
 * Dashboard API response
 */
export interface DashboardResponse {
    stats: DashboardStats;
    activity: ActivityEntry[];
}
