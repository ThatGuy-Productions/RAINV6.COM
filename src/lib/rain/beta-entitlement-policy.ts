/**
 * Canonical beta entitlement decision rules.
 *
 * This is a pure policy function, not the persistence/security boundary.
 * Callers must load counts and verified entitlements from the durable server
 * database. Never trust browser-supplied counters or paid flags.
 *
 * Operator decisions (2026-10-28):
 * - R49.00 ZAR is a **once-off** unlock for the duration of the beta stage.
 * - The unlock ends when the commercial product launches (not a recurring fee).
 * - Beta unlock holders will receive a **discounted commercial fee** at launch;
 *   the discount amount is decided at commercial pricing time and is not
 *   applied by this module.
 * - Paid-beta monthly credits (1 500) and the 30-export hard cap apply only
 *   while the beta stage is active and the once-off unlock is verified.
 */
export const BETA_FREE_RENDER_ALLOWANCE = 2
export const BETA_MONTHLY_CREDIT_ALLOWANCE = 1_500
export const BETA_CREDITS_PER_RENDER = 25
export const BETA_MONTHLY_EXPORT_LIMIT = 30
/** Once-off beta unlock amount in minor units (R49.00 ZAR = 4 900 cents). */
export const BETA_UNLOCK_AMOUNT_CENTS = 4_900
export const BETA_UNLOCK_CURRENCY = 'ZAR' as const
/** Entitlement kind written after verified once-off payment. */
export const BETA_UNLOCK_ENTITLEMENT_KIND = 'beta_r49_unlock' as const
/**
 * Commercial discount for verified beta unlock holders is a launch-time
 * commercial rule, not a runtime constant here. Placeholder for docs/UI only.
 */
export const BETA_HOLDER_COMMERCIAL_DISCOUNT_NOTE =
  'Verified beta unlock holders receive a discounted commercial fee at product launch.' as const

export interface BetaEntitlementInput {
  /** Successfully completed free full-capability renders; each includes one export. */
  completedFreeRenders: number
  /**
   * True only when a verified, active server-side once-off R49 beta unlock exists.
   * Must be revoked or naturally expire at commercial launch.
   */
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
 * included export, before requiring the once-off verified R49 unlock.
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
  const reason = !canExport
    ? 'monthly-export-limit'
    : monthlyCreditsRemaining < BETA_CREDITS_PER_RENDER
      ? 'monthly-credit-limit'
      : 'paid-beta'

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
