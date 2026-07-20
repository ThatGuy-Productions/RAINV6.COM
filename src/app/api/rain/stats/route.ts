import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/rain/stats
 *
 * PUBLIC endpoint — returns safe-to-share aggregate beta metrics for the
 * landing page's "Beta Velocity" section. No authentication required.
 *
 * Returns ONLY aggregate counts — no user-identifying data, no emails, no
 * per-user breakdowns. This is the public-facing counterpart to the
 * enterprise-gated /api/rain/admin/stats route.
 *
 * Counts:
 *   - totalSignups: distinct accounts (free + enterprise)
 *   - totalRenders: Render rows (authenticated exports only — anonymous
 *     renders don't create Render rows, they fire Events)
 *   - totalSessions: Session rows (authenticated sessions only)
 *   - totalExports: export_completed Events (includes anonymous)
 *   - totalFeedback: Feedback rows
 *   - changelogEntries: hardcoded count of WhatsNewPanel entries (matches
 *     the CHANGELOG array length so the landing stays in sync)
 *
 * All counts are real DB queries. On a fresh database they'll read 0 —
 * that's honest, not a bug. The landing section handles the 0-state
 * gracefully ("Be the first to master a track").
 */
export async function GET() {
  try {
    const [totalSignups, totalRenders, totalSessions, totalExports, totalFeedback] =
      await Promise.all([
        db.account.count(),
        db.render.count(),
        db.session.count(),
        db.event.count({ where: { type: 'export_completed' } }),
        db.feedback.count(),
      ])

    return NextResponse.json(
      {
        totalSignups,
        totalRenders,
        totalSessions,
        totalExports,
        totalFeedback,
        // Matches the CHANGELOG array length in WhatsNewPanel.tsx.
        // When new entries are added, bump this number.
        changelogEntries: 7,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    )
  } catch (err) {
    console.error('[api/rain/stats] failed:', err)
    // Return zeros rather than a 500 — the landing page should never break
    // because the stats DB is unavailable.
    return NextResponse.json({
      totalSignups: 0,
      totalRenders: 0,
      totalSessions: 0,
      totalExports: 0,
      totalFeedback: 0,
      changelogEntries: 7,
      generatedAt: new Date().toISOString(),
      error: 'stats unavailable',
    })
  }
}
