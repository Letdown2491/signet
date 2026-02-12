import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getDeadManSwitchStatus,
  enableDeadManSwitch,
  disableDeadManSwitch,
  resetDeadManSwitch,
  testDeadManSwitchPanic,
  updateDeadManSwitchTimeframe,
  type DeadManSwitchStatus,
} from '../lib/api-client.js';
import { useServerEventsContext } from '../contexts/ServerEventsContext.js';

export interface UseDeadManSwitchResult {
  status: DeadManSwitchStatus | null;
  loading: boolean;
  error: string | null;
  countdown: string;
  urgency: 'normal' | 'warning' | 'critical';
  refresh: () => Promise<void>;
  enable: (timeframeSec?: number) => Promise<{ ok: boolean; error?: string }>;
  disable: (keyName: string, passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
  reset: (keyName: string, passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
  testPanic: (keyName: string, passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
  updateTimeframe: (keyName: string, passphrase: string, timeframeSec: number) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
}

// Time thresholds for urgency levels
const WARNING_THRESHOLD_SEC = 12 * 60 * 60; // 12 hours
const CRITICAL_THRESHOLD_SEC = 60 * 60; // 1 hour

/**
 * Format remaining seconds to human-readable countdown string.
 * Uses adaptive format:
 * - > 24h: "6d 23h"
 * - > 1h: "2h 15m"
 * - > 1m: "15m 30s"
 * - <= 1m: "45s"
 */
function formatCountdown(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '--';

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Get urgency level based on remaining time.
 */
function getUrgency(seconds: number | null): 'normal' | 'warning' | 'critical' {
  if (seconds === null) return 'normal';
  if (seconds <= CRITICAL_THRESHOLD_SEC) return 'critical';
  if (seconds <= WARNING_THRESHOLD_SEC) return 'warning';
  return 'normal';
}

/**
 * Calculate remaining seconds from status.
 * Self-corrects for any drift by computing from lastResetAt.
 */
function calculateRemaining(status: DeadManSwitchStatus | null): number | null {
  if (!status?.enabled || !status.lastResetAt || status.panicTriggeredAt) {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const elapsed = nowSec - status.lastResetAt;
  return Math.max(0, status.timeframeSec - elapsed);
}

export function useDeadManSwitch(): UseDeadManSwitchResult {
  const [status, setStatus] = useState<DeadManSwitchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_tick, setTick] = useState(0); // Force re-render for countdown
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { subscribe } = useServerEventsContext();

  // Refresh status from server
  const refresh = useCallback(async () => {
    try {
      const data = await getDeadManSwitchStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to SSE events
  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === 'deadman:panic' || event.type === 'deadman:reset' || event.type === 'deadman:updated') {
        setStatus(event.status);
      }
      // Also refresh on reconnect to sync state
      if (event.type === 'reconnected') {
        refresh();
      }
    });
    return unsubscribe;
  }, [subscribe, refresh]);

  // Client-side countdown ticker - recalculates from lastResetAt each tick
  useEffect(() => {
    // Clear any existing interval
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Only tick if enabled and not panicked
    if (!status?.enabled || status?.panicTriggeredAt) {
      return;
    }

    // Determine tick interval based on remaining time
    const remaining = calculateRemaining(status);
    const tickInterval = remaining !== null && remaining <= 60 ? 1000 : 60000;

    countdownIntervalRef.current = setInterval(() => {
      setTick(t => t + 1); // Force re-render to recalculate
    }, tickInterval);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.enabled, status?.panicTriggeredAt, status?.lastResetAt, status?.timeframeSec]);

  // Calculate current remaining (recalculated on each render/tick)
  const currentRemaining = calculateRemaining(status);

  // Enable dead man's switch
  const enable = useCallback(async (timeframeSec?: number) => {
    try {
      const result = await enableDeadManSwitch(timeframeSec);
      if (result.ok && result.status) {
        setStatus(result.status);
      }
      return { ok: result.ok, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable';
      return { ok: false, error: message };
    }
  }, []);

  // Disable dead man's switch
  const disable = useCallback(async (keyName: string, passphrase: string) => {
    try {
      const result = await disableDeadManSwitch(keyName, passphrase);
      if (result.ok && result.status) {
        setStatus(result.status);
      }
      return { ok: result.ok, error: result.error, remainingAttempts: result.remainingAttempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disable';
      return { ok: false, error: message };
    }
  }, []);

  // Reset timer
  const reset = useCallback(async (keyName: string, passphrase: string) => {
    try {
      const result = await resetDeadManSwitch(keyName, passphrase);
      if (result.ok && result.status) {
        setStatus(result.status);
      }
      return { ok: result.ok, error: result.error, remainingAttempts: result.remainingAttempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset';
      return { ok: false, error: message };
    }
  }, []);

  // Test panic
  const testPanic = useCallback(async (keyName: string, passphrase: string) => {
    try {
      const result = await testDeadManSwitchPanic(keyName, passphrase);
      if (result.ok && result.status) {
        setStatus(result.status);
      }
      return { ok: result.ok, error: result.error, remainingAttempts: result.remainingAttempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test panic';
      return { ok: false, error: message };
    }
  }, []);

  // Update timeframe
  const updateTimeframe = useCallback(async (keyName: string, passphrase: string, timeframeSec: number) => {
    try {
      const result = await updateDeadManSwitchTimeframe(keyName, passphrase, timeframeSec);
      if (result.ok && result.status) {
        setStatus(result.status);
      }
      return { ok: result.ok, error: result.error, remainingAttempts: result.remainingAttempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update timeframe';
      return { ok: false, error: message };
    }
  }, []);

  return {
    status,
    loading,
    error,
    countdown: formatCountdown(currentRemaining),
    urgency: getUrgency(currentRemaining),
    refresh,
    enable,
    disable,
    reset,
    testPanic,
    updateTimeframe,
  };
}
