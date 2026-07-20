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
 * Body: { name?: string, fileName?: string }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  let body: { name?: unknown; fileName?: unknown }
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

  try {
    const session = await db.session.create({
      data: {
        userId: user.id,
        name,
        status: 'draft',
      },
    })

    void trackEvent({ userId: user.id, type: 'session_created', metadata: { sessionId: session.id } })

    return NextResponse.json({ sessionId: session.id }, { status: 201 })
  } catch (err) {
    console.error('[api/rain/session] create failed:', err)
    // Never block the mastering workflow on an analytics write — the client
    // can proceed without a sessionId; the render endpoint tolerates that.
    return NextResponse.json({ sessionId: null }, { status: 200 })
  }
}
