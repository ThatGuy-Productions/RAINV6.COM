/**
 * RAIN V6 Beta — Payment API Route
 *
 * POST /api/rain/payment — Create an isolated payment session
 * POST /api/rain/payment (body.action=confirm) — Confirm a payment
 * GET  /api/rain/payment?paymentSessionId=xxx — Check payment status
 *
 * Live PayFast redirects are refused unless getPaymentReadiness().liveEnabled
 * (public URL confirmed + PAYFAST_LIVE_ENABLED=true + credentials).
 */

import { NextRequest, NextResponse } from 'next/server'
import { PaymentIsolation, type PaymentMethod } from '@/lib/rain/payment-isolation'
import { isNonLivePaymentMode } from '@/lib/rain/payment-mode'
import { getPaymentReadiness } from '@/lib/rain/payment-readiness'
import { checkRateLimit } from '@/lib/rain/rate-limit'
import { formatZar } from '@/lib/rain/sa-regional'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean) as string[]

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  let requestOrigin: string
  try {
    requestOrigin = new URL(origin).origin
  } catch {
    return false
  }
  return ALLOWED_ORIGINS.some((allowed) => {
    try {
      return new URL(allowed).origin === requestOrigin
    } catch {
      return false
    }
  })
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Payment-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export const POST = withCsrf(async (req: NextRequest): Promise<NextResponse> => {
  const origin = req.headers.get('origin')

  if (!isSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: 'Cross-origin payment requests are not allowed.', stage: 'security' },
      { status: 403, headers: corsHeaders(origin) },
    )
  }

  const rateCheck = await checkRateLimit(req, 'payment:global', 10)
  if (!rateCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: rateCheck.unavailable ? 'Rate limiting service unavailable' : 'Too many payment requests. Please wait.',
        retryAfter: rateCheck.retryAfter,
      },
      {
        status: rateCheck.unavailable ? 503 : 429,
        headers: {
          ...corsHeaders(origin),
          'Retry-After': String(rateCheck.retryAfter),
        },
      },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body', stage: 'parse' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const action = typeof body.action === 'string' ? body.action : 'create'
  if (action === 'confirm') {
    return handleConfirm(req, body, origin)
  }
  return handleCreate(body, req, origin)
})

