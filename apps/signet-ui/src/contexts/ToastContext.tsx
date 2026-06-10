import { createContext, useContext } from 'react';

export interface Toast {
  message: string;
  type: 'success' | 'error' | 'warning' | 'notification';
  action?: () => void;
  actionLabel?: string;
  undo?: () => void;
}

interface ToastContextValue {
  toast: Toast | null;
  showToast: (toast: Toast) => void;
  hideToast: () => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
