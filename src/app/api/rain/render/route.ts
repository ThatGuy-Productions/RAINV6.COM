import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { completeUsage, loadBetaEntitlement } from '@/lib/rain/beta-entitlement'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

const FORMATS = new Set(['wav24', 'wav16', 'mp3_320', 'atmos'])

/**
 * POST /api/rain/render
 *
 * Client-reported render/export completion. Browser encodes locally, so this
 * is usage telemetry + quota accounting, not proof of download.
 *
 * Prefer POST /api/rain/usage (reserve → complete/release) for new clients.
 * This route still enforces entitlement and completes the ledger on success.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.kind !== 'render' && body.kind !== 'export') {
    return NextResponse.json({ error: 'kind must be render or export' }, { status: 400 })
  }
  const kind = body.kind as 'render' | 'export'
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
    ? body.sessionId.slice(0, 128)
    : undefined
  const format = typeof body.format === 'string' ? body.format : undefined
  const outputFileHash = typeof body.outputFileHash === 'string' ? body.outputFileHash.toLowerCase() : undefined
  const validOutputHash = outputFileHash ? /^[a-f0-9]{64}$/.test(outputFileHash) : false
  const loudnessLufs = typeof body.loudnessLufs === 'number' && Number.isFinite(body.loudnessLufs)
    ? body.loudnessLufs
    : undefined
  const truePeakDbfs = typeof body.truePeakDbfs === 'number' && Number.isFinite(body.truePeakDbfs)
    ? body.truePeakDbfs
    : undefined
  const renderTimeMs = typeof body.renderTimeMs === 'number' && Number.isFinite(body.renderTimeMs)
    ? Math.max(0, Math.min(86_400_000, Math.floor(body.renderTimeMs)))
    : undefined
  const anonId = typeof body.anonId === 'string' && body.anonId.length > 0
    ? body.anonId.slice(0, 128)
    : null
  const operationId = typeof body.operationId === 'string' && body.operationId.length > 0
    ? body.operationId.slice(0, 128)
    : (validOutputHash ? outputFileHash : null)
  const reservationId = typeof body.reservationId === 'string'
    ? body.reservationId.slice(0, 128)
    : null

  if (kind === 'export' && (!format || !FORMATS.has(format))) {
    return NextResponse.json({ error: 'A supported export format is required.' }, { status: 400 })
  }
  if (outputFileHash && !validOutputHash) {
    return NextResponse.json({ error: 'outputFileHash must be a 64-character SHA-256 hex digest.' }, { status: 400 })
  }
  if (!user && !anonId) {
    return NextResponse.json({ error: 'An anonymous beta ID or signed-in account is required.' }, { status: 400 })
  }

  if (user && sessionId) {
    const ownedSession = await db.session.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { id: true },
    }).catch(() => null)
    if (!ownedSession) {
      return NextResponse.json({ error: 'Session not found for this account.' }, { status: 403 })
    }
  }

  let entitlement
  try {
    entitlement = await loadBetaEntitlement({
      userId: user?.id ?? null,
      anonId,
    })
  } catch (err) {
    console.error('[api/rain/render] entitlement load failed:', err)
    return NextResponse.json({ error: 'Beta entitlement could not be verified.' }, { status: 503 })
  }

  // A reservation may bypass a fresh entitlement snapshot only when the
  // durable ledger proves it belongs to this identity, is still reserved,
  // and represents the operation being completed. Never trust an ID alone.
  let hasReservation = false
  if (reservationId) {
    const expectedKind = kind === 'render' ? 'use_credit' : 'export'
    const validReservation = await db.usageRecord.findFirst({
      where: {
        id: reservationId,
        kind: expectedKind,
        status: 'reserved',
        ...(user
          ? { userId: user.id }
          : { userId: null, anonId }),
      },
      select: { id: true },
    }).catch(() => null)

    if (!validReservation) {
      return NextResponse.json(
        { error: 'Reservation is invalid, expired, already completed, or not owned by this identity.' },
        { status: 409 },
      )
    }
    hasReservation = true
  }

  // A verified reservation holds its slot even if another tab has since
  // filled the remaining allowance.
  if (!hasReservation) {
    if (kind === 'render' && !entitlement.canStartFullCapabilityRender) {
      return NextResponse.json({
        error: 'Full-capability render not allowed under current beta entitlement.',
        reason: entitlement.reason,
        entitlement,
      }, { status: 402 })
    }
    if (kind === 'export' && !entitlement.canExport) {
      return NextResponse.json({
        error: 'Export not allowed under current beta entitlement.',
        reason: entitlement.reason,
        entitlement,
      }, { status: 402 })
    }
  }

  const eventType = kind === 'export' ? 'export_completed' : 'render_completed'
  const metadata = {
    sessionId: user ? sessionId ?? null : null,
    format: format ?? null,
    renderTimeMs: renderTimeMs ?? null,
    hasOutputHash: validOutputHash,
    clientReported: true,
    outputFileIndependentlyVerified: false,
  }

  try {
    await completeUsage({
      userId: user?.id ?? null,
      anonId,
      kind: 'use_credit',
      operationId: operationId ? `use:${operationId}` : null,
      reservationId: kind === 'render' ? reservationId : null,
      format: format ?? null,
      metadata: { ...metadata, source: 'render_route' },
    })
    if (kind === 'export') {
      await completeUsage({
        userId: user?.id ?? null,
        anonId,
        kind: 'export',
        operationId: operationId ? `export:${operationId}` : null,
        reservationId: kind === 'export' ? reservationId : null,
        format: format ?? null,
        metadata: { ...metadata, source: 'render_route' },
      })
    }

    if (!user) {
      const recorded = await trackEvent({
        userId: null,
        anonId,
        type: eventType,
        metadata: { ...metadata, anonymous: true },
      })
      if (!recorded) {
        return NextResponse.json(
          { ok: false, telemetryRecorded: false, error: 'Usage event could not be persisted.' },
          { status: 503 },
        )
      }
      return NextResponse.json({
        ok: true,
        telemetryRecorded: true,
        renderId: null,
        anonymous: true,
        evidence: 'client-reported',
        reason: entitlement.reason,
      }, { status: 200 })
    }

    const result = await db.$transaction(async (tx) => {
      let renderId: string | null = null
      if (kind === 'export' && sessionId && format && validOutputHash && outputFileHash) {
        const row = await tx.render.create({
          data: {
            sessionId,
            userId: user.id,
            format,
            outputFileHash,
            loudnessLufs,
            truePeakDbfs,
            renderTimeMs,
          },
          select: { id: true },
        })
        renderId = row.id
      }

      await tx.event.create({
        data: {
          userId: user.id,
          anonId,
          type: eventType,
          metadata: JSON.stringify({ ...metadata, renderId }),
        },
      })
      await tx.account.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      })
      return { renderId }
    })

    return NextResponse.json({
      ok: true,
      telemetryRecorded: true,
      renderId: result.renderId,
      anonymous: false,
      evidence: 'client-reported',
      reason: entitlement.reason,
    }, { status: 201 })
  } catch (err) {
    console.error('[api/rain/render] failed to persist usage event:', err)
    return NextResponse.json(
      { ok: false, telemetryRecorded: false, error: 'Usage event could not be persisted.' },
      { status: 503 },
    )
  }
}
