import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/** Records AIE activity without transmitting the voice vector or source audio.
 * Only event type and coarse operational metrics are retained. */
export const POST = withCsrf(async (req: NextRequest) => {
  let body: { event?: unknown; anonId?: unknown; sessions?: unknown; stability?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body.event !== 'aie_vector_computed' && body.event !== 'aie_vector_exported') {
    return NextResponse.json({ error: 'Unsupported AIE event.' }, { status: 400 })
  }
  const sessions = typeof body.sessions === 'number' && Number.isFinite(body.sessions)
    ? Math.max(0, Math.min(100_000, Math.floor(body.sessions)))
    : undefined
  const stability = typeof body.stability === 'number' && Number.isFinite(body.stability)
    ? Math.max(0, Math.min(1, body.stability))
    : undefined
  const user = await getSessionUser(req).catch(() => null)
  const anonId = typeof body.anonId === 'string' ? body.anonId.slice(0, 128) : null
  const recorded = await trackEvent({
    userId: user?.id ?? null,
    anonId,
    type: body.event,
    metadata: { sessions, stability, vectorStored: false, sourceAudioUploaded: false },
  })
  if (!recorded) return NextResponse.json({ error: 'AIE activity could not be stored.' }, { status: 503 })
  return NextResponse.json({ ok: true })
})
