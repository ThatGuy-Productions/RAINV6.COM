/**
 * Server-side beta entitlement loader and usage ledger.
 *
 * Free path: two full-capability renders (each includes one export).
 * Paid path (verified R49 unlock): 1 500 credits/month at 25/render +
 * hard cap of 30 successful exports/month.
 *
 * Checkout remains disabled until a real provider + webhook exist.
 */

import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import {
  BETA_CREDITS_PER_RENDER,
  BETA_FREE_RENDER_ALLOWANCE,
  BETA_MONTHLY_CREDIT_ALLOWANCE,
  BETA_MONTHLY_EXPORT_LIMIT,
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
  evaluateBetaEntitlement,
  type BetaEntitlementDecision,
} from '@/lib/rain/beta-entitlement-policy'

export interface BetaEntitlementContext {
  userId: string | null
  anonId: string | null
}

export interface BetaEntitlementSnapshot extends BetaEntitlementDecision {
  policy: 'beta-two-free-renders-then-r49-unlock'
  completedFreeRenders: number
  hasVerifiedR49Unlock: boolean
  monthlyCreditsUsed: number
  successfulExportsThisMonth: number
  unlockAmountCents: number
  currency: typeof BETA_UNLOCK_CURRENCY
  historicalDataComplete: false
  checkoutConfigured: false
  checkoutAvailable: false
  paymentStatus: 'not_live'
  usageLedgerPresent: boolean
}

