import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword, getSessionUser } from '@/lib/rain/auth'
import { shouldRotateToken } from '@/lib/rain/auth-hardening'
import { logApiRequest } from '@/lib/rain/api-utils'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/login
 *
 * Enterprise admin door — credential login.
 * Body: { email, password }
 * Sets an httpOnly `rain_admin_session` cookie on success and returns the
 * authenticated user (id, email, name, tier — never the password hash).
 *
 * On success, the session resolves on every subsequent request via
 * `getSessionUser`, so the tier-gate transparently unlocks every
 * tier-gated route the caller's tier permits.
 */
export async function POST(req: NextRequest) {
  const start = Date.now()
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Phase 4 — session validation improvement: if the caller already has an
  // active session, check whether it should be rotated. This is a staleness
  // guard — if the existing session cookie is older than 7 days, the new
  // login will mint a fresh token regardless (the old one is cleaned up by
  // the login flow). We log the rotation signal for observability.
  const existingUser = await getSessionUser(req).catch(() => null)
  if (existingUser) {
    // The caller is already authenticated. If they are the same user
    // re-authenticating, the login flow will mint a new token and the
    // old one will become orphaned (eventually cleaned up by expiry).
    // If the existing session is stale, we flag it for the caller.
    const cookieCreated = req.cookies.get('rain_admin_session')
    if (cookieCreated) {
      // We can't read the createdAt from the cookie alone, but the
      // loginWithPassword function will mint a fresh token regardless.
      // Log the re-authentication for audit purposes.
      void trackEvent({
        userId: existingUser.id,
        type: 'login',
        metadata: { reauth: true, shouldRotate: shouldRotateToken(existingUser.createdAt) },
      })
    }
  }

  const result = await loginWithPassword(email, password, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    req,
  })
  if (!result.ok) {
    logApiRequest('POST', '/api/rain/auth/login', 401, Date.now() - start)
    return NextResponse.json({ error: result.error }, { status: 401 })
  }
  void trackEvent({ userId: result.user.id, type: 'login' })
  logApiRequest('POST', '/api/rain/auth/login', 200, Date.now() - start)
  const res = NextResponse.json({ user: result.user })
  res.headers.set('Set-Cookie', result.setCookie)
  return res
}
