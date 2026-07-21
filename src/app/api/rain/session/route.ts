import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/session
 *
 * Persists a mastering Session row when a user loads a track and starts
 * working. Previously this model existed in schema.prisma but nothing
 * server-side ever wrote to it — the whole workflow ran client-only, so
 * `Session` was a dead table. This route (called once per track load from
 * MasteringTab, not once per render) is what makes it real, and is what
 * server-analytics.ts's funnel/session-depth math depends on.
 *
 * ANONYMOUS ACCESS (free-beta analytics): if no user is signed in, the
 * route no longer returns 401. Instead it fires a `session_created` Event
 * with the caller's anonId (so the activation/retention/funnel still
 * captures free-beta usage) and returns `{ sessionId: null }` with 200.
 * The Session row itself requires a userId FK, so it is skipped for
 * anonymous callers — the Event is the source of truth for funnel math.
 *
 * Body: { name?: string, fileName?: string, anonId?: string }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)

  let body: { name?: unknown; fileName?: unknown; anonId?: unknown }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 200)
      : typeof body.fileName === 'string'
        ? body.fileName.slice(0, 200)
        : 'Untitled'
  const anonId =
    typeof body.anonId === 'string' && body.anonId.length > 0
      ? body.anonId.slice(0, 128)
      : null

  // Anonymous path: fire the Event so the funnel captures this session,
  // but don't create a Session row (it requires a userId FK).
  if (!user) {
    void trackEvent({
      userId: null,
      anonId,
      type: 'session_created',
      metadata: { name, anonymous: true },
    })
    return NextResponse.json({ sessionId: null, anonymous: true }, { status: 200 })
  }

  try {
    const session = await db.session.create({
      data: {
        userId: user.id,
        name,
        status: 'draft',
      },
    })

    void trackEvent({
      userId: user.id,
      anonId,
      type: 'session_created',
      metadata: { sessionId: session.id },
    })

    return NextResponse.json({ sessionId: session.id, anonymous: false }, { status: 201 })
  } catch (err) {
    console.error('[api/rain/session] create failed:', err)
    // Never block the mastering workflow on an analytics write — the client
    // can proceed without a sessionId; the render endpoint tolerates that.
    return NextResponse.json({ sessionId: null }, { status: 200 })
  }
}
