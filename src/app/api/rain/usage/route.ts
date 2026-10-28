import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import {
  completeUsage,
  loadBetaEntitlement,
  releaseUsage,
  reserveUsage,
} from '@/lib/rain/beta-entitlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/rain/usage
 *
 * Atomic usage ledger operations for the beta entitlement policy.
 *
 * body: {
 *   action: 'reserve' | 'complete' | 'release' | 'status'
 *   kind?: 'use_credit' | 'export'   // required for reserve/complete
 *   operationId?: string
 *   reservationId?: string           // required for release; optional for complete
 *   format?: string
 *   anonId?: string
 * }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  const anonId = typeof body.anonId === 'string' && body.anonId.length > 0
    ? body.anonId.slice(0, 128)
    : null
  const kind = body.kind === 'use_credit' || body.kind === 'export' ? body.kind : null
  const operationId = typeof body.operationId === 'string' ? body.operationId.slice(0, 128) : null
  const reservationId = typeof body.reservationId === 'string' ? body.reservationId.slice(0, 128) : null
  const format = typeof body.format === 'string' ? body.format.slice(0, 32) : null

  if (!user && !anonId) {
    return NextResponse.json(
      { error: 'An anonymous beta ID or signed-in account is required.' },
      { status: 400 },
    )
  }

  try {
    if (action === 'status') {
      const entitlement = await loadBetaEntitlement({
        userId: user?.id ?? null,
        anonId,
      })
      return NextResponse.json(entitlement, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (action === 'reserve') {
      if (!kind) {
        return NextResponse.json({ error: 'kind must be use_credit or export' }, { status: 400 })
      }
      const result = await reserveUsage({
        userId: user?.id ?? null,
        anonId,
        kind,
        operationId,
        format,
        metadata: { source: 'usage_route' },
      })
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, reason: result.reason, entitlement: result.entitlement },
          { status: result.status },
        )
      }
      return NextResponse.json({
        ok: true,
        reservationId: result.reservationId,
        entitlement: result.entitlement,
      })
    }

    if (action === 'complete') {
      if (!kind) {
        return NextResponse.json({ error: 'kind must be use_credit or export' }, { status: 400 })
      }
      const result = await completeUsage({
        userId: user?.id ?? null,
        anonId,
        kind,
        operationId,
        reservationId,
        format,
        metadata: { source: 'usage_route' },
      })
      return NextResponse.json({ ok: true, created: result.created, id: result.id })
    }

    if (action === 'release') {
      if (!reservationId) {
        return NextResponse.json({ error: 'reservationId is required to release' }, { status: 400 })
      }
      const released = await releaseUsage({
        userId: user?.id ?? null,
        anonId,
        reservationId,
      })
      return NextResponse.json({ ok: true, released })
    }

    return NextResponse.json(
      { error: 'action must be reserve, complete, release, or status' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[api/rain/usage] failed:', err)
    return NextResponse.json({ error: 'Usage operation failed.' }, { status: 503 })
  }
}