async function handleCreate(
  body: Record<string, unknown>,
  req: NextRequest,
  origin: string | null,
): Promise<NextResponse> {
  const isolation = PaymentIsolation.getInstance()
  const readiness = getPaymentReadiness()
  const nonLive = isNonLivePaymentMode()

  const userSessionId = typeof body.userSessionId === 'string' ? body.userSessionId.slice(0, 128) : ''
  const providerInput = typeof body.provider === 'string' ? body.provider : ''
  const amountCents = typeof body.amountCents === 'number' ? Math.round(body.amountCents) : 0
  const returnUrl = typeof body.returnUrl === 'string' ? body.returnUrl : ''
  const cancelUrl = typeof body.cancelUrl === 'string' ? body.cancelUrl : ''

  if (!userSessionId || userSessionId.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'Valid userSessionId is required (minimum 8 characters).', stage: 'validate' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const validProviders: PaymentMethod[] = ['payfast', 'ozow', 'stripe']
  if (!validProviders.includes(providerInput as PaymentMethod)) {
    return NextResponse.json(
      { ok: false, error: `Invalid payment provider. Must be one of: ${validProviders.join(', ')}.`, stage: 'validate' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const provider = providerInput as PaymentMethod
  const result = await isolation.createSession(userSessionId, provider, amountCents, req)

  if ('error' in result) {
    const status = result.unavailable ? 503 : result.retryAfter ? 429 : 400
    return NextResponse.json(
      { ok: false, error: result.error, retryAfter: result.retryAfter, stage: 'create_session' },
      {
        status,
        headers: {
          ...corsHeaders(origin),
          ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
        },
      },
    )
  }

  const { session } = result

  // Hard non-live gate: never redirect to a real gateway until readiness passes.
  if (nonLive) {
    return NextResponse.json(
      {
        ok: true,
        betaMode: true,
        paymentSessionId: session.paymentSessionId,
        provider: session.provider,
        amountCents: 0,
        amountDisplay: formatZar(0),
        currency: 'ZAR',
        tokenExpiresAt: session.tokenExpiresAt,
        token: session.token,
        redirectUrl: null,
        checkoutAvailable: false,
        paymentStatus: readiness.paymentStatus,
        blockers: readiness.blockers,
        message:
          'Non-live mode: payment infrastructure path only. No charges. Confirm public URL and set PAYFAST_LIVE_ENABLED=true before live checkout.',
      },
      { status: 200, headers: corsHeaders(origin) },
    )
  }

  const providerInstance = isolation.getProvider(provider)
  if (!providerInstance || !providerInstance.configured) {
    return NextResponse.json(
      { ok: false, error: 'Payment provider is not configured.', stage: 'provider' },
      { status: 503, headers: corsHeaders(origin) },
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin || 'http://localhost:3000'
  const effectiveReturnUrl = returnUrl || `${appUrl}/payment/success?session=${session.paymentSessionId}`
  const effectiveCancelUrl = cancelUrl || `${appUrl}/payment/cancel?session=${session.paymentSessionId}`
  const redirectUrl = providerInstance.generateRedirectUrl(session, effectiveReturnUrl, effectiveCancelUrl)

  return NextResponse.json(
    {
      ok: true,
      betaMode: false,
      paymentSessionId: session.paymentSessionId,
      provider: session.provider,
      currency: 'ZAR',
      tokenExpiresAt: session.tokenExpiresAt,
      redirectUrl,
      checkoutAvailable: true,
      paymentStatus: 'live_ready',
      message: 'Redirect to payment gateway to complete payment.',
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}

async function handleConfirm(
  req: NextRequest,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<NextResponse> {
  const isolation = PaymentIsolation.getInstance()
  const nonLive = isNonLivePaymentMode()

  const paymentSessionId = typeof body.paymentSessionId === 'string' ? body.paymentSessionId : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const providerSignature = typeof body.providerSignature === 'string' ? body.providerSignature : undefined

  if (!paymentSessionId) {
    return NextResponse.json(
      { ok: false, error: 'paymentSessionId is required for confirmation.', stage: 'validate' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const session = isolation.validateToken(paymentSessionId, token)
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired payment token. Tokens expire after 5 minutes.', stage: 'token' },
      { status: 401, headers: corsHeaders(origin) },
    )
  }

  if (nonLive) {
    const betaProviderData: Record<string, string> = {
      pf_payment_id: `beta-${paymentSessionId}`,
      amount_gross: '0.00',
      amount_fee: '0.00',
      amount_net: '0.00',
      payment_status: 'complete',
      custom_str1: session.userSessionId,
      custom_str2: session.idempotencyKey,
    }
    const confirmResult = isolation.confirmPayment(paymentSessionId, betaProviderData, 'beta-mock-signature')
    if ('error' in confirmResult) {
      return NextResponse.json(
        { ok: false, error: confirmResult.error, stage: 'confirm' },
        { status: 400, headers: corsHeaders(origin) },
      )
    }
    const receipt = isolation.generateReceipt(confirmResult.confirmation)
    return NextResponse.json(
      {
        ok: true,
        betaMode: true,
        amount: 0,
        amountDisplay: formatZar(0),
        paymentSessionId,
        receiptId: receipt.receiptId,
        confirmation: {
          verified: confirmResult.confirmation.verified,
          provider: confirmResult.confirmation.provider,
          confirmedAt: confirmResult.confirmation.confirmedAt,
        },
        distribution: {
          triggered: false,
          error: 'Payment confirmation cannot submit a release by itself. Build and submit the signed distribution ZIP separately.',
        },
        message: 'Non-live confirmation only (R0.00). No real charge. No beta unlock entitlement granted from this path.',
      },
      { status: 200, headers: corsHeaders(origin) },
    )
  }

  if (!providerSignature) {
    return NextResponse.json(
      { ok: false, error: 'Provider signature is required in live mode.', stage: 'signature' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const providerData = (body.providerData as Record<string, string>) || body
  const confirmResult = isolation.confirmPayment(paymentSessionId, providerData, providerSignature)
  if ('error' in confirmResult) {
    return NextResponse.json(
      { ok: false, error: confirmResult.error, stage: 'confirm' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const receipt = isolation.generateReceipt(confirmResult.confirmation)
  return NextResponse.json(
    {
      ok: true,
      betaMode: false,
      paymentSessionId,
      receiptId: receipt.receiptId,
      providerTransactionId: confirmResult.confirmation.providerTransactionId,
      confirmation: {
        verified: confirmResult.confirmation.verified,
        provider: confirmResult.confirmation.provider,
        signatureAlgorithm: confirmResult.confirmation.signatureAlgorithm,
        confirmedAt: confirmResult.confirmation.confirmedAt,
      },
      distribution: {
        triggered: false,
        error: 'Payment confirmation cannot submit a release by itself. Build and submit the signed distribution ZIP separately.',
      },
      message: 'Payment confirmed. Distribution must be submitted separately.',
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')
  const url = new URL(req.url)
  const paymentSessionId = url.searchParams.get('paymentSessionId')
  if (!paymentSessionId) {
    return NextResponse.json(
      { ok: false, error: 'paymentSessionId query parameter is required.' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const isolation = PaymentIsolation.getInstance()
  const session = isolation.getSession(paymentSessionId)
  if (!session) {
    return NextResponse.json(
      { ok: true, status: 'not_found', message: 'Payment session not found.' },
      { status: 200, headers: corsHeaders(origin) },
    )
  }

  const confirmation = isolation.getConfirmation(paymentSessionId)
  const nonLive = isNonLivePaymentMode()

  return NextResponse.json(
    {
      ok: true,
      status: confirmation ? 'confirmed' : session.confirmed ? 'confirmed' : 'pending',
      paymentSessionId: session.paymentSessionId,
      provider: session.provider,
      currency: session.currency,
      confirmable: !session.confirmed && session.tokenExpiresAt > Date.now(),
      betaMode: nonLive,
      paymentStatus: getPaymentReadiness().paymentStatus,
      amountDisplay: nonLive ? formatZar(0) : undefined,
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}
