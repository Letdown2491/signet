import React, { useState } from 'react';
import type { DisplayRequest, TrustLevel } from '@signet/types';
import { getMethodLabel, getKindLabel } from '@signet/types';
import { ChevronDown, ChevronRight, Check, X, Inbox } from 'lucide-react';
import { getTrustLevelInfo } from '../../lib/event-labels.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import styles from './HomeView.module.css';

interface ApprovalParams {
  requestId: string;
  trustLevel?: TrustLevel;
  alwaysAllow?: boolean;
  allowKind?: number;
  appName?: string;
}

function truncateForPreview(content: string, max = 280): string {
  return content.length > max ? content.slice(0, max) + '…' : content;
}

const TRUST_LEVELS: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

interface PendingRequestsListProps {
  requests: DisplayRequest[];
  passwords: Record<string, string>;
  appNames: Record<string, string>;
  onPasswordChange: (requestId: string, password: string) => void;
  onAppNameChange: (requestId: string, appName: string) => void;
  onApprove: (requestId: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number, appName?: string) => Promise<boolean>;
  onDeny: (requestId: string) => Promise<boolean>;
  onViewDetails: (request: DisplayRequest) => void;
}

export function PendingRequestsList({
  requests,
  passwords,
  appNames,
  onPasswordChange,
  onAppNameChange,
  onApprove,
  onDeny,
  onViewDetails,
}: PendingRequestsListProps) {
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [selectedTrustLevels, setSelectedTrustLevels] = useState<Record<string, TrustLevel>>({});
  const [alwaysAllowFlags, setAlwaysAllowFlags] = useState<Record<string, boolean>>({});
  const [removingItems, setRemovingItems] = useState<Record<string, 'approved' | 'denied'>>({});
  // Pending "Full trust" grant awaiting explicit confirmation (most dangerous action).
  const [confirmFullTrust, setConfirmFullTrust] = useState<ApprovalParams | null>(null);

  const pendingRequests = requests.filter(r => r.state === 'pending');

  const getTrustLevel = (requestId: string): TrustLevel => {
    return selectedTrustLevels[requestId] || 'reasonable';
  };

  const setTrustLevel = (requestId: string, level: TrustLevel) => {
    setSelectedTrustLevels(prev => ({ ...prev, [requestId]: level }));
  };

  const handleApprove = async (requestId: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number, appName?: string) => {
    setRemovingItems(prev => ({ ...prev, [requestId]: 'approved' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    await onApprove(requestId, trustLevel, alwaysAllow, allowKind, appName);
    setRemovingItems(prev => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  };

  const handleDeny = async (requestId: string) => {
    setRemovingItems(prev => ({ ...prev, [requestId]: 'denied' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    await onDeny(requestId);
    setRemovingItems(prev => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Pending
        {pendingRequests.length > 0 && (
          <span className={styles.badge}>{pendingRequests.length}</span>
        )}
      </h2>
      {pendingRequests.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Inbox size={18} /></span>
          <p>No pending approvals</p>
        </div>
      ) : (
        <div className={styles.listCard}>
          {pendingRequests.map((request) => {
            const isExpanded = expandedRequestId === request.id;
            const removingState = removingItems[request.id];
            return (
              <div
                key={request.id}
                className={`${styles.listItem} ${removingState ? styles[`listItem_${removingState}`] : ''}`}
              >
                <button
                  type="button"
                  className={styles.listItemHeader}
                  onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                  aria-expanded={isExpanded}
                >
                  <div className={styles.listItemRow}>
                    <span className={styles.pendingDot} />
                    <span className={styles.listItemAppName}>
                      {request.appName || (request.npub ? request.npub.slice(0, 16) + '...' : 'Unknown')}
                    </span>
                    <span className={styles.listItemTime}>
                      {request.createdLabel}
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </div>
                  <div className={styles.listItemRow}>
                    <span className={styles.listItemMethod}>
                      {getMethodLabel(request.method, request.eventPreview?.kind)} &bull; {request.keyName || 'Unknown key'}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className={styles.listItemExpanded}>
                    <div className={styles.listItemDetails}>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>From:</span>
                        <span className={styles.detailValue}>
                          {request.appName || (request.npub ? <code>{request.npub.slice(0, 20)}...</code> : 'Unknown')}
                        </span>
                      </div>
                      {request.method === 'sign_event' && request.eventPreview && (
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>Signing:</span>
                          <span className={styles.detailValue}>
                            {getKindLabel(request.eventPreview.kind)}
                            {request.eventPreview.content && (
                              <code className={styles.signPreview}>
                                {truncateForPreview(request.eventPreview.content)}
                              </code>
                            )}
                          </span>
                        </div>
                      )}
                      {request.requiresPassword && (
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>Password:</span>
                          <input
                            type="password"
                            className={styles.passwordInput}
                            aria-label="Password to unlock key"
                            value={passwords[request.id] || ''}
                            onChange={(e) => onPasswordChange(request.id, e.target.value)}
                            placeholder="Enter key password"
                          />
                        </div>
                      )}
                      {request.method !== 'connect' && (
                        <label className={styles.alwaysAllowLabel}>
                          <input
                            type="checkbox"
                            checked={alwaysAllowFlags[request.id] || false}
                            onChange={(e) => setAlwaysAllowFlags(prev => ({ ...prev, [request.id]: e.target.checked }))}
                            className={styles.alwaysAllowCheckbox}
                          />
                          <span>
                            {request.method === 'sign_event' && request.eventPreview?.kind !== undefined
                              ? `Always allow ${getKindLabel(request.eventPreview.kind)}`
                              : 'Always allow this action'}
                          </span>
                        </label>
                      )}
                      {request.method === 'connect' && (
                        <>
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>App name:</span>
                            <input
                              type="text"
                              className={styles.appNameInput}
                              aria-label="App name"
                              value={appNames[request.id] || ''}
                              onChange={(e) => onAppNameChange(request.id, e.target.value)}
                              placeholder="e.g., Primal, Amethyst"
                            />
                          </div>
                          <div className={styles.trustSection}>
                            <span className={styles.detailLabel}>Trust:</span>
                            <div className={styles.trustOptions}>
                              {TRUST_LEVELS.map(level => {
                                const info = getTrustLevelInfo(level);
                                const isSelected = getTrustLevel(request.id) === level;
                                return (
                                  <button
                                    type="button"
                                    key={level}
                                    className={`${styles.trustOption} ${isSelected ? styles.trustOptionSelected : ''} ${styles[`trust_${level}`]}`}
                                    onClick={() => setTrustLevel(request.id, level)}
                                  >
                                    <span className={styles.trustOptionLabel}>{info.label}</span>
                                    <span className={styles.trustOptionDesc}>{info.description}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <div className={styles.listItemActions}>
                      <button
                        type="button"
                        className={styles.approveButton}
                        onClick={() => {
                          const alwaysAllow = request.method !== 'connect' ? alwaysAllowFlags[request.id] : undefined;
                          const allowKind = alwaysAllow && request.method === 'sign_event' ? request.eventPreview?.kind : undefined;
                          const trustLevel = request.method === 'connect' ? getTrustLevel(request.id) : undefined;
                          const params: ApprovalParams = {
                            requestId: request.id,
                            trustLevel,
                            alwaysAllow,
                            allowKind,
                            appName: request.method === 'connect' ? appNames[request.id] : undefined,
                          };
                          // Granting Full trust auto-approves all future requests from
                          // this app — require an explicit confirmation.
                          if (request.method === 'connect' && trustLevel === 'full') {
                            setConfirmFullTrust(params);
                            return;
                          }
                          handleApprove(params.requestId, params.trustLevel, params.alwaysAllow, params.allowKind, params.appName);
                        }}
                        disabled={!!removingState}
                      >
                        {removingState === 'approved' ? <Check size={16} /> : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className={styles.denyButton}
                        onClick={() => handleDeny(request.id)}
                        disabled={!!removingState}
                      >
                        {removingState === 'denied' ? <X size={16} /> : 'Deny'}
                      </button>
                      <button
                        type="button"
                        className={styles.detailsButton}
                        onClick={() => onViewDetails(request)}
                      >
                        Details
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmFullTrust !== null}
        title="Grant full trust?"
        danger
        confirmLabel="Grant full trust"
        message={
          <>
            Full trust <strong>auto-approves every future request</strong> from this app —
            including signing any event and decrypting messages — without asking again.
            Only grant this to apps you completely trust.
          </>
        }
        onConfirm={() => {
          const params = confirmFullTrust;
          setConfirmFullTrust(null);
          if (params) {
            handleApprove(params.requestId, params.trustLevel, params.alwaysAllow, params.allowKind, params.appName);
          }
        }}
        onCancel={() => setConfirmFullTrust(null)}
      />
    </section>
  );
}
