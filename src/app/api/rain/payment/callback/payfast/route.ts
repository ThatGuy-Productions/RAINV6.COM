import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import {
  BETA_UNLOCK_AMOUNT_CENTS,
  BETA_UNLOCK_CURRENCY,
  BETA_UNLOCK_ENTITLEMENT_KIND,
} from '@/lib/rain/beta-entitlement-policy'
import { getPaymentReadiness } from '@/lib/rain/payment-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/rain/payment/callback/payfast
 *
 * PayFast Instant Transaction Notification (ITN).
 * Browser return URLs are NOT payment proof. Only a verified ITN may grant
 * the once-off beta_r49_unlock entitlement.
 *
 * Live processing is blocked until getPaymentReadiness().liveEnabled is true
 * (public URL confirmed + PAYFAST_LIVE_ENABLED=true + credentials).
 */

function buildPayFastSignature(payload: Record<string, string>, passphrase: string): string {
  const sortedKeys = Object.keys(payload)
    .filter((k) => k !== 'signature' && payload[k] !== '')
    .sort()
  let paramString = ''
  for (const key of sortedKeys) {
    paramString += `${key}=${encodeURIComponent(payload[key].trim()).replace(/%20/g, '+')}&`
  }
  paramString = paramString.slice(0, -1)
  const checkString = passphrase
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : paramString
  return createHash('md5').update(checkString).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await req.json() as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(json)) {
      if (v !== undefined && v !== null) out[k] = String(v)
    }
    return out
  }
  const text = await req.text()
  const params = new URLSearchParams(text)
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}

export async function POST(req: NextRequest) {
  const readiness = getPaymentReadiness()
  if (!readiness.liveEnabled) {
    console.warn('[payfast/itn] rejected: payment not live-ready', readiness.blockers)
    // PayFast expects 200 for acknowledged noise in some setups; we return 503
    // so misconfigured live ITNs are visible in logs and do not grant access.
    return new NextResponse('Payment not live-ready', { status: 503 })
  }

  let payload: Record<string, string>
  try {
    payload = await parseBody(req)
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  const signature = payload.signature || ''
  const passphrase = (process.env.PAYFAST_PASSPHRASE || '').trim()
  const expected = buildPayFastSignature(payload, passphrase)
  if (!signature || !safeEqualHex(signature, expected)) {
    console.warn('[payfast/itn] invalid signature')
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const paymentStatus = (payload.payment_status || '').toLowerCase()
  if (paymentStatus !== 'complete') {
    return new NextResponse('Ignored non-complete status', { status: 200 })
  }

  const amountGross = Math.round(parseFloat(payload.amount_gross || '0') * 100)
  if (!Number.isFinite(amountGross) || amountGross !== BETA_UNLOCK_AMOUNT_CENTS) {
    console.warn('[payfast/itn] amount mismatch', amountGross)
    return new NextResponse('Amount mismatch', { status: 400 })
  }

  const mPaymentId = payload.m_payment_id || ''
  const pfPaymentId = payload.pf_payment_id || ''
  const userId = payload.custom_str1 || '' // we will set this when creating checkout
  if (!userId || !mPaymentId) {
    console.warn('[payfast/itn] missing user or payment id')
    return new NextResponse('Missing references', { status: 400 })
  }

  try {
    await db.$transaction(async (tx) => {
      // Idempotent: if this provider payment already verified, stop.
      if (pfPaymentId) {
        const existing = await tx.payment.findFirst({
          where: { provider: 'payfast', providerPaymentId: pfPaymentId },
          select: { id: true, status: true },
        })
        if (existing?.status === 'verified') return
      }

      const payment = await tx.payment.upsert({
        where: { idempotencyKey: mPaymentId },
        create: {
          userId,
          provider: 'payfast',
          providerPaymentId: pfPaymentId || null,
          providerEventId: pfPaymentId || null,
          idempotencyKey: mPaymentId,
          amountCents: BETA_UNLOCK_AMOUNT_CENTS,
          currency: BETA_UNLOCK_CURRENCY,
          purpose: 'beta_unlock',
          status: 'verified',
          verifiedAt: new Date(),
          metadata: JSON.stringify({
            payment_status: payload.payment_status,
            amount_gross: payload.amount_gross,
          }),
        },
        update: {
          status: 'verified',
          providerPaymentId: pfPaymentId || undefined,
          providerEventId: pfPaymentId || undefined,
          verifiedAt: new Date(),
        },
        select: { id: true, userId: true },
      })

      const existingEntitlement = await tx.entitlement.findFirst({
        where: {
          userId: payment.userId,
          kind: BETA_UNLOCK_ENTITLEMENT_KIND,
          status: 'active',
        },
        select: { id: true },
      })
      if (!existingEntitlement) {
        await tx.entitlement.create({
          data: {
            userId: payment.userId,
            sourcePaymentId: payment.id,
            kind: BETA_UNLOCK_ENTITLEMENT_KIND,
            status: 'active',
            startsAt: new Date(),
            endsAt: null, // ends at commercial launch via ops migration, not calendar auto-expiry
            metadata: JSON.stringify({
              onceOff: true,
              betaStageOnly: true,
              commercialDiscountEligible: true,
            }),
          },
        })
      }
    })
  } catch (err) {
    console.error('[payfast/itn] persistence failed:', err)
    return new NextResponse('Persistence failed', { status: 503 })
  }

  // PayFast expects a plain 200 OK body.
  return new NextResponse('OK', { status: 200 })
}
