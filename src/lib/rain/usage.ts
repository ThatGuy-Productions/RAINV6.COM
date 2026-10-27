/**
 * RAIN V6 — Usage Tracking (analytics telemetry)
 *
 * Lightweight, anonymous usage counter. Tracks:
 *   - Total registered users (DB count)
 *   - Active sessions (last 24h)
 *   - Total renders completed
 *   - Export format distribution
 *
 * All counters are server-side only. No PII is collected — email addresses
 * are never transmitted to third parties. This data is for internal product
 * metrics and investor valuation only.
 *
 * Exposed via GET /api/rain/admin/stats (admin-only) and incrementally
 * updated by the app's existing analytics hooks.
 */

import { db } from '@/lib/db'

export interface UsageStats {
  /** Total number of registered accounts. */
  totalUsers: number
  /** Accounts that logged in within the last 24 hours. */
  activeUsers24h: number
  /** Total renders completed across all users. */
  totalRenders: number
  /** Total exports across all formats. */
  totalExports: number
  /** Most recent export timestamp (ISO). */
  lastExportAt: string | null
  /** Render count in the last 30 days. */
  renders30d: number
  /** Export count in the last 30 days. */
  exports30d: number
  /** Count of feedback submissions. */
  feedbackCount: number
  /** Persisted AIE vector computation events. */
  aieComputations: number
  /** Persisted AIE signed-vector export events. */
  aieExports: number
  /** Estimated visible-studio hours from rate-limited 60-second heartbeats. */
  visibleStudioHours: number
  /** Whether the database contains any usable event history. */
  evidenceStatus: 'recorded' | 'no-recorded-events' | 'unavailable'
}

export async function getUsageStats(): Promise<UsageStats> {
  const now = new Date()
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  try {
    const [
      totalUsers, totalRenders, totalExports, renders30d, exports30d,
      feedbackCount, aieComputations, aieExports, heartbeatRows, eventRows,
      lastExport,
    ] = await Promise.all([
      db.account.count(),
      db.event.count({ where: { type: 'render_completed' } }),
      db.event.count({ where: { type: 'export_completed' } }),
      db.event.count({ where: { type: 'render_completed', createdAt: { gte: past30d } } }),
      db.event.count({ where: { type: 'export_completed', createdAt: { gte: past30d } } }),
      db.feedback.count(),
      db.event.count({ where: { type: 'aie_vector_computed' } }),
      db.event.count({ where: { type: 'aie_vector_exported' } }),
      db.event.findMany({ where: { type: 'studio_heartbeat' }, select: { metadata: true } }),
      db.event.count(),
      db.event.findFirst({
        where: { type: 'export_completed' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    // Active users: accounts with auth tokens created in the last 24h.
    const activeUsers24h = await db.authToken.count({ where: { createdAt: { gte: past24h } } })
    // Heartbeats are clamped server-side to 60 seconds. This is an estimate
    // of time with the studio tab visible, not proof of continuous human work.
    const activeSeconds = heartbeatRows.reduce((sum, row) => {
      try {
        const metadata = row.metadata ? JSON.parse(row.metadata) as { activeSeconds?: unknown } : {}
        const seconds = typeof metadata.activeSeconds === 'number' && Number.isFinite(metadata.activeSeconds)
          ? Math.max(0, Math.min(60, metadata.activeSeconds))
          : 0
        return sum + seconds
      } catch {
        return sum
      }
    }, 0)

    return {
      totalUsers,
      activeUsers24h,
      totalRenders,
      totalExports,
      lastExportAt: lastExport?.createdAt?.toISOString() ?? null,
      renders30d,
      exports30d,
      feedbackCount,
      aieComputations,
      aieExports,
      visibleStudioHours: Math.round((activeSeconds / 3600) * 100) / 100,
      evidenceStatus: eventRows > 0 ? 'recorded' : 'no-recorded-events',
    }
  } catch (err) {
    console.error('[usage] getUsageStats failed:', err)
    return {
      totalUsers: 0,
      activeUsers24h: 0,
      totalRenders: 0,
      totalExports: 0,
      lastExportAt: null,
      renders30d: 0,
      exports30d: 0,
      feedbackCount: 0,
      aieComputations: 0,
      aieExports: 0,
      visibleStudioHours: 0,
      evidenceStatus: 'unavailable',
    }
  }
}

/** Increment the render counter (called after each successful render). */
export async function trackRender(userId?: string, format?: string): Promise<void> {
  try {
    // We use the existing Prisma Render model — the counter is implicit in db.render.count()
    // This function is a placeholder for additional telemetry (e.g., sending to an external
    // analytics service). For now, the existing render row creation in audio-engine.ts
    // already serves as the counter.
  } catch (err) {
    console.error('[usage] trackRender failed:', err)
  }
}

/** Increment export counter. */
export async function trackExport(userId?: string, format?: string): Promise<void> {
  // Implicit: existing Render.create in analytics.ts already tracks exports.
  // This hook exists for future expansion (e.g., Prometheus counters).
}
