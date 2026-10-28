import { NextRequest, NextResponse } from 'next/server'
import { registerUser, loginWithPassword } from '@/lib/rain/auth'
import { attachAnonymousUsageToAccount } from '@/lib/rain/anon-usage-link'
import { trackEvent } from '@/lib/rain/server-analytics'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/register
 *
 * Public registration — free tier, open to everyone.
 * Body: { email, password, name?, anonId? }
 *
 * Creates the account on the free tier, then immediately logs them in
 * by returning the same cookie + user payload as the login endpoint.
 *
 * When anonId is supplied, pre-signup UsageRecord and Event rows for that
 * anonymous identity are attached to the new account so free allowance is
 * not reset by registration.
 */
export const POST = withCsrf(async (req: NextRequest) => {
  let body: { email?: unknown; password?: unknown; name?: unknown; anonId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const anonId = typeof body.anonId === 'string' ? body.anonId.slice(0, 128) : undefined

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const regResult = await registerUser(email, password, name)
  if (!regResult.ok) {
    return NextResponse.json({ error: regResult.error }, { status: regResult.status })
  }

  // Attach anonymous ledger/events before the response so quota is continuous.
  if (anonId) {
    await attachAnonymousUsageToAccount(regResult.user.id, anonId).catch((err) => {
      console.error('[auth/register] anon usage attach failed:', err)
    })
  }

  void trackEvent({ userId: regResult.user.id, anonId, type: 'signup', metadata: { anonId } })

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
})
