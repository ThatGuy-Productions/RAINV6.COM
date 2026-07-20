import { NextRequest, NextResponse } from 'next/server'
import { bootstrapEnterpriseAdmin, loginWithPassword } from '@/lib/rain/auth'

export const runtime = 'nodejs'

/**
 * POST /api/rain/admin/bootstrap
 *
 * One-time Enterprise admin setup. Creates the first Enterprise-tier
 * account and immediately issues a session (logs the caller in). Refuses
 * with 409 if any Enterprise account already exists — the door is one-time.
 *
 * Body: { email, password, name? }
 *
 * This is the literal "admin door": the first person through it sets the
 * enterprise admin credentials. After bootstrap, the login form is the
 * only way in.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
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
  })
  if (!session.ok) {
    // Account was created but session minting failed — instruct login.
    return NextResponse.json(
      { user: result.user, error: 'Account created. Please log in.' },
      { status: 201 },
    )
  }
  const res = NextResponse.json({ user: result.user }, { status: 201 })
  res.headers.set('Set-Cookie', session.setCookie)
  return res
}
