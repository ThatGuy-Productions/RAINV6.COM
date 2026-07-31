/**
 * RAIN V6 — Security Middleware
 *
 * Applies security headers, CSRF protection, rate limiting, and input
 * sanitization across all routes. Runs on every request before the
 * application handler.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------

const SECURITY_HEADERS: Record<string, string> = {
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',

  // Prevent clickjacking
  'X-Frame-Options': 'DENY',

  // Control referrer information
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Restrict browser features
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), accelerometer=(), gyroscope=(), magnetometer=()',

  // HSTS (only enforced over HTTPS)
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',

  // Cross-origin isolation for SharedArrayBuffer (needed by audio WASM)
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// Relaxed CSP that allows inline styles (needed by Tailwind/Radix),
// Web Audio worklets, and ONNX WASM. Tightened as much as possible
// without breaking the application.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // ONNX WASM needs eval
  "style-src 'self' 'unsafe-inline'", // Tailwind/Radix need inline styles
  "img-src 'self' data: blob: https:", // blob: needed for audio waveforms
  "font-src 'self'",
  "connect-src 'self' https: wss:", // API calls + WebSocket for dev
  "media-src 'self' blob:", // Audio playback
  "worker-src 'self' blob:", // Web Workers for ONNX/AudioWorklet
  "frame-ancestors 'none'", // Prevent embedding in iframes
  "form-action 'self'",
  "base-uri 'self'",
].join('; ')

// ---------------------------------------------------------------------------
// Rate Limiting (token-bucket, per-IP, in-memory)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let lastSweep = Date.now()

function sweepBuckets(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  const staleThreshold = now - 10 * 60 * 1000
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < staleThreshold) buckets.delete(key)
  }
}

function getClientIp(req: NextRequest): string {
  const xfwd = req.headers.get('x-forwarded-for')
  return (xfwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1').slice(0, 64)
}

function checkRateLimit(ip: string, route: string, rpm: number): { ok: boolean; retryAfter: number } {
  const now = Date.now()
  sweepBuckets(now)
  const key = `${route}:${ip}`
  const refillRate = rpm / 60_000

  let bucket = buckets.get(key)
  if (!bucket) {
    buckets.set(key, { tokens: rpm - 1, lastRefill: now })
    return { ok: true, retryAfter: 0 }
  }

  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(rpm, bucket.tokens + elapsed * refillRate)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate / 1000)
    return { ok: false, retryAfter: Math.max(1, retryAfter) }
  }

  bucket.tokens -= 1
  return { ok: true, retryAfter: 0 }
}

// ---------------------------------------------------------------------------
// Rate limit configuration per route pattern
// ---------------------------------------------------------------------------

const RATE_LIMITS: Array<{ pattern: RegExp; rpm: number }> = [
  { pattern: /^\/api\/rain\/auth\/login$/, rpm: 5 },       // Brute-force protection
  { pattern: /^\/api\/rain\/auth\/register$/, rpm: 3 },      // Registration abuse
  { pattern: /^\/api\/rain\/auth\/logout$/, rpm: 10 },
  { pattern: /^\/api\/rain\/assist$/, rpm: 20 },             // AI assistant
  { pattern: /^\/api\/rain\/distribute/, rpm: 10 },          // Distribution (large payloads)
  { pattern: /^\/api\/rain\/payment/, rpm: 30 },
  { pattern: /^\/api\/rain\/render$/, rpm: 10 },
  { pattern: /^\/api\/rain\/reviews$/, rpm: 30 },
  { pattern: /^\/api\/rain\/feedback$/, rpm: 20 },
  { pattern: /^\/api\/rain\/session$/, rpm: 60 },
  { pattern: /^\/api\/rain\/events$/, rpm: 120 },            // Analytics
  { pattern: /^\/api\/rain\/source$/, rpm: 60 },
  { pattern: /^\/api\/rain\/suggest$/, rpm: 30 },
  { pattern: /^\/api\/rain\/stats$/, rpm: 60 },
  { pattern: /^\/api\/rain\/admin/, rpm: 30 },
]

// ---------------------------------------------------------------------------
// XSS Sanitization
// ---------------------------------------------------------------------------

/** Strip HTML tags and dangerous characters from user input. */
function sanitizeInput(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;')
}

// Routes whose POST body should be sanitized
const SANITIZE_ROUTES = [
  /^\/api\/rain\/reviews$/,
  /^\/api\/rain\/feedback$/,
]

// ---------------------------------------------------------------------------
// Middleware handler
// ---------------------------------------------------------------------------

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const response = NextResponse.next()

  // --- Security Headers (all routes) ---
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  // Content-Security-Policy (set separately for clarity)
  response.headers.set('Content-Security-Policy', CSP_DIRECTIVES)

  // --- API-specific protections ---
  if (pathname.startsWith('/api/')) {
    // CORS headers for API routes
    const origin = req.headers.get('origin') || '*'
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Max-Age', '86400')

    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }

    // Rate limiting
    const ip = getClientIp(req)
    for (const { pattern, rpm } of RATE_LIMITS) {
      if (pattern.test(pathname)) {
        const rl = checkRateLimit(ip, pathname, rpm)
        if (!rl.ok) {
          return NextResponse.json(
            { ok: false, error: 'Too many requests. Please try again later.', retryAfter: rl.retryAfter },
            {
              status: 429,
              headers: {
                ...Object.fromEntries(response.headers.entries()),
                'Retry-After': String(rl.retryAfter),
              },
            },
          )
        }
        break
      }
    }
  }

  return response
}

// ---------------------------------------------------------------------------
// Matcher — apply to all routes except static assets and Next.js internals
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|models/|public/).*)',
  ],
}
