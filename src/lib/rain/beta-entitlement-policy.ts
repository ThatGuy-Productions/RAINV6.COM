/**
 * Canonical beta entitlement decision rules.
 *
 * This is a pure policy function, not the persistence/security boundary.
 * Callers must load counts and verified entitlements from the durable server
 * database. Never trust browser-supplied counters or paid flags.
 */
export const BETA_FREE_RENDER_ALLOWANCE = 2
export const BETA_MONTHLY_CREDIT_ALLOWANCE = 1_500
export const BETA_CREDITS_PER_RENDER = 25
export const BETA_MONTHLY_EXPORT_LIMIT = 30
export const BETA_UNLOCK_AMOUNT_CENTS = 4_900
export const BETA_UNLOCK_CURRENCY = 'ZAR' as const

export interface BetaEntitlementInput {
  /** Successfully completed free full-capability renders; each includes one export. */
  completedFreeRenders: number
  /** True only when a verified, active server-side R49 entitlement exists. */
  hasVerifiedR49Unlock: boolean
  /** Credits consumed by successfully completed paid-beta renders in this monthly period. */
  monthlyCreditsUsed: number
  /** Successfully finalized exports in this monthly period. */
  successfulExportsThisMonth: number
}

export interface BetaEntitlementDecision {
  canStartFullCapabilityRender: boolean
  canExport: boolean
  freeRendersRemaining: number
  monthlyCreditsRemaining: number | null
  paidRendersRemainingByCredits: number | null
  monthlyExportsRemaining: number | null
  reason: 'free-render' | 'payment-required' | 'paid-beta' | 'monthly-credit-limit' | 'monthly-export-limit'
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/**
 * Paid users may render while credits remain, but cannot export beyond 30
 * successful files in the accounting month even when credits remain.
 * The free path permits exactly two full-capability renders, each with one
 * included export, before requiring verified payment.
 */
export function evaluateBetaEntitlement(input: BetaEntitlementInput): BetaEntitlementDecision {
  const freeRenders = count(input.completedFreeRenders)
  const creditsUsed = count(input.monthlyCreditsUsed)
  const exports = count(input.successfulExportsThisMonth)
  const freeRendersRemaining = Math.max(0, BETA_FREE_RENDER_ALLOWANCE - freeRenders)

  if (!input.hasVerifiedR49Unlock) {
    const hasFreeRender = freeRenders < BETA_FREE_RENDER_ALLOWANCE
    return {
      canStartFullCapabilityRender: hasFreeRender,
      canExport: hasFreeRender,
      freeRendersRemaining,
      monthlyCreditsRemaining: null,
      paidRendersRemainingByCredits: null,
      monthlyExportsRemaining: null,
      reason: hasFreeRender ? 'free-render' : 'payment-required',
    }
  }

  const monthlyCreditsRemaining = Math.max(0, BETA_MONTHLY_CREDIT_ALLOWANCE - creditsUsed)
  const paidRendersRemainingByCredits = Math.floor(monthlyCreditsRemaining / BETA_CREDITS_PER_RENDER)
  const monthlyExportsRemaining = Math.max(0, BETA_MONTHLY_EXPORT_LIMIT - exports)
  const canExport = monthlyExportsRemaining > 0
  // Do not let a user spend credits on a render that cannot be exported.
  const canRender = canExport && monthlyCreditsRemaining >= BETA_CREDITS_PER_RENDER
  const reason = !canExport ? 'monthly-export-limit' : monthlyCreditsRemaining < BETA_CREDITS_PER_RENDER ? 'monthly-credit-limit' : 'paid-beta'

  return {
    canStartFullCapabilityRender: canRender,
    canExport,
    freeRendersRemaining,
    monthlyCreditsRemaining,
    paidRendersRemainingByCredits,
    monthlyExportsRemaining,
    reason,
  }
}
