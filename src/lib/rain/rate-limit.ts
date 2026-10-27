/**
 * RAIN V6 — shared-store API rate limiter.
 *
 * Production uses an atomic Upstash Redis fixed-window counter. It fails closed
 * when the shared store is missing or unavailable; process-local state is used
 * only for development/test. Middleware limits remain an outer defence, while
 * this helper protects route-specific budgets.
 */
import type { NextRequest } from 'next/server'

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const RATE_LIMIT_RPM_DEFAULT = 20
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STALE_AFTER_MS = 10 * 60 * 1000
let lastSweep = Date.now()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfter: number
  unavailable?: boolean
}

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > STALE_AFTER_MS) buckets.delete(key)
  }
}

function checkLocalRateLimit(key: string, rpm: number, now: number): RateLimitResult {
  sweep(now)
  const refillRatePerMs = rpm / 60_000
  const bucket = buckets.get(key)
  if (!bucket) {
    buckets.set(key, { tokens: Math.max(0, rpm - 1), lastRefill: now })
    return { ok: true, remaining: Math.max(0, rpm - 1), retryAfter: 0 }
  }

  bucket.tokens = Math.min(rpm, bucket.tokens + (now - bucket.lastRefill) * refillRatePerMs)
  bucket.lastRefill = now
  if (bucket.tokens < 1) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / refillRatePerMs / 1000)),
    }
  }
  bucket.tokens -= 1
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Check a route-specific rate limit. In production, a Redis counter is required
 * so horizontally scaled instances cannot independently authorize requests.
 */
export async function checkRateLimit(
  req: NextRequest,
  keyPrefix: string,
  rpm: number = RATE_LIMIT_RPM_DEFAULT,
): Promise<RateLimitResult> {
  const safeRpm = Number.isFinite(rpm) ? Math.max(1, Math.floor(rpm)) : RATE_LIMIT_RPM_DEFAULT
  const forwardedFor = req.headers.get('x-forwarded-for')
  const ip = (forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown').slice(0, 64)
  const key = `${keyPrefix}:${ip}`

  if (process.env.NODE_ENV !== 'production') {
    return checkLocalRateLimit(key, safeRpm, Date.now())
  }

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return { ok: false, remaining: 0, retryAfter: 1, unavailable: true }
  }

  try {
    const now = Date.now()
    const windowMs = 60_000
    const windowStart = Math.floor(now / windowMs)
    const redisKey = `rain:route-limit:${await sha256Hex(key)}:${windowStart}`
    const script = [
      'local count = redis.call("INCR", KEYS[1])',
      'if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
      'local ttl = redis.call("PTTL", KEYS[1])',
      'return {count, ttl}',
    ].join('; ')
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', script, '1', redisKey, String(windowMs)]),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`)
    const payload = await response.json() as { result?: unknown; error?: string }
    if (payload.error || !Array.isArray(payload.result) || payload.result.length < 2) {
      throw new Error(payload.error || 'Unexpected Upstash rate-limit response')
    }

    const count = Number(payload.result[0])
    const ttl = Number(payload.result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttl) || count < 1) {
      throw new Error('Invalid Upstash rate-limit values')
    }
    const retryAfter = Math.max(1, Math.ceil(Math.max(0, ttl) / 1000))
    if (count > safeRpm) return { ok: false, remaining: 0, retryAfter }
    return { ok: true, remaining: Math.max(0, safeRpm - count), retryAfter: 0 }
  } catch (error) {
    console.error('[route-rate-limit] shared store unavailable:', error)
    return { ok: false, remaining: 0, retryAfter: 1, unavailable: true }
  }
}
