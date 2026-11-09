import { ApiError } from './errors'

/**
 * Browser-side API client. Every call goes to a Route Handler under /api (visible in the Network tab).
 * Errors come back as `{ error: { code, message } }` and are thrown as ApiError, so `errorMessage(e)`
 * shows the server's message.
 */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; issues?: unknown } } | null
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`)
    Object.assign(err, { issues: data?.error?.issues })
    // The session expired or was revoked: go back to the login screen.
    if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth/')) window.location.assign('/login')
    throw err
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T = void>(url: string) => request<T>('DELETE', url),
}
