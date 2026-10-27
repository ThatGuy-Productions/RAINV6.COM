/**
 * Central beta entitlement policy.
 *
 * This module is deliberately pure: API routes and UI should call the same
 * decision function rather than reimplementing limits in separate places.
 * It does not read browser storage and does not prove that a browser-local
 * export really occurred. Durable reservation/completion records and provider
 * verification must be implemented by the calling server workflow.
 */
export const BETA_FREE_USE_CREDITS = 2
export const BETA_MONTHLY_EXPORT_LIMIT = 30
export const BETA_UNLOCK_AMOUNT_CENTS = 4_900
export const BETA_UNLOCK_CURRENCY = 'ZAR' as const

export interface BetaEntitlementInput {
  /** Successfully completed free-capability uses, not exports unless the product defines them as equivalent. */
  completedFreeUseCredits: number
  /** True only when a verified, active server-side entitlement exists. */
  hasVerifiedR49Unlock: boolean
  /** Successful, finalized exports in the selected monthly accounting period. */
  successfulExportsThisMonth: number
}

export interface BetaEntitlementDecision {
  canStartFullCapabilityUse: boolean
  canExport: boolean
  freeUseCreditsRemaining: number
  monthlyExportsRemaining: number | null
  reason: 'free-use-credit' | 'payment-required' | 'paid-beta' | 'monthly-export-limit'
}

function nonNegativeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/**
 * Resolve beta access. Paid beta users retain full processing capability even
 * when they reach the monthly export cap; only further exports are blocked.
 * A client must never set hasVerifiedR49Unlock itself.
 */
export function evaluateBetaEntitlement(input: BetaEntitlementInput): BetaEntitlementDecision {
  const uses = nonNegativeCount(input.completedFreeUseCredits)
  const exports = nonNegativeCount(input.successfulExportsThisMonth)
  const freeUseCreditsRemaining = Math.max(0, BETA_FREE_USE_CREDITS - uses)

  if (input.hasVerifiedR49Unlock) {
    const monthlyExportsRemaining = Math.max(0, BETA_MONTHLY_EXPORT_LIMIT - exports)
    return {
      canStartFullCapabilityUse: true,
      canExport: monthlyExportsRemaining > 0,
      freeUseCreditsRemaining,
      monthlyExportsRemaining,
      reason: monthlyExportsRemaining > 0 ? 'paid-beta' : 'monthly-export-limit',
    }
  }

  const hasFreeCredit = uses < BETA_FREE_USE_CREDITS
  return {
    canStartFullCapabilityUse: hasFreeCredit,
    canExport: hasFreeCredit,
    freeUseCreditsRemaining,
    monthlyExportsRemaining: null,
    reason: hasFreeCredit ? 'free-use-credit' : 'payment-required',
  }
}
