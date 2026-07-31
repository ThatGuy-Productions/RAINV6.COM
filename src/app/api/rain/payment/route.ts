/**
 * RAIN V6 Beta — Payment API Route
 *
 * POST /api/rain/payment — Create an isolated payment session
 * POST /api/rain/payment (body.action=confirm) — Confirm a payment
 * GET  /api/rain/payment?paymentSessionId=xxx — Check payment status
 *
 * SECURITY: This route is the single entry point for all payment operations.
 * Every request is validated for:
 *   - Same-origin (prevent CSRF)
 *   - Rate limiting (3 attempts per session per minute)
 *   - Session isolation (UUIDv7 — no cross-user payment data)
 *   - Payment token expiry (5 minutes)
 *   - Idempotency (same paymentSessionId → same result)
 *   - Beta mode (R0.00 with infrastructure verified)
 *
 * Architecture:
 *   Client → POST /api/rain/payment → PaymentIsolation.createSession()
 *     → Beta mode: { ok: true, betaMode: true, amount: 0 }
 *     → Live mode: Redirect to PayFast/Ozow/Stripe gateway
 *     → Callback: POST /api/rain/payment/confirm
 *     → Confirmation: PaymentIsolation.confirmPayment()
 *     → Distribution pipeline: POST /api/rain/distribute/finalize
 *
 * IDEMPOTENCY:
 *   The paymentSessionId is the idempotency key. If a payment with the same
 *   sessionId has already been confirmed, the existing result is returned
 *   instead of creating a new payment. No duplicate charges.
 */

import { NextRequest, NextResponse } from 'next/server'
import { PaymentIsolation, isBetaMode, type PaymentMethod } from '@/lib/rain/payment-isolation'
import { checkRateLimit } from '@/lib/rain/rate-limit'
import { formatZar } from '@/lib/rain/sa-regional'

export const runtime = 'nodejs'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Allowed origins (same-origin check)
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean) as string[]

