import { createContext, useContext } from 'react';
import type { TrustLevel } from '@signet/types';

export interface UserSettings {
  notificationsEnabled: boolean;
  defaultTrustLevel: TrustLevel;
}

interface SettingsContextValue {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
