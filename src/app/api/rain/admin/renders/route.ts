import { NextRequest, NextResponse } from 'next/server'
import { withTierGate } from '@/lib/rain/tier-gate'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/rain/admin/renders
 *
 * Enterprise-only. Returns the most recent renders across ALL accounts
 * (default 50, capped at 200 via ?limit=). Each row includes the owning
 * account's email + tier so the admin console can attribute renders.
 * Used by the Admin Console "Recent Renders" table.
 */
export async function GET(req: NextRequest) {
  const gate = await withTierGate(req, 'enterprise')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, required: gate.required, current: gate.current },
      { status: gate.status },
    )
  }
  const url = new URL(req.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200)
  try {
    const renders = await db.render.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, tier: true, name: true } },
      },
    })
    return NextResponse.json({
      renders: renders.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        userId: r.userId,
        userEmail: r.user.email,
        userName: r.user.name,
        userTier: r.user.tier,
        format: r.format,
        loudnessLufs: r.loudnessLufs,
        truePeakDbfs: r.truePeakDbfs,
        renderTimeMs: r.renderTimeMs,
        outputFileHash: r.outputFileHash,
        createdAt: r.createdAt,
      })),
      actor: { id: gate.userId, tier: gate.tier },
    })
  } catch (err) {
    console.error('[admin/renders] failed:', err)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }
}
