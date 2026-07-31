import { NextRequest, NextResponse } from 'next/server'
import { withTierGate } from '@/lib/rain/tier-gate'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/rain/admin/accounts
 *
 * Enterprise-only. Returns every account with its render count and last
 * render timestamp, sorted by creation date descending. Password hashes
 * are never selected. Used by the Admin Console accounts table.
 */
export async function GET(req: NextRequest) {
  const gate = await withTierGate(req, 'enterprise')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, required: gate.required, current: gate.current },
      { status: gate.status },
    )
  }
  try {
    const accounts = await db.account.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        tier: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { renders: true, authTokens: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Last render timestamp per account (one extra query — cheap with the
    // createdAt index on Render).
    const lastRenders = await db.render.groupBy({
      by: ['userId'],
      _max: { createdAt: true },
    })
    const lastByUser = new Map(lastRenders.map((r) => [r.userId, r._max.createdAt]))

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        tier: a.tier,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        renderCount: a._count.renders,
        activeTokens: a._count.authTokens,
        lastRenderAt: lastByUser.get(a.id) ?? null,
      })),
      actor: { id: gate.userId, tier: gate.tier },
    })
  } catch (err) {
    console.error('[admin/accounts] failed:', err)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }
}
