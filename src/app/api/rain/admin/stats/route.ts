import { NextRequest, NextResponse } from 'next/server'
import { withTierGate } from '@/lib/rain/tier-gate'
import { db } from '@/lib/db'
import { PRICING_TIERS } from '@/lib/rain/constants'
import {
  getActivationStats,
  getRetentionCohorts,
  getFunnelStats,
  getAverageFeatureDepth,
} from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * GET /api/rain/admin/stats
 *
 * Enterprise-only. System-wide statistics computed from real stored data:
 *   - total accounts + breakdown by tier (every PRICING_TIERS slug)
 *   - total renders + breakdown by format
 *   - renders in the last 24h / 7d / 30d
 *   - total mastering sessions + by status
 *   - total inference jobs + by status
 *   - active auth tokens (live sessions)
 *
 * No random values, no fabricated metrics — every number is a real COUNT
 * from the database. Used by the Admin Console overview cards.
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
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      accountTiers,
      renderFormats,
      renders24h,
      renders7d,
      renders30d,
      totalRenders,
      totalAccounts,
      totalSessions,
      sessionStatuses,
      totalJobs,
      jobStatuses,
      activeTokens,
      avgRenderTime,
    ] = await Promise.all([
      db.account.groupBy({ by: ['tier'], _count: { _all: true } }),
      db.render.groupBy({ by: ['format'], _count: { _all: true } }),
      db.render.count({ where: { createdAt: { gte: dayAgo } } }),
      db.render.count({ where: { createdAt: { gte: weekAgo } } }),
      db.render.count({ where: { createdAt: { gte: monthAgo } } }),
      db.render.count(),
      db.account.count(),
      db.session.count(),
      db.session.groupBy({ by: ['status'], _count: { _all: true } }),
      db.inferenceJob.count(),
      db.inferenceJob.groupBy({ by: ['status'], _count: { _all: true } }),
      db.authToken.count({ where: { expiresAt: { gt: now } } }),
      db.render.aggregate({ _avg: { renderTimeMs: true }, _max: { renderTimeMs: true } }),
    ])

    // BETA-ANALYTICS: activation/retention/funnel/feature-depth — the
    // metrics that actually matter for a valuation conversation, as
    // opposed to raw signup counts. Computed from the Event log (see
    // server-analytics.ts). Isolated in its own try/catch so a problem
    // here never takes down the existing, already-shipped stats above.
    let betaMetrics: {
      activation: Awaited<ReturnType<typeof getActivationStats>>
      retention: Awaited<ReturnType<typeof getRetentionCohorts>>
      funnel: Awaited<ReturnType<typeof getFunnelStats>>
      avgFeatureDepth: number
    } | null = null
    try {
      const [activation, retention, funnel, avgFeatureDepth] = await Promise.all([
        getActivationStats(),
        getRetentionCohorts([1, 7, 30]),
        getFunnelStats(),
        getAverageFeatureDepth(),
      ])
      betaMetrics = { activation, retention, funnel, avgFeatureDepth }
    } catch (err) {
      console.error('[admin/stats] beta metrics query failed:', err)
    }

    // Build a full tier breakdown including zero-count tiers (so the UI can
    // render a complete bar chart of the pricing ladder).
    const tierBreakdown = PRICING_TIERS.map((t) => {
      const row = accountTiers.find((r) => r.tier === t.slug)
      return { slug: t.slug, name: t.name, accent: t.accent, count: row?._count._all ?? 0 }
    })

    return NextResponse.json({
      totals: {
        accounts: totalAccounts,
        renders: totalRenders,
        sessions: totalSessions,
        inferenceJobs: totalJobs,
        activeSessions: activeTokens,
      },
      tierBreakdown,
      renderFormats: renderFormats.map((r) => ({ format: r.format, count: r._count._all })),
      renderVelocity: {
        last24h: renders24h,
        last7d: renders7d,
        last30d: renders30d,
      },
      sessionStatuses: sessionStatuses.map((s) => ({ status: s.status, count: s._count._all })),
      jobStatuses: jobStatuses.map((j) => ({ status: j.status, count: j._count._all })),
      renderTimeMs: {
        avg: avgRenderTime._avg.renderTimeMs ?? null,
        max: avgRenderTime._max.renderTimeMs ?? null,
      },
      beta: betaMetrics,
      actor: { id: gate.userId, tier: gate.tier },
      generatedAt: now.toISOString(),
    })
  } catch (err) {
    console.error('[admin/stats] failed:', err)
    return NextResponse.json({ error: 'Statistics query failed' }, { status: 500 })
  }
}
