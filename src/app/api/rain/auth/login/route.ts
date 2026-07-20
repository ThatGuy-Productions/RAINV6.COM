import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/rain/auth'
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
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const result = await loginWithPassword(email, password, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    req,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }
  void trackEvent({ userId: result.user.id, type: 'login' })
  const res = NextResponse.json({ user: result.user })
  res.headers.set('Set-Cookie', result.setCookie)
  return res
}
