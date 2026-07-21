import { QueryClient } from '@tanstack/react-query';

/**
 * App-wide React Query client (Phase B). Cache-backs the per-screen focus
 * fetches so revisits paint instantly and refresh in the background.
 *
 * refetchOnMount:false is deliberate: React Native has no browser "window
 * focus", so every data screen drives refresh explicitly via
 * useFocusEffect(refetch). Disabling refetch-on-mount means a screen mount does
 * NOT fire a request on top of that focus refetch — a warm revisit paints from
 * cache then does exactly one background refetch, and on a cold mount the
 * initial in-flight fetch is de-duplicated with the focus refetch (one request).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});
