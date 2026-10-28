import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import {
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
  BETA_UNLOCK_ENTITLEMENT_KIND,
} from '@/lib/rain/beta-entitlement-policy'
import { loadBetaEntitlement } from '@/lib/rain/beta-entitlement'
import {
  BETA_UNLOCK_ITEM_DESCRIPTION,
  BETA_UNLOCK_ITEM_NAME,
  getPaymentReadiness,
  paymentCallbackPaths,
} from '@/lib/rain/payment-readiness'
import { withCsrf } from '@/lib/rain/csrf'
import { checkRateLimit } from '@/lib/rain/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/rain/payment/unlock
 *
 * Start the once-off R49 beta unlock for a signed-in account.
 * Amount is fixed server-side. Live PayFast redirect is only returned when
 * payment readiness allows it; otherwise checkout stays unavailable.
 */
export const POST = withCsrf(async (req: NextRequest) => {
  const rate = await checkRateLimit(req, 'payment:unlock', 5)
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.unavailable ? 'Rate limit unavailable' : 'Too many unlock attempts.' },
      { status: rate.unavailable ? 503 : 429 },
    )
  }

  const user = await getSessionUser(req).catch(() => null)
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in is required before purchasing the beta unlock.' },
      { status: 401 },
    )
  }

  const readiness = getPaymentReadiness()
  const entitlement = await loadBetaEntitlement({ userId: user.id, anonId: null })

  if (entitlement.hasVerifiedR49Unlock) {
    return NextResponse.json({
      ok: true,
      alreadyUnlocked: true,
      entitlementKind: BETA_UNLOCK_ENTITLEMENT_KIND,
      checkoutAvailable: false,
      paymentStatus: readiness.paymentStatus,
      message: 'This account already has an active beta unlock.',
    })
  }

  if (entitlement.reason !== 'payment-required' && entitlement.freeRendersRemaining > 0) {
    return NextResponse.json({
      ok: false,
      error: 'Free allowance still remains. Unlock is only required after two free renders.',
      entitlement,
      checkoutAvailable: readiness.checkoutAvailable,
    }, { status: 400 })
  }

  // Always create a durable pending payment row so ops can see intent.
  const idempotencyKey = `unlock:${user.id}:${randomBytes(12).toString('hex')}`
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      provider: 'payfast',
      idempotencyKey,
      amountCents: BETA_UNLOCK_AMOUNT_CENTS,
      currency: BETA_UNLOCK_CURRENCY,
      purpose: 'beta_unlock',
      status: 'pending',
      metadata: JSON.stringify({
        item_name: BETA_UNLOCK_ITEM_NAME,
        onceOff: true,
        betaStageOnly: true,
      }),
    },
    select: { id: true, idempotencyKey: true, amountCents: true, status: true },
  })

  if (!readiness.liveEnabled) {
    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      mPaymentId: payment.idempotencyKey,
      amountCents: BETA_UNLOCK_AMOUNT_CENTS,
      currency: BETA_UNLOCK_CURRENCY,
      itemName: BETA_UNLOCK_ITEM_NAME,
      itemDescription: BETA_UNLOCK_ITEM_DESCRIPTION,
      checkoutAvailable: false,
      paymentStatus: 'not_live',
      blockers: readiness.blockers,
      redirectUrl: null,
      message:
        'Unlock payment recorded as pending. Live PayFast checkout is disabled until the public URL is confirmed and PAYFAST_LIVE_ENABLED=true.',
    })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const paths = paymentCallbackPaths(appUrl)
  // Redirect URL construction is delegated to payment-isolation when fully wired;
  // for now return structured fields the client can POST to PayFast only when live.
  return NextResponse.json({
    ok: true,
    paymentId: payment.id,
    mPaymentId: payment.idempotencyKey,
    amountCents: BETA_UNLOCK_AMOUNT_CENTS,
    currency: BETA_UNLOCK_CURRENCY,
    itemName: BETA_UNLOCK_ITEM_NAME,
    itemDescription: BETA_UNLOCK_ITEM_DESCRIPTION,
    checkoutAvailable: true,
    paymentStatus: 'live_ready',
    notifyUrl: paths.notifyUrl,
    returnUrl: paths.returnUrl,
    cancelUrl: paths.cancelUrl,
    customStr1: user.id,
    message: 'Live checkout fields prepared. Complete payment only via signed PayFast form.',
  })
})
