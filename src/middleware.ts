import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ─── Rate Limiting Store ──────────────────────────────────────────────────
// Production requests use a shared Upstash Redis counter when configured.
// Local in-memory counters are development-only and are never accepted as a
// production security boundary.
interface RateLimitEntry {
  count: number
  resetAt: number
}

const localRateLimitStore = new Map<string, RateLimitEntry>()

function checkLocalRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = localRateLimitStore.get(key)

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs
    localRateLimitStore.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: maxRequests - 1, resetAt }
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
}

type RateLimitDecision =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number }
  | { allowed: false; unavailable: true; remaining: 0; resetAt: number }

async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    // A per-process Map is acceptable for local development only. Production
    // must not silently degrade to a bypassable per-instance limiter.
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, unavailable: true, remaining: 0, resetAt: Date.now() + 1000 }
    }
    return checkLocalRateLimit(key, maxRequests, windowMs)
  }

  const now = Date.now()
  const windowStart = Math.floor(now / windowMs)
  const redisKey = `rain:ratelimit:${key}:${windowStart}`
  const script = [
    'local count = redis.call("INCR", KEYS[1])',
    'if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
    'local ttl = redis.call("PTTL", KEYS[1])',
    'return {count, ttl}',
  ].join('; ')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', script, '1', redisKey, String(windowMs)]),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Redis HTTP ${response.status}`)
    const payload = await response.json() as { result?: unknown; error?: string }
    if (payload.error) throw new Error(payload.error)
    if (!Array.isArray(payload.result) || payload.result.length < 2) {
      throw new Error('Unexpected Redis rate-limit response')
    }

    const count = Number(payload.result[0])
    const ttl = Number(payload.result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttl) || count < 1) {
      throw new Error('Invalid Redis rate-limit values')
    }
    const resetAt = now + Math.max(0, ttl)
    if (count > maxRequests) return { allowed: false, remaining: 0, resetAt }
    return { allowed: true, remaining: Math.max(0, maxRequests - count), resetAt }
  } catch (error) {
    console.error('[rate-limit] shared store unavailable:', error)
    // Fail closed for protected routes in production. Do not let a Redis
    // outage silently disable authentication and delivery rate limits.
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, unavailable: true, remaining: 0, resetAt: Date.now() + 1000 }
    }
    return checkLocalRateLimit(key, maxRequests, windowMs)
  }
}

// ─── Rate Limit Configuration ────────────────────────────────────────────
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  '/api/rain/auth/login': { max: 5, windowMs: 60_000 },       // 5 req/min
  '/api/rain/auth/register': { max: 3, windowMs: 60_000 },    // 3 req/min
  '/api/rain/auth/logout': { max: 10, windowMs: 60_000 },     // 10 req/min
  '/api/rain/render': { max: 10, windowMs: 60_000 },          // 10 req/min
  '/api/rain/distribute': { max: 5, windowMs: 60_000 },       // 5 req/min
  '/api/rain/distribute/finalize': { max: 5, windowMs: 60_000 },
  '/api/rain/feedback': { max: 3, windowMs: 60_000 },         // 3 req/min
  '/api/rain/reviews': { max: 5, windowMs: 60_000 },          // 5 req/min
  '/api/rain/assist': { max: 10, windowMs: 60_000 },          // 10 req/min
  '/api/rain/suggest': { max: 15, windowMs: 60_000 },         // 15 req/min
  '/api/rain/source': { max: 10, windowMs: 60_000 },          // 10 req/min (upload)
  '/api/rain/payment': { max: 5, windowMs: 60_000 },          // 5 req/min
  '/api/rain/admin': { max: 20, windowMs: 60_000 },           // 20 req/min
}

// ─── Payload Size Limits ─────────────────────────────────────────────────
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024 // 10MB general
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024  // 500MB for audio uploads
const UPLOAD_PATHS = ['/api/rain/source', '/api/rain/render']

