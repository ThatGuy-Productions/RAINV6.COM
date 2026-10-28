import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import { loadBetaEntitlement } from '@/lib/rain/beta-entitlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/rain/beta-access
 *
 * Server-authoritative beta entitlement snapshot.
 *
 * Policy (operator-confirmed):
 *   - Two free full-capability renders (each includes one export).
 *   - After both are consumed, a verified R49.00 ZAR unlock is required.
 *   - Paid beta: 1 500 credits/month at 25 credits/render + hard cap of
 *     30 successful exports/month.
 *
 * Checkout is intentionally unavailable until a real provider, verified
 * webhook, and durable payment/entitlement ledger are implemented.
 * Browser-local encoding means this gate is authoritative for product UX
 * and telemetry, not cryptographic proof that a file left the device.
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
    const snapshot = await loadBetaEntitlement({
      userId: user?.id ?? null,
      anonId,
    })

    // Backward-compatible fields for existing clients that still read
    // exportsUsed / unlockRequired, plus the full policy decision.
    const exportsUsedForLegacy = snapshot.hasVerifiedR49Unlock
      ? snapshot.successfulExportsThisMonth
      : snapshot.completedFreeRenders

    return NextResponse.json(
      {
        ...snapshot,
        // Legacy aliases (do not invent history; these mirror the decision).
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