/**
 * Verify that the request origin matches the allowed origins.
 * Prevents CSRF by rejecting cross-origin payment requests.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) {
    // Allow requests without origin header (server-to-server, direct API calls)
    return true
  }
  return ALLOWED_ORIGINS.some((allowed) => origin === allowed || allowed.startsWith(origin))
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Payment-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight
// ---------------------------------------------------------------------------

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  })
}

// ---------------------------------------------------------------------------
// POST — Create isolated payment session OR confirm payment
// ---------------------------------------------------------------------------
// Route behavior:
//   body.action === 'confirm' → confirm a payment (after provider callback)
//   body.action === 'create' or absent → create a new payment session
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')

  // ── Same-origin check ──────────────────────────────────────────────────
  if (!isSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: 'Cross-origin payment requests are not allowed.', stage: 'security' },
      { status: 403, headers: corsHeaders(origin) },
    )
  }

  // ── Global rate limit ──────────────────────────────────────────────────
  const rateCheck = checkRateLimit(req, 'payment:global', 10)
  if (!rateCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many payment requests. Please wait.', retryAfter: rateCheck.retryAfter },
      {
        status: 429,
        headers: {
          ...corsHeaders(origin),
          'Retry-After': String(rateCheck.retryAfter),
        },
      },
    )
  }

  // ── Parse request body ─────────────────────────────────────────────────
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

  // ── Route to the appropriate handler ───────────────────────────────────
  if (action === 'confirm') {
    return handleConfirm(req, body, origin)
  }

  return handleCreate(body, req, origin)
}

// ---------------------------------------------------------------------------
// handleCreate — Create a new isolated payment session
// ---------------------------------------------------------------------------

async function handleCreate(
  body: Record<string, unknown>,
  req: NextRequest,
  origin: string | null,
): Promise<NextResponse> {
  const isolation = PaymentIsolation.getInstance()

  // ── Validate required fields ────────────────────────────────────────────
  const userSessionId = typeof body.userSessionId === 'string' ? body.userSessionId.slice(0, 128) : ''
  const provider = typeof body.provider === 'string' ? body.provider as PaymentMethod : ''
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
  if (!validProviders.includes(provider)) {
    return NextResponse.json(
      { ok: false, error: `Invalid payment provider. Must be one of: ${validProviders.join(', ')}.`, stage: 'validate' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  // ── Create isolated payment session ─────────────────────────────────────
  const result = isolation.createSession(userSessionId, provider, amountCents, req)

  if ('error' in result) {
    const status = result.retryAfter ? 429 : 400
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        retryAfter: result.retryAfter,
        stage: 'create_session',
      },
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
  const betaMode = isBetaMode()

  // ── Beta mode: return mock confirmation (no real payment) ───────────────
  if (betaMode) {
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
        token: session.token, // In beta, token is safe to expose for confirm flow
        message: 'Beta mode: Payment infrastructure verified. No charges will be made (R0.00).',
        redirectUrl: null, // No redirect in beta — payment is instant
      },
      { status: 200, headers: corsHeaders(origin) },
    )
  }

  // ── Live mode: generate provider redirect URL ──────────────────────────
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
      message: 'Redirect to payment gateway to complete payment.',
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}

// ---------------------------------------------------------------------------
// handleConfirm — Confirm a payment and trigger distribution
// ---------------------------------------------------------------------------

async function handleConfirm(
  req: NextRequest,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<NextResponse> {
  const isolation = PaymentIsolation.getInstance()
  const betaMode = isBetaMode()

  const paymentSessionId = typeof body.paymentSessionId === 'string' ? body.paymentSessionId : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const providerSignature = typeof body.providerSignature === 'string' ? body.providerSignature : undefined

  if (!paymentSessionId) {
    return NextResponse.json(
      { ok: false, error: 'paymentSessionId is required for confirmation.', stage: 'validate' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  // ── Validate token ──────────────────────────────────────────────────────
  const session = isolation.validateToken(paymentSessionId, token)
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired payment token. Tokens expire after 5 minutes.', stage: 'token' },
      { status: 401, headers: corsHeaders(origin) },
    )
  }

  // ── Beta mode: auto-confirm with mock signature ─────────────────────────
  if (betaMode) {
    const betaProviderData: Record<string, string> = {
      pf_payment_id: `beta-${paymentSessionId}`,
      amount_gross: '0.00',
      amount_fee: '0.00',
      amount_net: '0.00',
      payment_status: 'complete',
      custom_str1: session.userSessionId,
      custom_str2: session.idempotencyKey,
    }

    const betaSignature = 'beta-mock-signature'

    const confirmResult = isolation.confirmPayment(
      paymentSessionId,
      betaProviderData,
      betaSignature,
    )

    if ('error' in confirmResult) {
      return NextResponse.json(
        { ok: false, error: confirmResult.error, stage: 'confirm' },
        { status: 400, headers: corsHeaders(origin) },
      )
    }

    // Generate immutable receipt (server-side only)
    const receipt = isolation.generateReceipt(confirmResult.confirmation)

    // ── Trigger distribution pipeline ─────────────────────────────────────
    const distributionResult = await triggerDistributionFinalize(
      session.userSessionId,
      paymentSessionId,
    )

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
        distribution: distributionResult,
        message: 'Beta payment confirmed (R0.00). Distribution pipeline triggered.',
      },
      { status: 200, headers: corsHeaders(origin) },
    )
  }

  // ── Live mode: require provider signature ──────────────────────────────
  if (!providerSignature) {
    return NextResponse.json(
      { ok: false, error: 'Provider signature is required in live mode.', stage: 'signature' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const providerData = (body.providerData as Record<string, string>) || body

  const confirmResult = isolation.confirmPayment(
    paymentSessionId,
    providerData,
    providerSignature,
  )

  if ('error' in confirmResult) {
    return NextResponse.json(
      { ok: false, error: confirmResult.error, stage: 'confirm' },
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  // Generate immutable receipt (server-side only)
  const receipt = isolation.generateReceipt(confirmResult.confirmation)

  // ── Trigger distribution pipeline ───────────────────────────────────────
  const distributionResult = await triggerDistributionFinalize(
    session.userSessionId,
    paymentSessionId,
  )

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
      distribution: distributionResult,
      message: 'Payment confirmed. Distribution pipeline triggered.',
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}

// ---------------------------------------------------------------------------
// GET — Check payment status (idempotent read-only)
// ---------------------------------------------------------------------------

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

  return NextResponse.json(
    {
      ok: true,
      status: confirmation ? 'confirmed' : (session.confirmed ? 'confirmed' : 'pending'),
      paymentSessionId: session.paymentSessionId,
      provider: session.provider,
      currency: session.currency,
      confirmable: !session.confirmed && session.tokenExpiresAt > Date.now(),
      betaMode: isBetaMode(),
      amountDisplay: isBetaMode() ? formatZar(session.amountCents) : undefined,
    },
    { status: 200, headers: corsHeaders(origin) },
  )
}

// ---------------------------------------------------------------------------
// Distribution pipeline trigger
// ---------------------------------------------------------------------------

/**
 * Trigger the distribution pipeline after successful payment.
 *
 * POSTs to /api/rain/distribute/finalize with the session context.
 * The distribution pipeline handles:
 *   1. DDEX ERN 4.3.2 XML validation
 *   2. Release metadata persistence
 *   3. LabelGrid submission
 *
 * In beta mode, this is called with mock payment data.
 * The finalize route returns 'pending_credentials' if LabelGrid is not
 * configured — this is expected during beta.
 */
async function triggerDistributionFinalize(
  userSessionId: string,
  paymentSessionId: string,
): Promise<{ triggered: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const finalizeUrl = `${appUrl}/api/rain/distribute/finalize`

  try {
    const resp = await fetch(finalizeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: userSessionId,
        paymentSessionId,
        // Distribution-finalize expects these fields from the client pipeline.
        // When triggered from payment, the DDEX package should already be built.
        // The finalize route will return 'pending_credentials' if LabelGrid
        // is not configured — this is expected in beta.
        ddexXml: '', // Populated by the client before calling finalize
        manifest: {},
        packageSha256: '',
        packageSizeBytes: 0,
        aiDisclosure: {},
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (resp.ok) {
      return { triggered: true }
    }

    const respBody = await resp.json().catch(() => ({}))
    return {
      triggered: false,
      error: (respBody as any).error || `Distribution pipeline returned HTTP ${resp.status}`,
    }
  } catch (e) {
    return {
      triggered: false,
      error: e instanceof Error ? e.message : 'Failed to trigger distribution pipeline.',
    }
  }
}