// ─── Input Sanitization ──────────────────────────────────────────────────
function sanitizeString(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function hasXssPatterns(input: string): boolean {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript\s*:/gi,
    /on\w+\s*=/gi,
    /data\s*:\s*text\/html/gi,
    /vbscript\s*:/gi,
    /expression\s*\(/gi,
    /@import\s/gi,
    /<embed\b/gi,
    /<object\b/gi,
    /<iframe\b/gi,
  ]
  return xssPatterns.some((p) => p.test(input))
}

// ─── Content Security Policy ─────────────────────────────────────────────
function buildCSP(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // unsafe-eval needed for ONNX/WASM; unsafe-inline for Next.js
    "style-src 'self' 'unsafe-inline'",                 // unsafe-inline needed for Tailwind
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",                   // API + WebSocket
    "media-src 'self' blob: data:",                      // Audio processing
    "worker-src 'self' blob:",                           // WASM workers
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ]
  return directives.join('; ')
}

// ─── Security Headers ────────────────────────────────────────────────────
function getSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': buildCSP(),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-DNS-Prefetch-Control': 'on',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  }
}

// ─── CSRF Protection ─────────────────────────────────────────────────────
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_ALLOWED_ORIGINS = new Set([
  'https://rainv6beta.space-z.ai',
  'https://rainv6.com',
])

function validateCsrf(request: NextRequest): boolean {
  if (CSRF_SAFE_METHODS.has(request.method)) return true

  const origin = request.headers.get('origin')
  if (!origin) return true // Allow same-origin requests without Origin header

  // Check if origin matches the request host. Malformed Origin headers
  // must be rejected rather than throwing out of middleware.
  const host = request.headers.get('host')
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin)
      if (parsedOrigin.origin === `${request.nextUrl.protocol}//${host}`) return true
    } catch {
      return false
    }
  }

  return CSRF_ALLOWED_ORIGINS.has(origin)
}

// ─── Middleware ───────────────────────────────────────────────────────────
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // ── 1. Apply security headers to all responses ──
  const securityHeaders = getSecurityHeaders()
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }

  // ── 2. CSRF protection for API routes ──
  if (pathname.startsWith('/api/') && !validateCsrf(request)) {
    return NextResponse.json(
      { ok: false, error: 'CSRF validation failed' },
      { status: 403 },
    )
  }

  // ── 3. Rate limiting for API routes ──
  for (const [path, config] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(path)) {
      // Use IP + path as rate limit key
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown'
      const key = `${ip}:${path}`

      const result = await checkRateLimit(key, config.max, config.windowMs)
      response.headers.set('X-RateLimit-Remaining', String(result.remaining))
      response.headers.set('X-RateLimit-Reset', String(result.resetAt))

      if (!result.allowed && 'unavailable' in result && result.unavailable) {
        return NextResponse.json(
          { ok: false, error: 'Rate limiting service is not configured or unavailable.' },
          { status: 503, headers: { 'Retry-After': '1' } },
        )
      }

      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
        return NextResponse.json(
          { ok: false, error: 'Rate limit exceeded. Please try again later.', retryAfter },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        )
      }
      break
    }
  }

  // ── 4. Payload size check for POST/PUT with content-length ──
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    const maxSize = UPLOAD_PATHS.some((p) => pathname.startsWith(p))
      ? MAX_UPLOAD_SIZE
      : MAX_PAYLOAD_SIZE

    if (contentLength > maxSize) {
      return NextResponse.json(
        { ok: false, error: `Payload too large. Maximum size: ${maxSize / (1024 * 1024)}MB` },
        { status: 413 },
      )
    }
  }

  // ── 5. XSS sanitization for query parameters ──
  const url = request.nextUrl
  let sanitized = false
  for (const [key, value] of url.searchParams.entries()) {
    if (hasXssPatterns(value)) {
      url.searchParams.set(key, sanitizeString(value))
      sanitized = true
    }
  }
  if (sanitized) {
    return NextResponse.redirect(url)
  }

  return response
}

// ─── Matcher ──────────────────────────────────────────────────────────────
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml, sw.js, manifest.json
     * - public assets (models, demo-sample)
     */
    '/((?!_next/static|_next/image|favicon\\.svg|robots\\.txt|sitemap\\.xml|sw\\.js|manifest\\.json|models/|demo-sample|og-image).*)',
  ],
}
