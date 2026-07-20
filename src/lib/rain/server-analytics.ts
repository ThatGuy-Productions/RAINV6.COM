/**
 * RAIN V6 — Analytics (activation, retention, funnel)
 *
 * This is additive to usage.ts, not a replacement. usage.ts answers
 * "how many" (aggregate counts). This file answers "how good" —
 * the numbers that actually move a valuation conversation:
 *   - Activation rate (signup -> first completed export)
 *   - Day 1 / 7 / 30 retention cohorts
 *   - Funnel drop-off (signup -> session -> render -> export)
 *   - Feature depth (distinct tabs touched per user)
 *
 * All reads are server-side only, admin-gated. No PII beyond what
 * Account already stores.
 */

import { db } from '@/lib/db'

export type EventType =
  | 'signup'
  | 'login'
  | 'session_created'
  | 'render_completed'
  | 'export_completed'
  | 'tab_viewed'
  | 'feedback_submitted'
  | 'referral_signup'

interface TrackEventInput {
  userId?: string | null
  anonId?: string | null
  type: EventType
  metadata?: Record<string, unknown>
}

/** Log one event. Call this from the actual code paths — see integration
 *  notes at the bottom of this file. Never throws; analytics must not be
 *  able to break the product. */
export async function trackEvent({ userId, anonId, type, metadata }: TrackEventInput): Promise<void> {
  try {
    await db.event.create({
      data: {
        userId: userId ?? null,
        anonId: anonId ?? null,
        type,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
    if (userId) {
      await db.account.update({
        where: { id: userId },
        data: { lastActiveAt: new Date() },
      })
    }
  } catch (err) {
    console.error('[analytics] trackEvent failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVATION
// ─────────────────────────────────────────────────────────────────────────

export interface ActivationStats {
  totalSignups: number
  activatedUsers: number
  /** activatedUsers / totalSignups, 0–1 */
  activationRate: number
  /** median hours between signup event and first export_completed event */
  medianHoursToActivation: number | null
}

/** "Activated" = at least one export_completed event within `windowDays`
 *  of signup. Default 7 days — long enough to allow for a real first
 *  session, short enough to mean something. */
export async function getActivationStats(windowDays = 7): Promise<ActivationStats> {
  const signups = await db.event.findMany({
    where: { type: 'signup' },
    select: { userId: true, createdAt: true },
  })

  const exports = await db.event.findMany({
    where: { type: 'export_completed' },
    select: { userId: true, createdAt: true },
  })

  const firstExportByUser = new Map<string, Date>()
  for (const e of exports) {
    if (!e.userId) continue
    const existing = firstExportByUser.get(e.userId)
    if (!existing || e.createdAt < existing) firstExportByUser.set(e.userId, e.createdAt)
  }

  let activated = 0
  const hoursToActivation: number[] = []

  for (const s of signups) {
    if (!s.userId) continue
    const firstExport = firstExportByUser.get(s.userId)
    if (!firstExport) continue
    const hours = (firstExport.getTime() - s.createdAt.getTime()) / 3_600_000
    if (hours >= 0 && hours <= windowDays * 24) {
      activated++
      hoursToActivation.push(hours)
    }
  }

  hoursToActivation.sort((a, b) => a - b)
  const median =
    hoursToActivation.length === 0
      ? null
      : hoursToActivation[Math.floor(hoursToActivation.length / 2)]

  return {
    totalSignups: signups.length,
    activatedUsers: activated,
    activationRate: signups.length === 0 ? 0 : activated / signups.length,
    medianHoursToActivation: median,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RETENTION
// ─────────────────────────────────────────────────────────────────────────

export interface RetentionCohort {
  day: number
  /** Users who signed up at least `day` days ago (eligible cohort size). */
  eligible: number
  /** Of those, users with ANY event on that exact day-offset. */
  retained: number
  rate: number
}

/** Classic day-N retention: of users who signed up >= N days ago, what
 *  fraction had any event exactly N days after signup (±12h window). */
export async function getRetentionCohorts(days: number[] = [1, 7, 30]): Promise<RetentionCohort[]> {
  const signups = await db.event.findMany({
    where: { type: 'signup' },
    select: { userId: true, createdAt: true },
  })
  const validSignups = signups.filter((s) => s.userId) as { userId: string; createdAt: Date }[]

  // Pull all events once, grouped by user, sorted — cheap at beta scale
  // (thousands, not millions, of rows). Revisit with a SQL window function
  // once volume justifies it.
  const allEvents = await db.event.findMany({
    where: { userId: { not: null } },
    select: { userId: true, createdAt: true },
  })
  const eventsByUser = new Map<string, Date[]>()
  for (const e of allEvents) {
    if (!e.userId) continue
    const arr = eventsByUser.get(e.userId) ?? []
    arr.push(e.createdAt)
    eventsByUser.set(e.userId, arr)
  }

  const now = Date.now()
  const results: RetentionCohort[] = []

  for (const day of days) {
    const windowMs = 12 * 3_600_000
    let eligible = 0
    let retained = 0

    for (const s of validSignups) {
      const eligibleAt = s.createdAt.getTime() + day * 86_400_000
      if (eligibleAt > now) continue // cohort hasn't reached day N yet
      eligible++

      const userEvents = eventsByUser.get(s.userId) ?? []
      const hit = userEvents.some((t) => Math.abs(t.getTime() - eligibleAt) <= windowMs)
      if (hit) retained++
    }

    results.push({
      day,
      eligible,
      retained,
      rate: eligible === 0 ? 0 : retained / eligible,
    })
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────
// FUNNEL
// ─────────────────────────────────────────────────────────────────────────

export interface FunnelStats {
  signups: number
  sessionsCreated: number
  rendersCompleted: number
  exportsCompleted: number
}

/** Distinct-user counts at each funnel step — for a drop-off chart. */
export async function getFunnelStats(): Promise<FunnelStats> {
  const countDistinctUsers = async (type: EventType) => {
    const rows = await db.event.findMany({
      where: { type, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    })
    return rows.length
  }

  const [signups, sessionsCreated, rendersCompleted, exportsCompleted] = await Promise.all([
    countDistinctUsers('signup'),
    countDistinctUsers('session_created'),
    countDistinctUsers('render_completed'),
    countDistinctUsers('export_completed'),
  ])

  return { signups, sessionsCreated, rendersCompleted, exportsCompleted }
}

// ─────────────────────────────────────────────────────────────────────────
// FEATURE DEPTH
// ─────────────────────────────────────────────────────────────────────────

/** Average number of distinct tabs (mastering, stems, spatial, etc.) a
 *  user has viewed. Depth signal — differentiates "used it once for LUFS"
 *  from "actually explored the product." */
export async function getAverageFeatureDepth(): Promise<number> {
  const tabViews = await db.event.findMany({
    where: { type: 'tab_viewed', userId: { not: null } },
    select: { userId: true, metadata: true },
  })

  const tabsByUser = new Map<string, Set<string>>()
  for (const v of tabViews) {
    if (!v.userId) continue
    let tab: string | undefined
    try {
      tab = v.metadata ? JSON.parse(v.metadata).tab : undefined
    } catch {
      tab = undefined
    }
    if (!tab) continue
    const set = tabsByUser.get(v.userId) ?? new Set<string>()
    set.add(tab)
    tabsByUser.set(v.userId, set)
  }

  if (tabsByUser.size === 0) return 0
  const total = [...tabsByUser.values()].reduce((sum, s) => sum + s.size, 0)
  return total / tabsByUser.size
}

// ─────────────────────────────────────────────────────────────────────────
// Wired call sites (beta release) — kept here for reference:
//   - signup            → src/app/api/rain/auth/register/route.ts
//   - login              → src/app/api/rain/auth/login/route.ts
//   - session_created    → src/app/api/rain/session/route.ts (new)
//   - render_completed   → src/app/api/rain/render/route.ts (new),
//                           called from MasteringTab.handleRender
//   - export_completed   → same route, called from MasteringTab.handleExport
//   - tab_viewed         → src/app/api/rain/events/route.ts, fired from
//                           StudioShell tab-switch handler
//   - feedback_submitted → src/app/api/rain/feedback/route.ts
// ─────────────────────────────────────────────────────────────────────────
