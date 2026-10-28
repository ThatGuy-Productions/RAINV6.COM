/**
 * Unified payment mode helper.
 * Live mode requires both legacy RAIN_BETA_MODE=false AND payment readiness.
 */

import { getPaymentReadiness } from '@/lib/rain/payment-readiness'

export function isNonLivePaymentMode(): boolean {
  const readiness = getPaymentReadiness()
  if (!readiness.liveEnabled) return true
  // Even with readiness, keep RAIN_BETA_MODE as an extra kill switch.
  if (process.env.RAIN_BETA_MODE !== 'false') return true
  return false
}

export function isLivePaymentMode(): boolean {
  return !isNonLivePaymentMode()
}
