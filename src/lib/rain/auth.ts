/**
 * RAIN V6 — Authentication (Enterprise Admin Door)
 *
 * Real credential-based authentication for the Enterprise admin door. No
 * external dependencies — uses Node's built-in `crypto` module for:
 *   - scrypt password hashing (memory-hard, salted)
 *   - cryptographically-secure random session tokens
 *   - SHA-256 token hashing (only the hash is persisted, never the token)
 *
 * Identity flow:
 *   1. Admin bootstrap creates the first Enterprise account (one-time).
 *   2. Login verifies email+password against `Account.passwordHash`,
 *      mints an `AuthToken` (random 256-bit), sets an httpOnly cookie
 *      `rain_admin_session=<token>`.
 *   3. `getSessionUser(req)` reads the cookie, hashes it, looks up the
 *      `AuthToken` row, checks expiry, and returns the `Account`.
 *   4. Logout deletes the `AuthToken` row + clears the cookie.
 *
 * Security notes:
 *   - Cookies are httpOnly (no JS access), SameSite=Lax, Secure in prod.
 *   - Passwords are hashed with scrypt (N=16384, r=8, p=1, 32-byte key).
 *   - Session tokens are 32 random bytes (256-bit), stored only as SHA-256.
 *   - 7-day expiry, non-sliding (a new login mints a fresh token).
 *   - All admin routes enforce the `enterprise` tier via tier-gate, which
 *     now reads the cookie first — so a logged-in Enterprise admin
 *     transparently unlocks every tier-gated feature.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { shouldRotateToken } from '@/lib/rain/auth-hardening'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'rain_admin_session'
/** 7 days in seconds. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

/** scrypt parameters — memory-hard, OWASP-recommended cost. */
const SCRYPT_KEYLEN = 32
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  name: string | null
  tier: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password with scrypt + per-user salt.
 * Stored format: `scrypt$<saltHex>$<hashHex>` (salt is 16 bytes).
 */
export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plaintext, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Verify a plaintext password against a stored `scrypt$salt$hash` string.
 * Constant-time comparison via timingSafeEqual to resist timing attacks.
 * Returns false on any malformed input (never throws).
 */
export function verifyPassword(plaintext: string, stored: string): boolean {
  try {
    const parts = stored.split('$')
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false
    const actual = scryptSync(plaintext, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

/** Generate a 256-bit random session token (64 hex chars). */
function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/** SHA-256 hash a raw token for DB storage. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether the request was served over HTTPS (via the gateway's
 * X-Forwarded-Proto header). The preview environment serves over HTTPS even
 * though the Next.js dev server is plain HTTP — this matters because cookies
 * with SameSite=None require the Secure flag, which only works over HTTPS.
 */
function isHttps(req: NextRequest | null): boolean {
  if (!req) return false
  const xfProto = req.headers.get('x-forwarded-proto')
  if (xfProto) return xfProto.includes('https')
  // Fallback: check the raw URL protocol
  return req.nextUrl.protocol === 'https:'
}

/**
 * Build the Set-Cookie header value for a session token.
 *
 * Cookie policy:
 *   - SameSite=Lax for plain HTTP (localhost dev) — sufficient, secure, and
 *     avoids the Secure-over-HTTPS requirement.
 *   - SameSite=None; Secure for HTTPS (preview/prod) — REQUIRED for the
 *     cookie to be stored when the app runs inside a cross-origin iframe
 *     (the preview environment embeds the app on preview-chat-*.space-z.ai,
 *     which is cross-site). Without SameSite=None, modern browsers silently
 *     drop the cookie and the user appears logged out on every return.
 *   - HttpOnly always (no JS access — prevents XSS theft).
 *   - Path=/ always.
 */
function buildSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ]
  if (secure) {
    // HTTPS (preview/prod): SameSite=None so the cookie survives the
    // cross-origin iframe, plus Secure (required by SameSite=None).
    parts.push('SameSite=None', 'Secure')
  } else {
    // Plain HTTP (localhost dev): Lax is safe and doesn't need Secure.
    parts.push('SameSite=Lax')
  }
  return parts.join('; ')
}

/** Build a Set-Cookie header that clears the session cookie. */
function buildClearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly']
  if (secure) {
    parts.push('SameSite=None', 'Secure')
  } else {
    parts.push('SameSite=Lax')
  }
  return parts.join('; ')
}

/**
 * Set the session cookie on the outgoing response (route-handler usage).
 * Pass the request so we can detect HTTPS via X-Forwarded-Proto.
 * Returns the Set-Cookie header value to attach to NextResponse.
 */
