import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import { loadBetaEntitlement } from '@/lib/rain/beta-entitlement'
import { getPaymentReadiness } from '@/lib/rain/payment-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/rain/beta-access
 *
 * Server-authoritative beta entitlement snapshot + payment readiness.
 *
 * Policy (operator-confirmed):
 *   - Two free full-capability renders (each includes one export).
 *   - After both are consumed, a verified once-off R49.00 ZAR unlock is required.
 *   - Paid beta: 1 500 credits/month at 25 credits/render + hard cap of
 *     30 successful exports/month.
 *   - Unlock lasts for the beta stage only; commercial launch ends it.
 *   - Checkout stays unavailable until public URL + PayFast live switch.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)
  const anonId = req.nextUrl.searchParams.get('anonId')?.slice(0, 128) || null

  if (!user && !anonId) {
    return NextResponse.json(
      { error: 'An anonymous beta ID or signed-in account is required.' },
      { status: 400 },
    )
  }

  try {
    const [snapshot, readiness] = await Promise.all([
      loadBetaEntitlement({
        userId: user?.id ?? null,
        anonId,
      }),
      Promise.resolve(getPaymentReadiness()),
    ])

    const exportsUsedForLegacy = snapshot.hasVerifiedR49Unlock
      ? snapshot.successfulExportsThisMonth
      : snapshot.completedFreeRenders

    return NextResponse.json(
      {
        ...snapshot,
        // Override hardcoded not_live flags with the real readiness gate.
        checkoutConfigured: readiness.credentialsPresent && readiness.publicUrlConfirmed,
        checkoutAvailable: readiness.checkoutAvailable,
        paymentStatus: readiness.paymentStatus,
        paymentProvider: readiness.provider,
        paymentBlockers: readiness.blockers,
        exportsUsed: exportsUsedForLegacy,
        exportsRemaining: snapshot.hasVerifiedR49Unlock
          ? snapshot.monthlyExportsRemaining ?? 0
          : snapshot.freeRendersRemaining,
        unlockRequired: snapshot.reason === 'payment-required',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[api/rain/beta-access] entitlement load failed:', error)
    return NextResponse.json(
      { error: 'Beta entitlement could not be verified. Please retry.' },
      { status: 503 },
    )
  }
}
