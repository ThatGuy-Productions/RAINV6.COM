import { NextRequest, NextResponse } from 'next/server'
import { registerUser, loginWithPassword } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/register
 *
 * Public registration — free tier, open to everyone.
 * Body: { email, password, name? }
 *
 * Creates the account on the free tier, then immediately logs them in
 * by returning the same cookie + user payload as the login endpoint.
 * This means a new user is authenticated in a single request.
 *
 * Data isolation: every new account has its own userId. Sessions, renders,
 * and stems are scoped to that userId via Prisma — no cross-user access.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  // Optional: client-generated anonymous ID set before signup, so pre-auth
  // funnel events (landing page, tab exploration) can be attributed to the
  // account after it's created. Purely additive — signup works without it.
  const anonId = typeof body.anonId === 'string' ? body.anonId.slice(0, 128) : undefined

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Register the account on the free tier
  const regResult = await registerUser(email, password, name)
  if (!regResult.ok) {
    return NextResponse.json({ error: regResult.error }, { status: regResult.status })
  }

  void trackEvent({ userId: regResult.user.id, anonId, type: 'signup', metadata: { anonId } })

  // Auto-login: mint a session token and set the cookie
  const loginResult = await loginWithPassword(email, password, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    req,
  })

  if (!loginResult.ok) {
    return NextResponse.json({ user: regResult.user, note: 'Account created. Please sign in.' }, { status: 201 })
  }

  const res = NextResponse.json({ user: loginResult.user }, { status: 201 })
  res.headers.set('Set-Cookie', loginResult.setCookie)
  return res
}