export function sessionCookieHeader(token: string, req?: NextRequest | null): string {
  return buildSessionCookie(token, SESSION_TTL_SECONDS, isHttps(req ?? null))
}

export function clearCookieHeader(req?: NextRequest | null): string {
  return buildClearCookie(isHttps(req ?? null))
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

export interface SessionRotationResult {
  user: AuthUser | null
  /** If non-null, the session token should be rotated — set this cookie header. */
  rotatedCookie: string | null
}

/**
 * Resolve the authenticated user from a request's session cookie.
 * Reads the `rain_admin_session` cookie, hashes it, looks up the
 * AuthToken row, verifies expiry, and returns the Account (without the
 * password hash). Returns null when not authenticated / expired / invalid.
 *
 * Also checks for session staleness (>7 days old) and returns a
 * `rotatedCookie` if the token should be rotated. The caller should
 * set this cookie on the response to complete the rotation.
 *
 * This is the single source of truth for "who is calling this route".
 * The tier-gate calls this first, so logging in as Enterprise
 * transparently unlocks every tier-gated feature across the app.
 */
export async function getSessionUserWithRotation(req: NextRequest | null): Promise<SessionRotationResult> {
  const token = await readSessionToken(req)
  if (!token) return { user: null, rotatedCookie: null }
  try {
    const tokenHash = hashToken(token)
    const row = await db.authToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (!row) return { user: null, rotatedCookie: null }
    // Expiry check (defensive — cookies also expire client-side).
    if (row.expiresAt.getTime() < Date.now()) {
      // Clean up the expired token opportunistically.
      await db.authToken.delete({ where: { id: row.id } }).catch(() => {})
      return { user: null, rotatedCookie: null }
    }
    const { user } = row
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      tier: user.tier,
      createdAt: user.createdAt,
    }

    // Check if the token should be rotated (>7 days old)
    let rotatedCookie: string | null = null
    if (shouldRotateToken(row.createdAt)) {
      try {
        // Mint a new token
        const newToken = generateToken()
        const newTokenHash = hashToken(newToken)
        const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS)
        // Create the new token row
        await db.authToken.create({
          data: {
            tokenHash: newTokenHash,
            userId: user.id,
            expiresAt: newExpiresAt,
            userAgent: row.userAgent,
            ip: row.ip,
          },
        })
        // Delete the old token row
        await db.authToken.delete({ where: { id: row.id } }).catch(() => {})
        // Build the cookie header for the new token
        rotatedCookie = sessionCookieHeader(newToken, req)
      } catch (rotationErr) {
        // Rotation failure should NOT block the request — log and continue
        console.error('[auth] Token rotation failed (non-fatal):', rotationErr)
      }
    }

    return { user: authUser, rotatedCookie }
  } catch (err) {
    console.error('[auth] getSessionUser failed:', err)
    return { user: null, rotatedCookie: null }
  }
}

/**
 * Backward-compatible wrapper: resolves the authenticated user without
 * performing session rotation. Existing callers that don't need rotation
 * can continue using this function.
 */
export async function getSessionUser(req: NextRequest | null): Promise<AuthUser | null> {
  const { user } = await getSessionUserWithRotation(req)
  return user
}

/** Read the raw session token from the cookie on a request (or next/headers).
 *  Async because Next.js 16's `cookies()` returns a Promise. */
