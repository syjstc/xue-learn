/** Same-origin DSH transport. The Host owns the private runtime credential. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('Unsupported learning API path');
  return `api/xuelearn?path=${encodeURIComponent(path)}`;
}
export function getApiBaseUrl(): string { return 'api/xuelearn'; }
function transportFetch(path: string, init: RequestInit) {
  const transport = (globalThis as typeof globalThis & {__DSH_TRANSPORT__?: {fetch: typeof fetch}}).__DSH_TRANSPORT__;
  return typeof transport?.fetch === 'function' ? transport.fetch(path, init) : fetch(path, init);
}
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-XueLearn-Client', 'dsh-plugin');
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return transportFetch(apiUrl(path), {...init, headers, credentials: 'same-origin'});
}
export async function hostRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!/^\/[a-z-]+$/.test(path)) throw new Error('Unsupported host API path');
  const response = await transportFetch(`api/xuelearn?path=${encodeURIComponent(`/xuelearn/host${path}`)}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {'X-XueLearn-Client': 'dsh-plugin', 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? result.message ?? `Request failed (${response.status})`);
  return result as T;
}
