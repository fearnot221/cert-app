export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let csrfToken: string | undefined;
export function resetCsrf() { csrfToken = undefined; }

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD'].includes(method)) {
    if (!csrfToken) {
      const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, '無法建立安全連線，請重新整理後再試。');
      csrfToken = (await response.json()).csrfToken;
    }
    headers.set('X-CSRF-Token', csrfToken!);
  }
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    const details = Array.isArray(error.issues) ? error.issues.slice(0, 5).map((issue: { message?: string }) => issue.message).filter(Boolean).join('；') : '';
    throw new ApiError(response.status, [error.message ?? `請求未完成（${response.status}），請再試一次。`, details].filter(Boolean).join('：'));
  }
  return response;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  return response.status === 204 ? undefined as T : response.json();
}
export function post<T>(path: string, body: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '發生未預期的錯誤，請再試一次。';
}
export function orgPath(organizationId: string, path: string) {
  return `/organizations/${encodeURIComponent(organizationId)}${path}`;
}
