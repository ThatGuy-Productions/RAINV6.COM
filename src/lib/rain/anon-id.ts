/**
 * RAIN V6 — Client-side anonymous ID (analytics attribution)
 *
 * Generates and persists a per-browser UUID in localStorage so pre-signup
 * usage (session loads, renders, exports, tab views) can be attributed to
 * the same anonymous visitor. When the visitor eventually signs up, the
 * anonId is passed to /api/rain/auth/register, and the server stores it in
 * the signup Event's metadata — joining the anonymous trail to the account.
 *
 * This is what makes the free-beta activation/retention/funnel math work
 * for the majority of users who never sign in: their renders and exports
 * still land in the `Event` table (with `userId = null`, `anonId = <uuid>`),
 * and `getFunnelStats` counts them alongside authenticated users.
 *
 * Privacy: this ID is random (not fingerprinted), user-clearable via
 * localStorage reset, and never contains PII. It exists solely so two
 * events from the same browser can be grouped.
 */

const STORAGE_KEY = 'rain_anon_id'
const ID_LENGTH = 36 // standard UUID v4 length

let cached: string | null = null

/** Generate a RFC 4122 v4 UUID using crypto.randomUUID when available. */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for older browsers — crypto.getRandomValues + manual v4 formatting.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

/**
 * Get the persistent anonymous ID for this browser, creating it on first call.
 *
 * Safe to call during SSR (returns null on the server — there's no window).
 * After first generation, the value is cached in module scope for the
 * lifetime of the page so repeated calls are cheap.
 */
export function getAnonId(): string | null {
  if (typeof window === 'undefined') return null
  if (cached) return cached

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length === ID_LENGTH) {
      cached = existing
      return cached
    }
  } catch {
    // localStorage may be disabled (private mode) — degrade gracefully.
  }

  const fresh = generateUuid()
  cached = fresh
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh)
  } catch {
    // If we can't persist, the in-memory cache still works for this session.
  }
  return fresh
}
