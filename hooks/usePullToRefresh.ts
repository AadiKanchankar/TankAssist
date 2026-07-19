import { useState, useCallback } from 'react';

/**
 * Shared pull-to-refresh state, extracted from the Dashboard screens'
 * original inline pattern (refreshing flag + reload wrapper). Use with a
 * ScrollView/FlatList RefreshControl:
 *
 *   const { refreshing, onRefresh } = usePullToRefresh(loadData);
 *   <FlatList refreshControl={
 *     <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
 *   } ... />
 *
 * `reload` should be a stable (useCallback-wrapped) async fetch function.
 */
export function usePullToRefresh(reload: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return { refreshing, onRefresh };
}
