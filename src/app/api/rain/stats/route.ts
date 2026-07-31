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
    // Query activity for the last 14 days — counts of session_created +
    // render_completed + export_completed events per day. This drives the
    // sparkline in the Beta Velocity section. Uses createdAt gte to filter,
    // then groups in JS (Prisma's groupBy with date truncation isn't
    // supported on SQLite without raw SQL).
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13) // inclusive of today
    fourteenDaysAgo.setHours(0, 0, 0, 0)

    const [dbSignups, totalRenders, totalSessions, totalExports, totalFeedback, recentEvents] =
      await Promise.all([
        db.account.count(),
        db.render.count(),
        db.session.count(),
        db.event.count({ where: { type: 'export_completed' } }),
        db.feedback.count(),
        db.event.findMany({
          where: {
            createdAt: { gte: fourteenDaysAgo },
            type: { in: ['session_created', 'render_completed', 'export_completed'] },
          },
          select: { type: true, createdAt: true },
        }),
      ])

    // Build a 14-day activity series. Each day gets the count of events.
    // The sparkline on the landing shows total activity per day.
    const activitySeries: { date: string; count: number }[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today)
      day.setDate(day.getDate() - i)
      const dayEnd = new Date(day)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const count = recentEvents.filter(
        (e) => e.createdAt >= day && e.createdAt < dayEnd,
      ).length
      activitySeries.push({
        date: day.toISOString().slice(0, 10), // YYYY-MM-DD
        count,
      })
    }

    return NextResponse.json(
      {
        totalSignups: dbSignups,
        totalRenders,
        totalSessions,
        totalExports,
        totalFeedback,
        // Matches the CHANGELOG array length in WhatsNewPanel.tsx.
        // When new entries are added, bump this number.
        changelogEntries: 7,
        // 14-day activity series for the sparkline. Each entry is one day.
        activitySeries,
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
      activitySeries: [],
      generatedAt: new Date().toISOString(),
      error: 'stats unavailable',
    })
  }
}