export interface RecordUsageInput {
  userId: string | null
  anonId: string | null
  kind: 'use_credit' | 'export'
  operationId?: string | null
  format?: string | null
  metadata?: Record<string, unknown>
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

function identityWhere(userId: string | null, anonId: string | null) {
  if (userId && anonId) {
    return { OR: [{ userId }, { userId: null, anonId }] }
  }
  if (userId) return { userId }
  if (anonId) return { userId: null, anonId }
  return null
}

async function countUsageRecords(
  userId: string | null,
  anonId: string | null,
  kind: 'use_credit' | 'export',
  status: 'completed' | 'reserved',
  since?: Date,
): Promise<number> {
  const base = identityWhere(userId, anonId)
  if (!base) return 0
  return db.usageRecord.count({
    where: {
      ...base,
      kind,
      status,
      ...(since
        ? status === 'completed'
          ? { completedAt: { gte: since } }
          : { createdAt: { gte: since } }
        : {}),
    },
  })
}

async function countEvents(
  userId: string | null,
  anonId: string | null,
  type: 'render_completed' | 'export_completed',
  since?: Date,
): Promise<number> {
  const base = identityWhere(userId, anonId)
  if (!base) return 0
  return db.event.count({
    where: {
      ...base,
      type,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
  })
}

async function hasActiveR49Unlock(userId: string | null): Promise<boolean> {
  if (!userId) return false
  const now = new Date()
  const row = await db.entitlement.findFirst({
    where: {
      userId,
      kind: 'beta_r49_unlock',
      status: 'active',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { id: true },
  })
  return Boolean(row)
}

/**
 * Load durable counters and evaluate the canonical beta policy.
 * Reserved rows count against allowance so concurrent tabs cannot overspend.
 */
export async function loadBetaEntitlement(
  ctx: BetaEntitlementContext,
): Promise<BetaEntitlementSnapshot> {
  const userId = ctx.userId
  const anonId = ctx.anonId

  if (!userId && !anonId) {
    throw new Error('An anonymous beta ID or signed-in account is required.')
  }

  const monthStart = startOfUtcMonth()

  const [
    freeUseCompleted,
    freeUseReserved,
    freeExportsLegacy,
    unlocked,
    monthlyUseCompleted,
    monthlyUseReserved,
    monthlyExportsCompleted,
    monthlyExportsReserved,
    monthlyExportsLegacy,
  ] = await Promise.all([
    countUsageRecords(userId, anonId, 'use_credit', 'completed'),
    countUsageRecords(userId, anonId, 'use_credit', 'reserved'),
    countEvents(userId, anonId, 'export_completed'),
    hasActiveR49Unlock(userId),
    countUsageRecords(userId, anonId, 'use_credit', 'completed', monthStart),
    countUsageRecords(userId, anonId, 'use_credit', 'reserved', monthStart),
    countUsageRecords(userId, anonId, 'export', 'completed', monthStart),
    countUsageRecords(userId, anonId, 'export', 'reserved', monthStart),
    countEvents(userId, anonId, 'export_completed', monthStart),
  ])

  const usageLedgerPresent =
    freeUseCompleted + freeUseReserved + monthlyExportsCompleted + monthlyExportsReserved > 0

  // Reserved rows block concurrent double-spend until completed or released.
  const completedFreeRenders = usageLedgerPresent
    ? freeUseCompleted + freeUseReserved
    : Math.min(BETA_FREE_RENDER_ALLOWANCE, freeExportsLegacy)

  const monthlyCreditsUsed = usageLedgerPresent
    ? (monthlyUseCompleted + monthlyUseReserved) * BETA_CREDITS_PER_RENDER
    : 0

  const successfulExportsThisMonth = usageLedgerPresent
    ? monthlyExportsCompleted + monthlyExportsReserved
    : monthlyExportsLegacy

  const decision = evaluateBetaEntitlement({
    completedFreeRenders,
    hasVerifiedR49Unlock: unlocked,
    monthlyCreditsUsed,
    successfulExportsThisMonth,
  })

  return {
    ...decision,
    policy: 'beta-two-free-renders-then-r49-unlock',
    completedFreeRenders: freeUseCompleted,
    hasVerifiedR49Unlock: unlocked,
    monthlyCreditsUsed: monthlyUseCompleted * BETA_CREDITS_PER_RENDER,
    successfulExportsThisMonth: usageLedgerPresent ? monthlyExportsCompleted : monthlyExportsLegacy,
    unlockAmountCents: BETA_UNLOCK_AMOUNT_CENTS,
    currency: BETA_UNLOCK_CURRENCY,
    historicalDataComplete: false,
    checkoutConfigured: false,
    checkoutAvailable: false,
    paymentStatus: 'not_live',
    usageLedgerPresent,
  }
}

function buildIdempotencyKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 64)
}

function stableKey(input: RecordUsageInput, status: string): string {
  if (input.operationId && input.operationId.length >= 8) {
    return buildIdempotencyKey([
      status,
      input.kind,
      input.userId ?? 'anon',
      input.anonId ?? '',
      input.operationId,
      input.format ?? '',
    ])
  }
  return buildIdempotencyKey([
    status,
    input.kind,
    input.userId ?? 'anon',
    input.anonId ?? '',
    randomBytes(16).toString('hex'),
  ])
}

export type ReserveResult =
  | { ok: true; reservationId: string; entitlement: BetaEntitlementSnapshot }
  | { ok: false; reason: string; entitlement: BetaEntitlementSnapshot; status: 402 | 503 }

/** Reserve a credit or export slot after a live entitlement check. */
export async function reserveUsage(input: RecordUsageInput): Promise<ReserveResult> {
  if (!input.userId && !input.anonId) {
    throw new Error('An anonymous beta ID or signed-in account is required.')
  }

  let entitlement: BetaEntitlementSnapshot
  try {
    entitlement = await loadBetaEntitlement({
      userId: input.userId,
      anonId: input.anonId,
    })
  } catch {
    return {
      ok: false,
      reason: 'entitlement-unavailable',
      entitlement: await loadBetaEntitlement({
        userId: input.userId,
        anonId: input.anonId,
      }).catch(() => ({
        canStartFullCapabilityRender: false,
        canExport: false,
        freeRendersRemaining: 0,
        monthlyCreditsRemaining: null,
        paidRendersRemainingByCredits: null,
        monthlyExportsRemaining: null,
        reason: 'payment-required' as const,
        policy: 'beta-two-free-renders-then-r49-unlock' as const,
        completedFreeRenders: 0,
        hasVerifiedR49Unlock: false,
        monthlyCreditsUsed: 0,
        successfulExportsThisMonth: 0,
        unlockAmountCents: BETA_UNLOCK_AMOUNT_CENTS,
        currency: BETA_UNLOCK_CURRENCY,
        historicalDataComplete: false as const,
        checkoutConfigured: false as const,
        checkoutAvailable: false as const,
        paymentStatus: 'not_live' as const,
        usageLedgerPresent: false,
      })),
      status: 503,
    }
  }

  if (input.kind === 'use_credit' && !entitlement.canStartFullCapabilityRender) {
    return { ok: false, reason: entitlement.reason, entitlement, status: 402 }
  }
  if (input.kind === 'export' && !entitlement.canExport) {
    return { ok: false, reason: entitlement.reason, entitlement, status: 402 }
  }

  const idempotencyKey = stableKey(input, 'reserved')
  try {
    const row = await db.usageRecord.create({
      data: {
        userId: input.userId,
        anonId: input.anonId,
        kind: input.kind,
        status: 'reserved',
        idempotencyKey,
        operationId: input.operationId ?? null,
        format: input.format ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
      select: { id: true },
    })
    return { ok: true, reservationId: row.id, entitlement }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Duplicate reservation for same operationId → treat as success (idempotent).
    if (message.includes('Unique constraint') || message.includes('idempotencyKey')) {
      const existing = await db.usageRecord.findFirst({
        where: { idempotencyKey },
        select: { id: true, status: true },
      })
      if (existing) {
        return { ok: true, reservationId: existing.id, entitlement }
      }
    }
    console.error('[beta-entitlement] reserve failed:', err)
    return { ok: false, reason: 'reserve-failed', entitlement, status: 503 }
  }
}

/** Mark a reserved row completed, or create a completed row if none exists. */
export async function completeUsage(input: RecordUsageInput & { reservationId?: string | null }): Promise<{ created: boolean; id: string | null }> {
  if (!input.userId && !input.anonId) return { created: false, id: null }
  const now = new Date()

  if (input.reservationId) {
    try {
      const updated = await db.usageRecord.updateMany({
        where: {
          id: input.reservationId,
          status: 'reserved',
          ...(input.userId ? { userId: input.userId } : { anonId: input.anonId }),
        },
        data: {
          status: 'completed',
          completedAt: now,
          format: input.format ?? undefined,
          metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        },
      })
      if (updated.count > 0) return { created: true, id: input.reservationId }
    } catch (err) {
      console.error('[beta-entitlement] complete reservation failed:', err)
    }
  }

  // Fallback: direct completed write (idempotent on operationId).
  const idempotencyKey = stableKey(input, 'completed')
  try {
    const row = await db.usageRecord.create({
      data: {
        userId: input.userId,
        anonId: input.anonId,
        kind: input.kind,
        status: 'completed',
        idempotencyKey,
        operationId: input.operationId ?? null,
        format: input.format ?? null,
        completedAt: now,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
      select: { id: true },
    })
    return { created: true, id: row.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Unique constraint') || message.includes('idempotencyKey')) {
      return { created: false, id: null }
    }
    throw err
  }
}

/** Release a reservation so failed client work does not consume allowance. */
export async function releaseUsage(input: {
  userId: string | null
  anonId: string | null
  reservationId: string
}): Promise<boolean> {
  if (!input.reservationId) return false
  try {
    const result = await db.usageRecord.updateMany({
      where: {
        id: input.reservationId,
        status: 'reserved',
        ...(input.userId ? { userId: input.userId } : { anonId: input.anonId }),
      },
      data: { status: 'released' },
    })
    return result.count > 0
  } catch (err) {
    console.error('[beta-entitlement] release failed:', err)
    return false
  }
}

/** @deprecated Prefer completeUsage */
export async function recordCompletedUsage(input: RecordUsageInput): Promise<{ created: boolean; id: string | null }> {
  return completeUsage(input)
}

export {
  BETA_CREDITS_PER_RENDER,
  BETA_FREE_RENDER_ALLOWANCE,
  BETA_MONTHLY_CREDIT_ALLOWANCE,
  BETA_MONTHLY_EXPORT_LIMIT,
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
}
