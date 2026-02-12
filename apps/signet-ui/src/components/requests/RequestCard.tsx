import React, { useState, useMemo } from 'react';
import { Check, Shield, Repeat } from 'lucide-react';
import type { DisplayRequest, RequestMeta, TrustLevel } from '@signet/types';
import { getKindLabel, getMethodLabel, getTrustLevelBehavior, parseConnectPermissions, formatPermission } from '@signet/types';
import { getMethodInfo, getTrustLevelInfo } from '../../lib/event-labels.js';
import { formatTtl, truncateContent } from '../../lib/formatters.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import styles from './RequestCard.module.css';

interface RequestCardProps {
  request: DisplayRequest;
  meta: RequestMeta;
  password: string;
  selectionMode: boolean;
  selected: boolean;
  onPasswordChange: (password: string) => void;
  onApprove: (trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number) => void;
  onSelect: () => void;
  onViewDetails: () => void;
}

export function RequestCard({
  request,
  meta,
  password,
  selectionMode,
  selected,
  onPasswordChange,
  onApprove,
  onSelect,
  onViewDetails,
}: RequestCardProps) {
  const { settings } = useSettings();
  const [selectedTrustLevel, setSelectedTrustLevel] = useState<TrustLevel>(settings.defaultTrustLevel);
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  const { Icon: MethodIcon } = getMethodInfo(request.method);
  const isApproving = meta.state === 'approving';
  const isPending = request.state === 'pending';
  const canApprove = isPending && !isApproving;

  const trustLevels: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

  // For completed events, show event kind inline
  const eventKind = request.eventPreview?.kind;
  const showCompact = !isPending;

  // Parse requested permissions from connect params
  const requestedPermissions = useMemo(() => {
    if (request.method !== 'connect' || !request.params) return [];
    try {
      const params = JSON.parse(request.params);
      // NIP-46 connect params: [pubkey, secret?, perms?]
      const permsStr = Array.isArray(params) ? params[2] : undefined;
      return parseConnectPermissions(permsStr);
    } catch {
      return [];
    }
  }, [request.method, request.params]);

  // Get behavior for selected trust level
  const trustBehavior = getTrustLevelBehavior(selectedTrustLevel);

  return (
    <div className={`${styles.card} ${styles[request.state]} ${showCompact ? styles.compact : ''}`}>
      {selectionMode && isPending && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onSelect(); }}
          onClick={(e) => e.stopPropagation()}
          className={styles.checkbox}
          aria-label={`Select request ${request.id}`}
        />
      )}

      {/* Icon on the left, spanning both lines */}
      <div className={styles.iconWrapper} aria-hidden="true">
        <MethodIcon size={18} />
      </div>

      {/* Content on the right */}
      <div className={styles.content}>
        {/* Line 1: App name • key + Status badge */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.appName}>
              {request.appName || `${request.npub.slice(0, 16)}...`}
            </span>
            <span className={styles.separator}>•</span>
            <span className={styles.keyName}>{request.keyName || 'Unknown key'}</span>
          </div>
          <div className={styles.statusBadge}>
            {request.state === 'pending' && (
              <span className={styles.badgePending}>{formatTtl(request.ttl)}</span>
            )}
            {request.state === 'expired' && (
              <span className={styles.badgeExpired}>Expired</span>
            )}
            {request.state === 'approved' && (
              request.approvalType === 'manual' ? (
                <span className={styles.badgeApproved} title="Manually approved by you">
                  <Check size={12} /> Approved
                </span>
              ) : request.approvalType === 'auto_trust' ? (
                <span className={styles.badgeAuto} title="Auto-approved by app's trust level">
                  <Shield size={12} /> Approved
                </span>
              ) : request.approvalType === 'auto_permission' ? (
                <span className={styles.badgeAuto} title="Auto-approved by saved permission">
                  <Repeat size={12} /> Approved
                </span>
              ) : request.autoApproved ? (
                <span className={styles.badgeAuto}>Auto Approved</span>
              ) : (
                <span className={styles.badgeApproved}>Approved</span>
              )
            )}
            {request.state === 'denied' && (
              <span className={styles.badgeDenied}>Denied</span>
            )}
          </div>
        </div>

        {/* Line 2: Method (Details) • timestamp */}
        <div className={styles.methodRow}>
          <span className={styles.methodName}>
            {getMethodLabel(request.method, eventKind)}
          </span>
          <button
            type="button"
            className={styles.detailsLink}
            onClick={onViewDetails}
            aria-label={`View details for ${request.appName || 'request'}`}
          >
            (Details)
          </button>
          <span className={styles.separator}>•</span>
          <span className={styles.time}>{request.createdLabel}</span>
        </div>
      </div>

      {/* Expandable content for pending requests */}
      <div className={styles.details}>
        {isPending && request.eventPreview && (
          <div className={styles.eventPreview}>
            <div className={styles.eventKind}>
              {getKindLabel(request.eventPreview.kind)}
            </div>
            {request.eventPreview.content && (
              <div className={styles.eventContent}>
                {truncateContent(request.eventPreview.content)}
              </div>
            )}
          </div>
        )}
      </div>

      {isPending && (
        <div className={styles.actions}>
          {request.requiresPassword && (
            <input
              type="password"
              placeholder="Key passphrase"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className={styles.passwordInput}
              disabled={isApproving}
              aria-label="Key passphrase"
            />
          )}
          {request.method === 'connect' ? (
            <div className={styles.connectActions}>
              {requestedPermissions.length > 0 && (
                <div className={styles.requestedPerms}>
                  <span className={styles.permsLabel}>App requests:</span>
                  <div className={styles.permsList}>
                    {requestedPermissions.map((perm, i) => (
                      <span key={i} className={styles.permBadge}>
                        {formatPermission(perm)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className={styles.trustOptions}>
                <span className={styles.trustLabel}>Trust level:</span>
                {trustLevels.map((level) => {
                  const info = getTrustLevelInfo(level);
                  return (
                    <label key={level} className={styles.trustOption}>
                      <input
                        type="radio"
                        name={`trust-${request.id}`}
                        value={level}
                        checked={selectedTrustLevel === level}
                        onChange={() => setSelectedTrustLevel(level)}
                        disabled={isApproving}
                        className={styles.trustRadio}
                      />
                      <span className={`${styles.trustOptionLabel} ${styles[level]}`}>
                        <info.Icon size={14} aria-hidden="true" />
                        <span>{info.label}</span>
                      </span>
                      <span className={styles.trustDescription}>{info.description}</span>
                    </label>
                  );
                })}
              </div>
              <div className={styles.trustBreakdown}>
                {trustBehavior.autoApprove.length > 0 && (
                  <div className={styles.breakdownSection}>
                    <span className={styles.breakdownLabel}>Auto-approve:</span>
                    <span className={styles.breakdownItems}>
                      {trustBehavior.autoApprove.join(', ')}
                    </span>
                  </div>
                )}
                {trustBehavior.requiresApproval.length > 0 && (
                  <div className={styles.breakdownSection}>
                    <span className={styles.breakdownLabel}>Will ask:</span>
                    <span className={styles.breakdownItems}>
                      {trustBehavior.requiresApproval.join(', ')}
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                className={styles.connectButton}
                onClick={() => onApprove(selectedTrustLevel)}
                disabled={!canApprove}
              >
                {isApproving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          ) : (
            <div className={styles.approveActions}>
              <label className={styles.alwaysAllowLabel}>
                <input
                  type="checkbox"
                  checked={alwaysAllow}
                  onChange={(e) => setAlwaysAllow(e.target.checked)}
                  disabled={isApproving}
                  className={styles.alwaysAllowCheckbox}
                />
                <span>
                  {request.method === 'sign_event' && eventKind !== undefined
                    ? `Always allow ${getKindLabel(eventKind)}`
                    : 'Always allow this action'}
                </span>
              </label>
              <button
                type="button"
                className={styles.approveButton}
                onClick={() => onApprove(undefined, alwaysAllow, alwaysAllow ? eventKind : undefined)}
                disabled={!canApprove}
              >
                {isApproving ? 'Approving...' : 'Approve'}
              </button>
            </div>
          )}
        </div>
      )}

      {meta.state === 'error' && (
        <div className={styles.error} role="alert">{meta.message}</div>
      )}
    </div>
  );
}
