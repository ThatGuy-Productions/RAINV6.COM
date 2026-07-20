import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/render
 *
 * Persists a completed render/export and fires the matching Event.
 * Previously `Render` existed in schema.prisma but nothing wrote to it —
 * the 16-stage pipeline runs entirely client-side in audio-engine.ts and
 * never touched the DB, so `usage.ts`'s totalRenders/totalExports always
 * read zero regardless of real usage. This route is the fix.
 *
 * Called twice from MasteringTab per user action:
 *   1. `kind: "render"` right after Stage 16 completes (audioEngine.render()
 *      resolves) — no format/file yet, just marks the master as produced.
 *   2. `kind: "export"` right after a WAV/MP3/Atmos download completes —
 *      creates the actual Render row (format + hash + measured LUFS/TP are
 *      known at this point) and fires export_completed.
 *
 * Body: {
 *   kind: 'render' | 'export'
 *   sessionId?: string
 *   format?: 'wav24' | 'wav16' | 'mp3_320' | 'atmos'
 *   outputFileHash?: string
 *   loudnessLufs?: number
 *   truePeakDbfs?: number
 *   renderTimeMs?: number
 * }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const kind = body.kind === 'export' ? 'export' : 'render'
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
  const format = typeof body.format === 'string' ? body.format : undefined
  const outputFileHash = typeof body.outputFileHash === 'string' ? body.outputFileHash : undefined
  const loudnessLufs = typeof body.loudnessLufs === 'number' ? body.loudnessLufs : undefined
  const truePeakDbfs = typeof body.truePeakDbfs === 'number' ? body.truePeakDbfs : undefined
  const renderTimeMs = typeof body.renderTimeMs === 'number' ? body.renderTimeMs : undefined

  try {
    // Only create a Render row once we have the fields the model requires
    // (sessionId, format, outputFileHash) — the plain "render" ping right
    // after Stage 16 usually won't have those yet, and that's fine: it
    // still logs a render_completed Event, which is what activation math
    // reads from.
    let renderId: string | null = null
    if (sessionId && format && outputFileHash) {
      const row = await db.render.create({
        data: {
          sessionId,
          userId: user.id,
          format,
          outputFileHash,
          loudnessLufs,
          truePeakDbfs,
          renderTimeMs,
        },
      })
      renderId = row.id
    }

    void trackEvent({
      userId: user.id,
      type: kind === 'export' ? 'export_completed' : 'render_completed',
      metadata: { sessionId, format, renderId },
    })

    return NextResponse.json({ ok: true, renderId }, { status: 201 })
  } catch (err) {
    console.error('[api/rain/render] failed:', err)
    // Never let an analytics write block the user's actual export/download.
    return NextResponse.json({ ok: true, renderId: null }, { status: 200 })
  }
}
