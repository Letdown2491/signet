import type { ComponentType } from 'react';
import {
  Pen,
  Lock,
  Unlock,
  Key,
  Zap,
  CheckCircle,
  XCircle,
  PlusCircle,
  FileText,
  KeyRound,
  Download,
  AlertCircle,
  Link,
  Pause,
  Play,
  Server,
  Eye,
  Terminal,
  Timer,
  type LucideProps,
} from 'lucide-react';
import type { AdminEventType } from '@signet/types';

// Method category to icon component mapping
export type MethodCategory = 'sign' | 'encrypt' | 'decrypt' | 'auth' | 'other';

export function getMethodIcon(category: MethodCategory): ComponentType<LucideProps> {
  switch (category) {
    case 'sign':
      return Pen;
    case 'encrypt':
      return Lock;
    case 'decrypt':
      return Unlock;
    case 'auth':
      return Key;
    case 'other':
    default:
      return Zap;
  }
}

// Activity type to icon component mapping
export type ActivityType = 'approval' | 'denial' | 'registration' | 'other';

export function getActivityIcon(type: string): ComponentType<LucideProps> {
  switch (type) {
    case 'approval':
      return CheckCircle;
    case 'denial':
      return XCircle;
    case 'registration':
      return PlusCircle;
    default:
      return FileText;
  }
}

// Admin event type to icon component mapping
export function getAdminEventIcon(eventType: AdminEventType): ComponentType<LucideProps> {
  switch (eventType) {
    case 'key_locked':
      return Lock;
    case 'key_unlocked':
      return Unlock;
    case 'key_encrypted':
      return Lock;
    case 'key_migrated':
      return KeyRound;
    case 'key_exported':
      return Download;
    case 'auth_failed':
      return AlertCircle;
    case 'app_connected':
      return Link;
    case 'app_suspended':
      return Pause;
    case 'app_unsuspended':
      return Play;
    case 'daemon_started':
      return Server;
    case 'status_checked':
      return Eye;
    case 'command_executed':
      return Terminal;
    case 'panic_triggered':
      return AlertCircle;
    case 'deadman_reset':
      return Timer;
    default:
      return FileText;
  }
}

// Admin event type to human-readable label
export function getAdminEventLabel(eventType: AdminEventType): string {
  switch (eventType) {
    case 'key_locked':
      return 'Key locked';
    case 'key_unlocked':
      return 'Key unlocked';
    case 'key_encrypted':
      return 'Key encrypted';
    case 'key_migrated':
      return 'Encryption migrated';
    case 'key_exported':
      return 'Key exported';
    case 'auth_failed':
      return 'Auth failed';
    case 'app_connected':
      return 'App connected';
    case 'app_suspended':
      return 'App suspended';
    case 'app_unsuspended':
      return 'App resumed';
    case 'daemon_started':
      return 'Daemon started';
    case 'status_checked':
      return 'Status checked';
    case 'command_executed':
      return 'Command executed';
    case 'panic_triggered':
      return 'Panic triggered';
    case 'deadman_reset':
      return 'Inactivity timer reset';
    default:
      return eventType;
  }
}
