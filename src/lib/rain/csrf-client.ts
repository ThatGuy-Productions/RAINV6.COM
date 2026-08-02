/**
 * RAIN V6 — Client-side CSRF Token Manager
 *
 * Singleton that fetches the CSRF token on app startup and attaches it
 * to all state-changing fetch requests.
 *
 * Usage:
 *   import { getCsrfToken, attachCsrf, csrfHeader } from '@/lib/rain/csrf-client'
 *
 *   // On app startup
 *   await getCsrfToken()  // fetches from /api/rain/csrf-token
 *
 *   // Wrap fetch calls
 *   fetch(url, attachCsrf({ method: 'POST', body: JSON.stringify(data) }))
 *
 * Architecture:
 *   1. Call getCsrfToken() once on app load (e.g., in layout.tsx or _app.tsx)
 *   2. The token is stored in memory, not localStorage (prevents XSS exfiltration)
 *   3. Use attachCsrf() to add the X-CSRF-Token header to every fetch
 *   4. Token is NOT persisted across page navigations (Next.js keeps it in
 *      module scope, but refreshes reset it).
 *
 * Security:
 *   - Token stored in JS memory only → XSS harder to exfiltrate than localStorage
 *   - SameSite=Strict cookie + custom header → defangs classic CSRF
 *   - No token in URL or query string → no referer-leak attacks
 */

let _token: string | null = null
let _fetching: Promise<string | null> | null = null

/**
 * The CSRF header name — matches the server-side expectation.
 */
export const csrfHeader = 'X-CSRF-Token'

/**
 * Fetch a fresh CSRF token from the server.
 *
 * Call this on app startup. Safe to call multiple times — subsequent
 * calls return the cached token (in-memory) without re-fetching.
 *
 * Returns the token string, or null if the fetch failed.
 */
export async function getCsrfToken(): Promise<string | null> {
  // Return cached token if available
  if (_token) return _token

  // Deduplicate concurrent fetches — if getCsrfToken() is called from
  // multiple components during hydration, only one HTTP request fires.
  if (_fetching) return _fetching

  _fetching = (async () => {
    try {
      const res = await fetch('/api/rain/csrf-token', {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        console.warn('[csrf-client] Failed to fetch CSRF token:', res.status)
        return null
      }
      const data: { token?: string } = await res.json()
      _token = data.token ?? null
      return _token
    } catch (err) {
      console.warn('[csrf-client] CSRF token fetch error:', err)
      return null
    } finally {
      _fetching = null
    }
  })()

  return _fetching
}

/**
 * Return the current CSRF token, or null if not yet fetched.
 * Does NOT trigger a fetch — use getCsrfToken() for initialization.
 */
export function getCachedCsrfToken(): string | null {
  return _token
}

/**
 * Attach the CSRF token header to a fetch RequestInit object.
 *
 * Usage:
 *   fetch('/api/rain/reviews', attachCsrf({
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(review),
 *   }))
 *
 * If no token is available (not yet fetched), the header is omitted.
 * This is safe — the server will reject the request with a 403 and a
 * hint to call /api/rain/csrf-token.
 */
export function attachCsrf(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers)

  if (_token) {
    headers.set(csrfHeader, _token)
  }

  return {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  }
}

/**
 * Reset the cached token — useful when logging out or when the session
 * changes and a fresh token is needed.
 */
export function resetCsrfToken(): void {
  _token = null
  _fetching = null
}
