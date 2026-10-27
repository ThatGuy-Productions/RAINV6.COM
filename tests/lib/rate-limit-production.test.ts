import { afterEach, describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import { checkRateLimit } from '../../src/lib/rain/rate-limit'

const originalNodeEnv = process.env.NODE_ENV
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const originalFetch = globalThis.fetch

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
  else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl
  if (originalRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken
  globalThis.fetch = originalFetch
})

describe('production route rate limiter', () => {
  it('fails closed when shared Redis is not configured', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const request = new NextRequest('https://rainv6.com/api/rain/assist')

    const result = await checkRateLimit(request, 'assist', 20)

    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
    expect(result.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('allows requests under the configured limit using the shared store', async () => {
    process.env.NODE_ENV = 'production'
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: [1, 60_000] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    const request = new NextRequest('https://rainv6.com/api/rain/assist', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })

    const result = await checkRateLimit(request, 'assist', 20)

    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(19)
    expect(result.unavailable).toBeUndefined()
  })

  it('rejects requests over the shared limit', async () => {
    process.env.NODE_ENV = 'production'
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: [21, 12_000] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    const request = new NextRequest('https://rainv6.com/api/rain/assist', {
      headers: { 'x-forwarded-for': '203.0.113.11' },
    })

    const result = await checkRateLimit(request, 'assist', 20)

    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBe(12)
  })

  it('fails closed when the shared store errors', async () => {
    process.env.NODE_ENV = 'production'
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch
    const request = new NextRequest('https://rainv6.com/api/rain/assist')

    const result = await checkRateLimit(request, 'assist', 20)

    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })
})
