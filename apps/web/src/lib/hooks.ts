import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data?: T; error: string; loading: boolean }>({ path, error: '', loading: !!path });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const current = ++sequence.current;
    setState(previous => ({ path, data: previous.path === path ? previous.data : undefined, error: '', loading: true }));
    try {
      const result = await api<T>(path);
      if (current === sequence.current) setState({ path, data: result, error: '', loading: false });
    } catch (error) {
      if (current === sequence.current) setState(previous => ({ ...previous, path, error: errorMessage(error), loading: false }));
    }
  }, [path]);
  useEffect(() => {
    void reload();
    return () => { sequence.current++; };
  }, [reload]);
  const matches = state.path === path;
  return { data: matches ? state.data : undefined, error: matches ? state.error : '', loading: matches ? state.loading : !!path, reload };
}

export function usePagedResource<T>(path: string, pageSize = 50) {
  const [position, setPosition] = useState({ path, page: 0 });
  const page = position.path === path ? position.page : 0;
  // Fetch one extra item to determine whether another page exists without guessing a total.
  const resource = useResource<{ items: T[] }>(`${path}${path.includes('?') ? '&' : '?'}take=${pageSize + 1}&skip=${page * pageSize}`);
  const items = resource.data?.items.slice(0, pageSize);
  return {
    ...resource,
    data: items ? { items } : undefined,
    pagination: {
      page,
      pageSize,
      hasNext: (resource.data?.items.length ?? 0) > pageSize,
      onPageChange: (next: number) => setPosition({ path, page: Math.max(0, next) }),
    },
  };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try { await action(); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return { busy, error, success, setError, setSuccess, run };
}
