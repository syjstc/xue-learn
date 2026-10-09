import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isUnauthorized } from "./http.ts";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";

const retry = (failureCount: number, error: unknown) =>
  !isNotFound(error) && !isUnauthorized(error) && failureCount < 2;

/**
 * Shared query client.
 *
 * - 404s never retry (the resource is gone, not flaky)
 * - staleTime keeps tab switches snappy without refetch storms;
 *   mutations / SSE completions invalidate explicitly
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Desktop-local treats SQLite as the only durable client authority. Queries
 * remain observable while mounted, but are stale immediately, are discarded
 * after the last observer leaves, and refetch whenever a page mounts again.
 */
export function configureDesktopLocalQueryClient(): void {
  if (!isDesktopLocalRuntime()) return;
  queryClient.setDefaultOptions({
    queries: {
      staleTime: 0,
      gcTime: 0,
      retry,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    },
  });
}
