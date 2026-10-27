import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Counts recorded successful exports for this account or anonymous browser.
 * Historical usage before durable telemetry was deployed is unknowable and is
 * deliberately not inferred. This is a beta UX gate, not a security boundary:
 * exports are generated locally in the browser. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)
  const anonId = req.nextUrl.searchParams.get('anonId')?.slice(0, 128) || null
  if (!user && !anonId) {
    return NextResponse.json({ error: 'An anonymous beta ID or signed-in account is required.' }, { status: 400 })
  }
  try {
    // Keep anonymous exports attached to the same browser identity when a
    // visitor later signs in; account creation must not reset the two-export
    // allowance on that browser.
    const where = user
      ? { type: 'export_completed', OR: anonId ? [{ userId: user.id }, { anonId }] : [{ userId: user.id }] }
      : { type: 'export_completed', userId: null, anonId }
    const exportsUsed = await db.event.count({ where })
    return NextResponse.json({
      policy: 'beta-two-exports-then-r49-unlock',
      exportsUsed,
      exportsRemaining: Math.max(0, 2 - exportsUsed),
      unlockRequired: exportsUsed >= 2,
      unlockAmountCents: 4900,
      currency: 'ZAR',
      historicalDataComplete: false,
      // Environment-variable presence is not proof that a verified checkout
      // integration exists. Keep this false until a provider callback/webhook,
      // durable payment ledger and sandbox acceptance tests are implemented.
      checkoutConfigured: false,
      checkoutAvailable: false,
      paymentStatus: 'not_live',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[api/rain/beta-access] count failed:', error)
    return NextResponse.json({ error: 'Beta export allowance could not be verified. Please retry.' }, { status: 503 })
  }
}
