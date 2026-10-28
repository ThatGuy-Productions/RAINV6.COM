/**
 * Server-side beta entitlement loader.
 *
 * Loads durable counters and a verified R49 unlock, then applies the pure
 * policy in beta-entitlement-policy.ts. Never trusts browser-supplied
 * counters or paid flags.
 *
 * Free path (no verified unlock):
 *   - Two full-capability renders, each including one export.
 *   - Counted from completed UsageRecord use_credit rows when present;
 *     otherwise falls back to export_completed Event rows for the same
 *     identity (transitional compatibility with the previous UX gate).
 *
 * Paid path (verified active beta_r49_unlock entitlement):
 *   - 1 500 credits / month at 25 credits per completed render.
 *   - Hard cap of 30 successful exports / month.
 *   - Credits and exports prefer UsageRecord; Events are a fallback only.
 *
 * Checkout remains disabled until a real provider + webhook path exists.
 */

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
  /** Always false until provider callback + durable payment ledger land. */
  checkoutConfigured: false
  checkoutAvailable: false
  paymentStatus: 'not_live'
  /** Whether UsageRecord rows were present for this identity. */
  usageLedgerPresent: boolean
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

function identityWhere(userId: string | null, anonId: string | null) {
  if (userId && anonId) {
    return { OR: [{ userId }, { userId: null, anonId }] as const }
  }
  if (userId) return { userId }
  if (anonId) return { userId: null, anonId }
  return null
}

async function countUsageRecords(
  userId: string | null,
  anonId: string | null,
  kind: 'use_credit' | 'export',
  status: 'completed',
  since?: Date,
): Promise<number> {
  const base = identityWhere(userId, anonId)
  if (!base) return 0
  return db.usageRecord.count({
    where: {
      ...base,
      kind,
      status,
      ...(since ? { completedAt: { gte: since } } : {}),
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
 * Safe to call from API routes. Returns a snapshot suitable for JSON.
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
    freeUseCredits,
    freeExportsLegacy,
    unlocked,
    monthlyUseCredits,
    monthlyExportsLedger,
    monthlyExportsLegacy,
  ] = await Promise.all([
    countUsageRecords(userId, anonId, 'use_credit', 'completed'),
    countEvents(userId, anonId, 'export_completed'),
    hasActiveR49Unlock(userId),
    countUsageRecords(userId, anonId, 'use_credit', 'completed', monthStart),
    countUsageRecords(userId, anonId, 'export', 'completed', monthStart),
    countEvents(userId, anonId, 'export_completed', monthStart),
  ])

  // Prefer the durable usage ledger when any rows exist for this identity.
  // Otherwise fall back to the previous export_completed Event count so
  // existing beta users are not reset by the policy wiring.
  const usageLedgerPresent = freeUseCredits > 0 || monthlyExportsLedger > 0
  const completedFreeRenders = usageLedgerPresent
    ? freeUseCredits
    : Math.min(BETA_FREE_RENDER_ALLOWANCE, freeExportsLegacy)

  const monthlyCreditsUsed = usageLedgerPresent
    ? monthlyUseCredits * BETA_CREDITS_PER_RENDER
    : 0

  const successfulExportsThisMonth = usageLedgerPresent
    ? monthlyExportsLedger
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
    completedFreeRenders,
    hasVerifiedR49Unlock: unlocked,
    monthlyCreditsUsed,
    successfulExportsThisMonth,
    unlockAmountCents: BETA_UNLOCK_AMOUNT_CENTS,
    currency: BETA_UNLOCK_CURRENCY,
    historicalDataComplete: false,
    checkoutConfigured: false,
    checkoutAvailable: false,
    paymentStatus: 'not_live',
    usageLedgerPresent,
  }
}

export {
  BETA_CREDITS_PER_RENDER,
  BETA_FREE_RENDER_ALLOWANCE,
  BETA_MONTHLY_CREDIT_ALLOWANCE,
  BETA_MONTHLY_EXPORT_LIMIT,
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
}
