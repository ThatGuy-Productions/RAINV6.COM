import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/** Records genuine paywall/checkout intent for the beta conversion funnel.
 * This endpoint cannot mark a user as paid; paid status must only be granted
 * by a verified payment-provider callback. */
export const POST = withCsrf(async (req: NextRequest) => {
  let body: { anonId?: unknown; event?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const event = body.event
  if (event !== 'beta_paywall_shown' && event !== 'beta_checkout_started') {
    return NextResponse.json({ error: 'Unsupported beta conversion event.' }, { status: 400 })
  }
  const user = await getSessionUser(req).catch(() => null)
  const anonId = typeof body.anonId === 'string' ? body.anonId.slice(0, 128) : null
  const recorded = await trackEvent({
    userId: user?.id ?? null,
    anonId,
    type: event,
    metadata: { amountCents: 4900, currency: 'ZAR', policy: 'two-free-exports' },
  })
  if (!recorded) return NextResponse.json({ error: 'Conversion event could not be stored.' }, { status: 503 })
  return NextResponse.json({ ok: true })
})
