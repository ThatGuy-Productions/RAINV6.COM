import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getPaymentReadiness } from '../src/lib/rain/payment-readiness'

const keys = [
  'PAYFAST_MERCHANT_ID',
  'PAYFAST_MERCHANT_KEY',
  'NEXT_PUBLIC_APP_URL',
  'PAYFAST_LIVE_ENABLED',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of keys) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('payment readiness', () => {
  test('defaults to not_live with blockers', () => {
    const r = getPaymentReadiness()
    expect(r.liveEnabled).toBe(false)
    expect(r.checkoutAvailable).toBe(false)
    expect(r.paymentStatus).toBe('not_live')
    expect(r.blockers.length).toBeGreaterThan(0)
    expect(r.unlockAmountCents).toBe(4900)
    expect(r.provider).toBe('payfast')
  })

  test('still not live with credentials but no public URL or live switch', () => {
    process.env.PAYFAST_MERCHANT_ID = 'test-id'
    process.env.PAYFAST_MERCHANT_KEY = 'test-key'
    const r = getPaymentReadiness()
    expect(r.credentialsPresent).toBe(true)
    expect(r.liveEnabled).toBe(false)
    expect(r.checkoutAvailable).toBe(false)
  })

  test('live only when credentials, public URL, and live switch are set', () => {
    process.env.PAYFAST_MERCHANT_ID = 'test-id'
    process.env.PAYFAST_MERCHANT_KEY = 'test-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://rainv6.com'
    process.env.PAYFAST_LIVE_ENABLED = 'true'
    const r = getPaymentReadiness()
    expect(r.liveEnabled).toBe(true)
    expect(r.checkoutAvailable).toBe(true)
    expect(r.paymentStatus).toBe('live_ready')
    expect(r.blockers).toEqual([])
  })

  test('rejects localhost as public URL', () => {
    process.env.PAYFAST_MERCHANT_ID = 'test-id'
    process.env.PAYFAST_MERCHANT_KEY = 'test-key'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    process.env.PAYFAST_LIVE_ENABLED = 'true'
    const r = getPaymentReadiness()
    expect(r.publicUrlConfirmed).toBe(false)
    expect(r.liveEnabled).toBe(false)
  })
})
