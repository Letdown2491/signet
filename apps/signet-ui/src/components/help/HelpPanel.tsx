import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Copy, Check, Shield, Repeat } from 'lucide-react';
import { copyToClipboard } from '../../lib/clipboard.js';
import styles from './HelpPanel.module.css';

interface AccordionItemProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionItem({ title, children, defaultOpen = false }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={styles.accordionItem}>
      <button
        type="button"
        className={styles.accordionHeader}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className={styles.accordionIcon}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className={styles.accordionTitle}>{title}</span>
      </button>
      {isOpen && (
        <div className={styles.accordionContent}>
          {children}
        </div>
      )}
    </div>
  );
}

const NOSTR_NPUB = 'npub1m2jphmdkskgnvwl5gplksl9e0zwv2sldqf9mwlpz6tyymz84g9fsqr3wgu';
const GITHUB_ISSUES_URL = 'https://github.com/Letdown2491/signet/issues';

export function HelpPanel() {
  const [copiedNpub, setCopiedNpub] = useState(false);

  const handleCopyNpub = async () => {
    const success = await copyToClipboard(NOSTR_NPUB);
    if (success) {
      setCopiedNpub(true);
      setTimeout(() => setCopiedNpub(false), 2000);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Help</h2>

      <div className={styles.card}>
        {/* Getting Started */}
        <div className={styles.sectionGroup}>
          <h3 className={styles.sectionTitle}>Getting Started</h3>

          <AccordionItem title="What is Signet?">
            <p>
              Signet is a <strong>remote signer</strong> for Nostr. It securely holds your
              private keys and approves signing requests from apps, so your keys never
              leave this device.
            </p>
            <p>
              When a Nostr app wants to post, react, or send a message on your behalf,
              it sends a request to Signet. You can approve or deny each request,
              giving you full control over what gets signed with your identity.
            </p>
          </AccordionItem>

          <AccordionItem title="Connecting an App">
            <p>There are two ways to connect a Nostr app:</p>

            <h4 className={styles.subheading}>bunker:// (You initiate)</h4>
            <ol className={styles.stepList}>
              <li>Go to the <strong>Keys</strong> page and select a key</li>
              <li>Click <strong>Generate bunker URI</strong> to get a one-time connection link</li>
              <li>Paste the URI into your Nostr app's remote signer settings</li>
              <li>The app connects automatically</li>
            </ol>

            <h4 className={styles.subheading}>nostrconnect:// (App initiates)</h4>
            <ol className={styles.stepList}>
              <li>In your Nostr app, look for "Connect via remote signer" or similar</li>
              <li>The app displays a <strong>nostrconnect://</strong> URI or QR code</li>
              <li>In Signet, click <strong>+</strong> on the Apps page</li>
              <li>Paste the URI and choose a key and trust level</li>
              <li>Click <strong>Connect</strong> to complete the handshake</li>
            </ol>

            <p className={styles.hint}>
              Both methods create the same secure connection. Use whichever your app supports.
            </p>
          </AccordionItem>

          <AccordionItem title="Trust Levels">
            <p>When an app connects, you choose how much to trust it:</p>
            <dl className={styles.definitionList}>
              <dt>Always Ask</dt>
              <dd>You manually approve every single request. Most secure, but requires constant attention.</dd>

              <dt>Auto-approve Safe</dt>
              <dd>
                Auto-approves low-risk actions: notes, replies, reactions, reposts, long-form articles, zaps, and list updates.
                Still requires approval for: profile changes, follow list, event deletion, relay list, legacy DMs (NIP-04), wallet operations, and unknown event kinds.
              </dd>

              <dt>Auto-approve All</dt>
              <dd>Everything is auto-approved. Only use this for apps you fully trust.</dd>
            </dl>
            <p className={styles.hint}>
              You can change an app's trust level anytime from the Apps page.
            </p>
          </AccordionItem>

          <AccordionItem title="Relay Trust Scores">
            <p>
              Relays display a trust score badge showing their reputation. Scores come from{' '}
              <a href="https://trustedrelays.xyz" target="_blank" rel="noopener noreferrer">trustedrelays.xyz</a>{' '}
              and are updated hourly.
            </p>
            <dl className={styles.definitionList}>
              <dt>80+ (Green)</dt>
              <dd>Excellent reliability</dd>

              <dt>60-79 (Teal)</dt>
              <dd>Good reliability</dd>

              <dt>40-59 (Yellow)</dt>
              <dd>Fair reliability</dd>

              <dt>Below 40 (Red)</dt>
              <dd>Poor reliability</dd>

              <dt>? (Gray)</dt>
              <dd>Score unavailable</dd>
            </dl>
            <p className={styles.hint}>
              Trust scores are informational only and do not affect how Signet uses relays.
            </p>
          </AccordionItem>
        </div>

        {/* Understanding Requests */}
        <div className={styles.sectionGroup}>
          <h3 className={styles.sectionTitle}>Understanding Requests</h3>

          <AccordionItem title="What are signing requests?">
            <p>
              When a Nostr app wants to perform an action as you, it sends a <strong>signing request</strong> to Signet.
              The request contains the event data that needs your cryptographic signature.
            </p>
            <p>
              Without your signature, the app cannot post, react, or message on your behalf.
              This gives you complete control over your Nostr identity.
            </p>
          </AccordionItem>

          <AccordionItem title="Event Types">
            <p>Common event types you'll see:</p>
            <dl className={styles.definitionList}>
              <dt>Text Post (kind 1)</dt>
              <dd>A note, reply, or thread post</dd>

              <dt>Reaction (kind 7)</dt>
              <dd>A like, emoji reaction, or zap receipt</dd>

              <dt>Repost (kind 6)</dt>
              <dd>Sharing someone else's post to your followers</dd>

              <dt>Encrypted Message (kind 4, 44)</dt>
              <dd>Private direct message content</dd>

              <dt>Profile Update (kind 0)</dt>
              <dd>Changes to your display name, bio, or picture</dd>

              <dt>Follow List (kind 3)</dt>
              <dd>Updates to who you follow</dd>
            </dl>
          </AccordionItem>

          <AccordionItem title="Request Actions">
            <dl className={styles.definitionList}>
              <dt>sign_event</dt>
              <dd>Sign a Nostr event (post, reaction, etc.)</dd>

              <dt>connect</dt>
              <dd>An app wants to establish a connection</dd>

              <dt>get_public_key</dt>
              <dd>An app is requesting your public identity</dd>

              <dt>nip04_encrypt / nip04_decrypt</dt>
              <dd>Encrypt or decrypt a direct message (legacy format)</dd>

              <dt>nip44_encrypt / nip44_decrypt</dt>
              <dd>Encrypt or decrypt a direct message (modern format)</dd>
            </dl>
          </AccordionItem>

          <AccordionItem title="Approval Badges">
            <p>The Activity page and Recent widget show badges indicating how each request was approved:</p>
            <dl className={styles.definitionList}>
              <dt><Check size={14} style={{ verticalAlign: 'middle' }} /> Approved</dt>
              <dd>You manually clicked Approve for this request</dd>

              <dt><Shield size={14} style={{ verticalAlign: 'middle' }} /> Approved</dt>
              <dd>Auto-approved by the app's trust level (e.g., "Auto-approve Safe" allows reactions)</dd>

              <dt><Repeat size={14} style={{ verticalAlign: 'middle' }} /> Approved</dt>
              <dd>Auto-approved by a saved permission you created with "Always allow this action"</dd>
            </dl>
            <p className={styles.hint}>
              Hover over any badge to see a tooltip explaining how that request was approved.
            </p>
          </AccordionItem>
        </div>

        {/* Managing Keys */}
        <div className={styles.sectionGroup}>
          <h3 className={styles.sectionTitle}>Managing Keys</h3>

          <AccordionItem title="Passphrases">
            <p>
              A passphrase encrypts your key at rest. When your key is <strong>locked</strong>,
              it cannot sign any requests until you unlock it with your passphrase.
            </p>
            <p>
              This protects your key if someone gains access to your Signet instance.
              Even with access, they cannot sign anything without knowing your passphrase.
            </p>
            <p className={styles.hint}>
              Tip: Use a strong, unique passphrase. If you forget it, you'll need to
              re-import your key using the original private key (nsec).
            </p>
          </AccordionItem>

          <AccordionItem title="Multiple Keys">
            <p>
              You can manage multiple Nostr identities in Signet. Each key has its own:
            </p>
            <ul className={styles.bulletList}>
              <li>Connected apps and their trust levels</li>
              <li>Passphrase protection (optional)</li>
              <li>Bunker URI for connections</li>
            </ul>
            <p>
              Use different keys to separate your identities - for example, a personal
              account and a project account.
            </p>
          </AccordionItem>
        </div>

        {/* Reference */}
        <div className={styles.sectionGroup}>
          <h3 className={styles.sectionTitle}>Reference</h3>

          <AccordionItem title="Keyboard Shortcuts">
            <dl className={styles.shortcutList}>
              <dt><kbd>Ctrl</kbd> + <kbd>K</kbd></dt>
              <dd>Open command palette</dd>
            </dl>
            <p className={styles.hint}>
              Use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd> on macOS.
            </p>
          </AccordionItem>
        </div>

        {/* Feedback & Support */}
        <div className={styles.sectionGroup}>
          <h3 className={styles.sectionTitle}>Feedback & Support</h3>
          <div className={styles.feedbackLinks}>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.feedbackLink}
            >
              <ExternalLink size={16} />
              <span>GitHub Issues</span>
            </a>
            <a
              href={`https://njump.me/${NOSTR_NPUB}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.feedbackLink}
              title="View profile on njump.me"
            >
              <ExternalLink size={16} />
              <span className={styles.npubText}>
                {NOSTR_NPUB.slice(0, 12)}...{NOSTR_NPUB.slice(-6)}
              </span>
            </a>
            <button
              type="button"
              className={styles.copyButton}
              onClick={handleCopyNpub}
              aria-label={copiedNpub ? 'Copied!' : 'Copy npub'}
              title={copiedNpub ? 'Copied!' : 'Copy npub'}
            >
              {copiedNpub ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
