/**
 * RAIN V6 — Next.js Middleware
 *
 * Applied to every request. Handles:
 *   1. Security headers (CSP, X-Frame-Options, etc.)
 *   2. Rate limiting on sensitive auth/distribute endpoints
 *   3. Request size limiting on upload endpoints
 *
 * Middleware runs on the Edge runtime — no Node.js APIs, no Prisma, no env
 * access beyond what's prefixed NEXT_PUBLIC_. This is a stateless function
 * that sets security headers and gates before requests reach route handlers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rain/rate-limit'

// ---------------------------------------------------------------------------
// Security headers applied to EVERY response
// ---------------------------------------------------------------------------

const SECURITY_HEADERS: Record<string, string> = {
  // Content Security Policy — allows self, unsafe-eval for ONNX runtime,
  // and local/dev connections
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
  'X-DNS-Prefetch-Control': 'off',
}

// ---------------------------------------------------------------------------
// Rate-limited endpoints (path prefix → RPM)
// ---------------------------------------------------------------------------

const RATE_LIMITED = [
  { pattern: '/api/rain/auth/login', prefix: 'auth:login', rpm: 5 },
  { pattern: '/api/rain/auth/register', prefix: 'auth:register', rpm: 5 },
  { pattern: '/api/rain/distribute', prefix: 'distribute', rpm: 10 },
]

// ---------------------------------------------------------------------------
// Upload endpoints with body size limits (bytes)
// ---------------------------------------------------------------------------

const UPLOAD_SIZE_LIMITS: Record<string, number> = {
  '/api/rain/distribute': 100 * 1024 * 1024, // 100 MB for DDEX packages
}

// ---------------------------------------------------------------------------
// Middleware entry point
// ---------------------------------------------------------------------------

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Skip static assets and Next.js internals ──────────────────────────
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/manifest.')
  ) {
    return NextResponse.next()
  }

  // ── Rate limiting on sensitive endpoints ──────────────────────────────
  for (const { pattern, prefix, rpm } of RATE_LIMITED) {
    if (pathname.startsWith(pattern) && req.method !== 'OPTIONS') {
      const rateCheck = checkRateLimit(req, prefix, rpm)
      if (!rateCheck.ok) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait.', retryAfter: rateCheck.retryAfter },
          {
            status: 429,
            headers: {
              ...SECURITY_HEADERS,
              'Retry-After': String(rateCheck.retryAfter),
            },
          },
        )
      }
      break
    }
  }

  // ── Request size limiting on upload endpoints ─────────────────────────
  const sizeLimit = UPLOAD_SIZE_LIMITS[pathname]
  if (sizeLimit && req.method === 'POST') {
    const contentLength = req.headers.get('content-length')
    if (contentLength) {
      const bodySize = parseInt(contentLength, 10)
      if (bodySize > sizeLimit) {
        return NextResponse.json(
          { error: `Request body exceeds ${(sizeLimit / (1024 * 1024)).toFixed(0)} MB limit` },
          { status: 413, headers: SECURITY_HEADERS },
        )
      }
    }
  }

  // ── Apply security headers to every response ──────────────────────────
  const response = NextResponse.next()

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }

  // Ensure headers are also set on API routes (which may not be covered by
  // the next.config.js headers() block — that block excludes /api/ paths)
  return response
}

// ---------------------------------------------------------------------------
// Matcher config — skip paths that should not trigger middleware
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static and _next/image (static files, image optimization)
     *  - favicon.ico (favicon)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
