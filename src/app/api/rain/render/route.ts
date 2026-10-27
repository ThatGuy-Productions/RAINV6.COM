import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

const FORMATS = new Set(['wav24', 'wav16', 'mp3_320', 'atmos'])

/**
 * POST /api/rain/render
 *
 * Persists a client-reported render/export event. The browser performs local
 * audio encoding, so this endpoint cannot independently prove that a file was
 * downloaded. Treat these events as usage telemetry, not cryptographic proof
 * of output or a tamper-proof entitlement boundary.
 *
 * Authenticated Render rows are written only when the session belongs to the
 * caller and a supported format plus SHA-256-shaped output hash are supplied.
 * Event and Render writes for authenticated users are transactional.
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
  const kind = body.kind
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

  if (kind === 'export' && (!format || !FORMATS.has(format))) {
    return NextResponse.json({ error: 'A supported export format is required.' }, { status: 400 })
  }
  if (outputFileHash && !validOutputHash) {
    return NextResponse.json({ error: 'outputFileHash must be a 64-character SHA-256 hex digest.' }, { status: 400 })
  }

  // A signed-in user may not attach a render to another account's project.
  if (user && sessionId) {
    const ownedSession = await db.session.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { id: true },
    }).catch(() => null)
    if (!ownedSession) {
      return NextResponse.json({ error: 'Session not found for this account.' }, { status: 403 })
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
    }, { status: 201 })
  } catch (err) {
    console.error('[api/rain/render] failed to persist usage event:', err)
    return NextResponse.json(
      { ok: false, telemetryRecorded: false, error: 'Usage event could not be persisted.' },
      { status: 503 },
    )
  }
}
