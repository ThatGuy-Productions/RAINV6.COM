/**
 * Payment readiness gate.
 *
 * Operator rule (2026-10-28):
 *   Leave payment details non-live until the public return/notify URL
 *   is confirmed. Secrets stay in environment variables only — never
 *   commit merchant keys to the repository.
 *
 * Chosen provider for the once-off R49 beta unlock: PayFast.
 * Amount: R49.00 ZAR (4 900 cents), once-off, beta duration only.
 */

import {
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
} from '@/lib/rain/beta-entitlement-policy'

export const PAYMENT_PROVIDER = 'payfast' as const
export const BETA_UNLOCK_ITEM_NAME = 'RAIN V6 Beta Unlock'
export const BETA_UNLOCK_ITEM_DESCRIPTION =
  'Once-off R49 beta unlock. Valid for the beta stage only. Beta holders receive a discounted commercial fee at product launch.'

export interface PaymentReadiness {
  /** True only when live charging is explicitly allowed. */
  liveEnabled: boolean
  /** Provider credentials present in env (not validated with PayFast yet). */
  credentialsPresent: boolean
  /** Public app URL is set and is not localhost. */
  publicUrlConfirmed: boolean
  /** Human-readable blockers. Empty when liveEnabled is true. */
  blockers: string[]
  provider: typeof PAYMENT_PROVIDER
  unlockAmountCents: number
  currency: typeof BETA_UNLOCK_CURRENCY
  /** Safe to show checkout UI that could charge money. */
  checkoutAvailable: boolean
  paymentStatus: 'not_live' | 'live_ready'
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '0.0.0.0' ||
      u.hostname.endsWith('.local')
    )
  } catch {
    return true
  }
}

/**
 * Evaluate whether live PayFast charging may run.
 * Defaults to non-live. All three conditions must hold:
 *   1. PAYFAST_MERCHANT_ID + PAYFAST_MERCHANT_KEY set
 *   2. NEXT_PUBLIC_APP_URL set to a non-localhost HTTPS origin
 *   3. PAYFAST_LIVE_ENABLED=true (explicit operator switch)
 */
export function getPaymentReadiness(): PaymentReadiness {
  const merchantId = (process.env.PAYFAST_MERCHANT_ID || '').trim()
  const merchantKey = (process.env.PAYFAST_MERCHANT_KEY || '').trim()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  const liveSwitch = process.env.PAYFAST_LIVE_ENABLED === 'true'
  // Legacy beta flag: RAIN_BETA_MODE=false alone is not enough for live pay.
  const credentialsPresent = Boolean(merchantId && merchantKey)
  const publicUrlConfirmed = Boolean(appUrl) && !isLocalUrl(appUrl)

  const blockers: string[] = []
  if (!credentialsPresent) {
    blockers.push('PayFast merchant credentials are not configured in environment variables.')
  }
  if (!publicUrlConfirmed) {
    blockers.push(
      'Public app URL is not confirmed. Set NEXT_PUBLIC_APP_URL to the live HTTPS origin before enabling payments.',
    )
  }
  if (!liveSwitch) {
    blockers.push(
      'Live charging is switched off. Set PAYFAST_LIVE_ENABLED=true only after return/notify URLs are confirmed with PayFast.',
    )
  }

  const liveEnabled = credentialsPresent && publicUrlConfirmed && liveSwitch

  return {
    liveEnabled,
    credentialsPresent,
    publicUrlConfirmed,
    blockers,
    provider: PAYMENT_PROVIDER,
    unlockAmountCents: BETA_UNLOCK_AMOUNT_CENTS,
    currency: BETA_UNLOCK_CURRENCY,
    checkoutAvailable: liveEnabled,
    paymentStatus: liveEnabled ? 'live_ready' : 'not_live',
  }
}

/** Preferred notify/return/cancel paths once the public origin is known. */
export function paymentCallbackPaths(appUrl: string): {
  notifyUrl: string
  returnUrl: string
  cancelUrl: string
} {
  const base = appUrl.replace(/\/$/, '')
  return {
    notifyUrl: `${base}/api/rain/payment/callback/payfast`,
    returnUrl: `${base}/beta/unlock/return`,
    cancelUrl: `${base}/beta/unlock/cancel`,
  }
}
