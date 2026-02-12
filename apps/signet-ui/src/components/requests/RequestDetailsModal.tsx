import React, { useEffect, useCallback, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import type { DisplayRequest } from '@signet/types';
import { getKindLabel, getKindDescription, isKindSensitive, getMethodLabel } from '@signet/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getMethodInfo, getPermissionRisk } from '../../lib/event-labels.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { CopyIcon, CloseIcon } from '../shared/Icons.js';
import styles from './RequestDetailsModal.module.css';

interface RequestDetailsModalProps {
  request: DisplayRequest | null;
  open: boolean;
  onClose: () => void;
}

interface ParsedEvent {
  kind: number;
  content: string;
  tags: string[][];
  pubkey?: string;
  created_at?: number;
  id?: string;
  sig?: string;
}

export function RequestDetailsModal({
  request,
  open,
  onClose,
}: RequestDetailsModalProps) {
  const [copied, setCopied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open || !request) return null;

  // Parse the event data from params
  let parsedEvent: ParsedEvent | null = null;
  let rawJson = '';

  if (request.params) {
    try {
      const parsed = JSON.parse(request.params);
      // params may be an array with the event as first element
      const eventData = Array.isArray(parsed) ? parsed[0] : parsed;
      if (eventData && typeof eventData === 'object') {
        parsedEvent = eventData;
        rawJson = JSON.stringify(eventData, null, 2);
      }
    } catch {
      rawJson = request.params;
    }
  }

  // Use eventPreview if available
  const eventKind = request.eventPreview?.kind ?? parsedEvent?.kind;
  const eventContent = request.eventPreview?.content ?? parsedEvent?.content ?? '';
  const eventTags = request.eventPreview?.tags ?? parsedEvent?.tags ?? [];

  const { Icon } = getMethodInfo(request.method);
  const risk = getPermissionRisk(request.method);

  const handleCopy = async () => {
    const success = await copyToClipboard(rawJson || request.params || '');
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getRiskLabel = (riskLevel: typeof risk) => {
    switch (riskLevel) {
      case 'high':
        return { label: 'High Risk', className: styles.highRisk };
      case 'medium':
        return { label: 'Medium Risk', className: styles.mediumRisk };
      case 'low':
        return { label: 'Low Risk', className: styles.lowRisk };
    }
  };

  const riskInfo = getRiskLabel(risk);

  const getPermissionImpact = () => {
    switch (request.method) {
      case 'sign_event':
        return 'This request will sign an event with your private key. The signed event can be published to Nostr relays.';
      case 'connect':
        return 'This grants the app permission to connect and make future requests. You can set trust levels to control what actions are auto-approved.';
      case 'nip04_encrypt':
        return 'This encrypts a message using the NIP-04 encryption standard. The encrypted content can only be read by the recipient.';
      case 'nip04_decrypt':
        return 'This decrypts a message that was encrypted for you. The decrypted content will be visible to the requesting app.';
      case 'nip44_encrypt':
        return 'This encrypts a message using the NIP-44 encryption standard (more secure than NIP-04).';
      case 'nip44_decrypt':
        return 'This decrypts a NIP-44 encrypted message that was encrypted for you.';
      case 'get_public_key':
        return 'This returns your public key (npub). Your public key is not sensitive - it identifies you on Nostr.';
      default:
        return `This performs a "${request.method}" operation. Review the details before approving.`;
    }
  };

  return (
    <FocusTrap
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: false,
      }}
    >
      <div
        className={styles.overlay}
        onClick={onClose}
        role="presentation"
      >
        <div
          className={styles.modal}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="request-details-title"
        >
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <Icon size={20} className={styles.methodIcon} aria-hidden="true" />
              <h2 id="request-details-title" className={styles.title}>
                {getMethodLabel(request.method, request.eventPreview?.kind)}
              </h2>
              <span className={`${styles.riskBadge} ${riskInfo.className}`}>
                {riskInfo.label}
              </span>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close details"
            >
              <CloseIcon size={20} />
            </button>
          </div>

          <div className={styles.content}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Request Info</h3>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Key</span>
                  <span className={styles.infoValue}>{request.keyName || 'Unknown'}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>From</span>
                  <span className={styles.infoValue} title={request.npub}>
                    {request.appName || `${request.npub.slice(0, 12)}...${request.npub.slice(-8)}`}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Status</span>
                  <span className={`${styles.infoValue} ${styles[request.state]}`}>
                    {request.state.charAt(0).toUpperCase() + request.state.slice(1)}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Created</span>
                  <span className={styles.infoValue}>{request.createdLabel}</span>
                </div>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Permission Impact</h3>
              <p className={styles.impactText}>{getPermissionImpact()}</p>
            </section>

            {eventKind !== undefined && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Event Details</h3>
                <div className={styles.eventDetails}>
                  <div className={styles.eventKind}>
                    <span className={styles.kindLabel}>Kind {eventKind}</span>
                    <span className={styles.kindName}>{getKindLabel(eventKind)}</span>
                    {isKindSensitive(eventKind) && (
                      <span className={styles.sensitiveWarning}>Sensitive</span>
                    )}
                  </div>

                  {getKindDescription(eventKind) && (
                    <p className={styles.kindDescription}>{getKindDescription(eventKind)}</p>
                  )}

                  {eventContent && (
                    <div className={styles.eventField}>
                      <span className={styles.fieldLabel}>Content</span>
                      <pre className={styles.contentPre}>{eventContent}</pre>
                    </div>
                  )}

                  {eventTags.length > 0 && (
                    <div className={styles.eventField}>
                      <span className={styles.fieldLabel}>Tags ({eventTags.length})</span>
                      <div className={styles.tagsList}>
                        {eventTags.map((tag, idx) => (
                          <div key={idx} className={styles.tag}>
                            <span className={styles.tagType}>{tag[0]}</span>
                            {tag.slice(1).map((val, vidx) => (
                              <span key={vidx} className={styles.tagValue}>{val}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {rawJson && (
              <section className={styles.section}>
                <button
                  type="button"
                  className={styles.rawJsonToggle}
                  onClick={() => setShowRawJson(!showRawJson)}
                  aria-expanded={showRawJson}
                >
                  {showRawJson ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <h3 className={styles.sectionTitle}>Raw JSON</h3>
                </button>
                {showRawJson && (
                  <>
                    <div className={styles.rawJsonActions}>
                      <button
                        type="button"
                        className={styles.copyButton}
                        onClick={handleCopy}
                        aria-label="Copy JSON to clipboard"
                      >
                        <CopyIcon size={14} />
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className={styles.jsonPre}>{rawJson}</pre>
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
