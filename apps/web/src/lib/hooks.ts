import { useCallback, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "./api";

/**
 * Server state goes through TanStack Query: one cache keyed by API path, so leaving and returning to
 * a page shows the last result immediately while it refreshes.
 */
export function useResource<T>(path: string | null, options: { refetchInterval?: number | false; gcTime?: number } = {}) {
  const query = useQuery({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: !!path,
    refetchInterval: options.refetchInterval,
    gcTime: options.gcTime,
  });
  const { refetch } = query;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);
  return {
    data: query.data,
    error: query.error ? errorMessage(query.error) : "",
    /** True on the first load, when nothing is cached for this path yet. */
    pending: !!path && query.isPending,
    /** True while any request for this path is in flight, including background refreshes. */
    loading: !!path && query.isFetching,
    reload,
  };
}

export function usePagedResource<T>(path: string, pageSize = 50) {
  const [position, setPosition] = useState({ path, page: 0 });
  const page = position.path === path ? position.page : 0;
  // Fetch one extra item to determine whether another page exists without guessing a total.
  const url = `${path}${path.includes("?") ? "&" : "?"}take=${pageSize + 1}&skip=${page * pageSize}`;
  const query = useQuery({
    queryKey: [url],
    queryFn: () => api<{ items: T[] }>(url),
    placeholderData: keepPreviousData,
  });
  const { refetch } = query;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const items = query.data?.items.slice(0, pageSize);
  return {
    data: items ? { items } : undefined,
    error: query.error ? errorMessage(query.error) : "",
    pending: query.isPending,
    loading: query.isFetching,
    reload,
    pagination: {
      page,
      pageSize,
      hasNext: (query.data?.items.length ?? 0) > pageSize,
      onPageChange: (next: number) => setPosition({ path, page: Math.max(0, next) }),
    },
  };
}

/** Runs one write at a time. After it finishes, every cached list is marked stale so other pages show the change. */
export function useAction() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    }
  };
  return { busy, error, success, setError, setSuccess, run };
}
