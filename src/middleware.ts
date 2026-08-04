import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rain/rate-limit'
import type { NextRequest } from 'next/server'

// ─── Rate Limiting Store (in-memory, per-process) ────────────────────────
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up expired entries every 60 seconds
if (typeof globalThis !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) rateLimitStore.delete(key)
    }
  }, 60_000).unref?.()
}

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs
    rateLimitStore.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: maxRequests - 1, resetAt }
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
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

  // Check if origin matches the request host
  const host = request.headers.get('host')
  if (origin && host) {
    const originHost = new URL(origin).host
    if (originHost === host) return true
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

      const result = checkRateLimit(key, config.max, config.windowMs)
      response.headers.set('X-RateLimit-Remaining', String(result.remaining))
      response.headers.set('X-RateLimit-Reset', String(result.resetAt))

      if (!result.allowed) {
        return NextResponse.json(
          { ok: false, error: 'Rate limit exceeded. Please try again later.', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) },
          { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) } },
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
