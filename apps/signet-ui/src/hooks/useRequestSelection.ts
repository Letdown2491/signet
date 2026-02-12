import { useState, useCallback } from 'react';
import type { DisplayRequest } from '@signet/types';

export interface UseRequestSelectionResult {
  selectionMode: boolean;
  selectedIds: Set<string>;
  toggleSelectionMode: () => void;
  toggleSelection: (id: string) => void;
  selectAll: (requests: DisplayRequest[]) => void;
  deselectAll: () => void;
  /** Clear selection state (useful after bulk operations) */
  clearSelection: () => void;
}

/**
 * Hook for managing request selection state.
 * Extracted from useRequests for better separation of concerns.
 */
export function useRequestSelection(): UseRequestSelectionResult {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((requests: DisplayRequest[]) => {
    const pendingIds = requests
      .filter(r => r.state === 'pending')
      .map(r => r.id);
    setSelectedIds(new Set(pendingIds));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  return {
    selectionMode,
    selectedIds,
    toggleSelectionMode,
    toggleSelection,
    selectAll,
    deselectAll,
    clearSelection,
  };
}
