import type { ComponentType, SVGProps } from 'react';
import type { LucideProps } from 'lucide-react';

// Extended props type that includes className for dynamic icon components
type IconProps = LucideProps & SVGProps<SVGSVGElement>;
import {
  Pen,
  Lock,
  Unlock,
  Key,
  Zap,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { TrustLevel } from '@signet/types';
import { getKindLabel, getTrustLevelBehavior } from '@signet/types';

// Re-export from shared package for backwards compatibility
export const getEventKindLabel = getKindLabel;

export type PermissionRisk = 'high' | 'medium' | 'low';

export function getPermissionRisk(permission: string): PermissionRisk {
  const perm = permission.toLowerCase();

  // High risk: Can sign events, send DMs, access keys
  if (perm.includes('sign') || perm === 'sign_event' || perm.includes('nip04') || perm.includes('nip44')) {
    return 'high';
  }

  // Medium risk: Can get public key info
  if (perm.includes('get_public_key') || perm.includes('pubkey')) {
    return 'medium';
  }

  // Low risk: Read-only operations
  return 'low';
}

export type MethodCategory = 'sign' | 'encrypt' | 'decrypt' | 'auth' | 'other';

export interface MethodInfo {
  Icon: ComponentType<IconProps>;
  category: MethodCategory;
}

export function getMethodInfo(method: string): MethodInfo {
  const methodLower = method.toLowerCase();

  if (methodLower.includes('sign') || methodLower === 'sign_event') {
    return { Icon: Pen, category: 'sign' };
  }
  if (methodLower.includes('encrypt') || methodLower === 'nip04_encrypt' || methodLower === 'nip44_encrypt') {
    return { Icon: Lock, category: 'encrypt' };
  }
  if (methodLower.includes('decrypt') || methodLower === 'nip04_decrypt' || methodLower === 'nip44_decrypt') {
    return { Icon: Unlock, category: 'decrypt' };
  }
  if (methodLower.includes('auth') || methodLower.includes('connect')) {
    return { Icon: Key, category: 'auth' };
  }
  return { Icon: Zap, category: 'other' };
}

export interface TrustLevelInfo {
  label: string;
  description: string;
  Icon: ComponentType<IconProps>;
}

const TRUST_ICONS: Record<TrustLevel, ComponentType<IconProps>> = {
  paranoid: ShieldAlert,
  reasonable: Shield,
  full: ShieldCheck,
};

// Label/description come from the shared `getTrustLevelBehavior` (single source of
// truth); only the icon is UI-local.
export function getTrustLevelInfo(level: TrustLevel): TrustLevelInfo {
  const { label, description } = getTrustLevelBehavior(level);
  return { label, description, Icon: TRUST_ICONS[level] };
}
