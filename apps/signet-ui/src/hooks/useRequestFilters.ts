import { useState, useCallback } from 'react';
import type { DisplayRequest, RequestFilter } from '@signet/types';

export type SortBy = 'newest' | 'oldest' | 'expiring';

export interface UseRequestFiltersResult {
  filter: RequestFilter;
  setFilter: (filter: RequestFilter) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  /** Apply filter, search, and sort to requests */
  applyFilters: (requests: DisplayRequest[]) => DisplayRequest[];
}

/**
 * Hook for managing request filtering, searching, and sorting.
 * Extracted from useRequests for better separation of concerns.
 */
export function useRequestFilters(): UseRequestFiltersResult {
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const applyFilters = useCallback((requests: DisplayRequest[]): DisplayRequest[] => {
    // Filter by search query
    let filtered = requests;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = requests.filter(request => (
        request.method.toLowerCase().includes(query) ||
        request.npub.toLowerCase().includes(query) ||
        (request.keyName?.toLowerCase().includes(query) ?? false) ||
        (request.appName?.toLowerCase().includes(query) ?? false) ||
        (request.eventPreview?.kind.toString().includes(query) ?? false)
      ));
    }

    // Sort requests
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'expiring':
          return a.ttl - b.ttl;
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return sorted;
  }, [searchQuery, sortBy]);

  return {
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    applyFilters,
  };
}