async function readSessionToken(req: NextRequest | null): Promise<string | null> {
  if (req) {
    const raw = req.cookies.get(SESSION_COOKIE)?.value
    if (raw) return raw
  }
  // Fallback: next/headers cookies() — usable inside route handlers / server
  // actions where no NextRequest is threaded in. Awaited because Next.js 16
  // made cookies() async. Wrapped because cookies() throws outside a request
  // scope.
  try {
    const store = await cookies()
    const raw = store.get(SESSION_COOKIE)?.value
    return raw ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Login / logout operations (DB side)
// ---------------------------------------------------------------------------

export interface LoginResult {
  ok: true
  user: AuthUser
  token: string
  setCookie: string
}
export interface LoginFailure {
  ok: false
  error: string
}

/**
 * Authenticate an email/password pair and mint a session token.
 * On success returns the user + the Set-Cookie header to attach.
 * Failure is reported as a generic 'Invalid email or password' to avoid
 * user-enumeration side channels.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  meta?: { userAgent?: string; ip?: string; req?: NextRequest | null },
): Promise<LoginResult | LoginFailure> {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !password) return { ok: false, error: 'Email and password are required' }
  try {
    const account = await db.account.findUnique({ where: { email: normalized } })
    if (!account) return { ok: false, error: 'Invalid email or password' }
    if (!verifyPassword(password, account.passwordHash)) {
      return { ok: false, error: 'Invalid email or password' }
    }
    const token = generateToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db.authToken.create({
      data: {
        tokenHash,
        userId: account.id,
        expiresAt,
        userAgent: meta?.userAgent?.slice(0, 255) ?? null,
        ip: meta?.ip?.slice(0, 64) ?? null,
      },
    })
    const user: AuthUser = {
      id: account.id,
      email: account.email,
      name: account.name,
      tier: account.tier,
      createdAt: account.createdAt,
    }
    return { ok: true, user, token, setCookie: sessionCookieHeader(token, meta?.req) }
  } catch (err) {
    console.error('[auth] loginWithPassword failed:', err)
    return { ok: false, error: 'Authentication service unavailable' }
  }
}

/**
 * Invalidate a session token (logout). Deletes the AuthToken row so the
 * token cannot be replayed even if the cookie lingers. Returns the
 * Set-Cookie header that clears the client cookie.
 */
export async function logout(req: NextRequest | null): Promise<string> {
  const token = await readSessionToken(req)
  if (token) {
    try {
      const tokenHash = hashToken(token)
      await db.authToken.deleteMany({ where: { tokenHash } }).catch(() => {})
    } catch {
      // ignore — cookie is cleared client-side regardless
    }
  }
  return clearCookieHeader(req)
}

// ---------------------------------------------------------------------------
// Bootstrap (first Enterprise admin)
// ---------------------------------------------------------------------------

/**
 * Create the first Enterprise admin account. Idempotent guard: refuses if
 * any Enterprise-tier account already exists (the door is one-time).
 * Email is normalized to lowercase; password is hashed with scrypt.
 */
export async function registerUser(
  email: string,
  password: string,
  name?: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string; status: number }> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: 'A valid email address is required', status: 400 }
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters', status: 400 }
  }
  try {
    if (await db.account.findUnique({ where: { email: normalized } })) {
      return { ok: false, error: 'An account with that email already exists. Please sign in instead.', status: 409 }
    }
    const account = await db.account.create({
      data: {
        email: normalized,
        passwordHash: hashPassword(password),
        name: name?.trim() || null,
        tier: 'free',
      },
    })
    return {
      ok: true,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        tier: account.tier,
        createdAt: account.createdAt,
      },
    }
  } catch (err) {
    console.error('[auth] registerUser failed:', err)
    return { ok: false, error: 'Registration service unavailable', status: 500 }
  }
}

/**
 * Create the first Enterprise admin account. Idempotent guard: refuses if
 * any Enterprise-tier account already exists (the door is one-time).
 * Email is normalized to lowercase; password is hashed with scrypt.
 */
export async function bootstrapEnterpriseAdmin(
  email: string,
  password: string,
  name?: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string; status: number }> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: 'A valid email address is required', status: 400 }
  }
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters', status: 400 }
  }
  try {
    const existingEnterprise = await db.account.findFirst({ where: { tier: 'enterprise' } })
    if (existingEnterprise) {
      return {
        ok: false,
        error: 'Enterprise admin already exists. Use the login form instead.',
        status: 409,
      }
    }
    if (await db.account.findUnique({ where: { email: normalized } })) {
      return { ok: false, error: 'That email is already registered', status: 409 }
    }
    const account = await db.account.create({
      data: {
        email: normalized,
        passwordHash: hashPassword(password),
        name: name?.trim() || null,
        tier: 'enterprise',
      },
    })
    return {
      ok: true,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        tier: account.tier,
        createdAt: account.createdAt,
      },
    }
  } catch (err) {
    console.error('[auth] bootstrapEnterpriseAdmin failed:', err)
    return { ok: false, error: 'Bootstrap service unavailable', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

/**
 * Change a user's tier. Enterprise-only callers (enforced by the route).
 * Validates the target tier slug against PRICING_TIERS. Returns the
 * updated account (without passwordHash).
 */
export async function setUserTier(
  targetUserId: string,
  newTier: string,
): Promise<AuthUser | null> {
  // Lazy import to avoid a circular dependency (constants imports nothing
  // from auth, but keep the pattern defensive).
  const { PRICING_TIERS } = await import('./constants')
  if (!PRICING_TIERS.some((t) => t.slug === newTier)) return null
  try {
    const updated = await db.account.update({
      where: { id: targetUserId },
      data: { tier: newTier },
    })
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      tier: updated.tier,
      createdAt: updated.createdAt,
    }
  } catch {
    return null
  }
}
