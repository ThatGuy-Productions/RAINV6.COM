import { verifyBootstrapSecret } from '@/lib/rain/bootstrap-secret'
import { NextRequest, NextResponse } from 'next/server'
import { bootstrapEnterpriseAdmin, loginWithPassword } from '@/lib/rain/auth'
import { checkRateLimit } from '@/lib/rain/rate-limit'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/**
 * POST /api/rain/admin/bootstrap
 *
 * One-time Enterprise admin setup. Creates the first Enterprise-tier
 * account and immediately issues a session (logs the caller in). Refuses
 * with 409 if any Enterprise account already exists — the door is one-time.
 *
 * SECURITY FIX (C1): Rate limited to 3 attempts per minute per IP to prevent
 * brute-force race-condition attacks.
 *
 * Body: { email, password, name?, bootstrapSecret }
 */
export const POST = withCsrf(async (req: NextRequest) => {
  // Rate limit: 3 bootstrap attempts per minute per IP (conservative)
  // The existing rate limiter uses RPM (requests per minute).
  // 3 RPM = 3 attempts per minute, which is sufficient for a one-time endpoint.
  const rl = await checkRateLimit(req, 'bootstrap', 3)
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.unavailable ? 'Rate limiting service unavailable' : 'Too many bootstrap attempts', retryAfter: rl.retryAfter },
      { status: rl.unavailable ? 503 : 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: { email?: unknown; password?: unknown; name?: unknown; bootstrapSecret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const bootstrapStatus = verifyBootstrapSecret(body.bootstrapSecret)
  if (bootstrapStatus === 'disabled') {
    return NextResponse.json(
      { error: 'Admin bootstrap is disabled: configure RAIN_ADMIN_BOOTSTRAP_SECRET with at least 32 characters.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (bootstrapStatus !== 'valid') {
    return NextResponse.json({ error: 'Invalid bootstrap credentials.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name : undefined

  const result = await bootstrapEnterpriseAdmin(email, password, name)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // Immediately mint a session for the new admin.
  const session = await loginWithPassword(email, password, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    req,
  })
  if (!session.ok) {
    return NextResponse.json(
      { user: result.user, error: 'Account created. Please log in.' },
      { status: 201 },
    )
  }
  const res = NextResponse.json({ user: result.user }, { status: 201 })
  res.headers.set('Set-Cookie', session.setCookie)
  return res
})
