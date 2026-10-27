/**
 * RAIN V6 — Secondary in-process token bucket for API route handlers.
 *
 * Production routes must also be covered by the shared-store Upstash limiter in
 * middleware.ts. This helper cannot provide a cross-instance security boundary;
 * fail closed in production if a route reaches it without the shared guard.
 * Development/test use remains process-local.
 *
 * Usage:
 *   import { checkRateLimit } from '@/lib/rain/rate-limit'
 *   const { ok, retryAfter } = checkRateLimit(req, 'assist', 20)
 *   if (!ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
 */

import type { NextRequest } from 'next/server'

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const RATE_LIMIT_RPM_DEFAULT = 20

/** Sweep stale buckets every 5 minutes to prevent memory growth. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STALE_AFTER_MS = 10 * 60 * 1000
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > STALE_AFTER_MS) buckets.delete(key)
  }
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfter: number // seconds until next token available
}

/**
 * Check the rate limit for the given key prefix (usually the route name).
 * Returns ok=false if the bucket is empty; caller should respond 429.
 */
export function checkRateLimit(
  req: NextRequest,
  keyPrefix: string,
  rpm: number = RATE_LIMIT_RPM_DEFAULT,
): RateLimitResult {
  if (process.env.NODE_ENV === 'production') {
    // This synchronous helper cannot safely call the shared Redis store. The
    // shared middleware guard must enforce production limits before the route.
    // Fail closed if a production route reaches this helper without that guard.
    return { ok: false, remaining: 0, retryAfter: 1 }
  }

  const now = Date.now()
  sweep(now)

  // Forwarded-for from the gateway, fallback to direct IP.
  const xfwd = req.headers.get('x-forwarded-for')
  const ip = (xfwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown').slice(0, 64)
  const key = `${keyPrefix}:${ip}`

  const refillRatePerMs = rpm / 60_000
  const bucket = buckets.get(key)
  if (!bucket) {
    buckets.set(key, { tokens: rpm - 1, lastRefill: now })
    return { ok: true, remaining: rpm - 1, retryAfter: 0 }
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(rpm, bucket.tokens + elapsed * refillRatePerMs)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / refillRatePerMs / 1000)
    return { ok: false, remaining: 0, retryAfter: Math.max(1, retryAfter) }
  }

  bucket.tokens -= 1
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 }
}
