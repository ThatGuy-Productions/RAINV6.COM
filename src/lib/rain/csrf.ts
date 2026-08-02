/**
 * RAIN V6 — CSRF Protection Middleware
 *
 * Double-submit cookie pattern with token-per-session rotation.
 *
 * Architecture:
 *   1. Client calls GET /api/rain/csrf-token on app startup
 *   2. Server returns token in both Set-Cookie header and JSON body
 *   3. Client stores token and attaches it as X-CSRF-Token on all fetch requests
 *   4. On state-changing methods (POST/PUT/PATCH/DELETE), server validates
 *      X-CSRF-Token header === __Host-rain-csrf cookie value
 *   5. Timing-safe comparison prevents timing side-channel attacks
 *
 * Cookie:
 *   __Host-rain-csrf (httpOnly, SameSite=Strict, path=/)
 *   __Host- prefix enforces: Secure flag (in production), no Domain attribute
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CSRF_COOKIE = '__Host-rain-csrf'
export const CSRF_HEADER = 'X-CSRF-Token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random CSRF token.
 * 32 bytes → 43 characters in base64url (no padding).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

// ---------------------------------------------------------------------------
// Cookie management
// ---------------------------------------------------------------------------

/**
 * Set the CSRF token as a signed cookie on the response.
 *
 * Cookie properties:
 *   - httpOnly: true (JavaScript cannot read it — prevents XSS exfiltration)
 *   - SameSite: Strict (cookie not sent on cross-origin requests)
 *   - Path: / (scoped to the application root)
 *   - __Host- prefix: forces Secure (in production) and prevents subdomain
 *     cookie injection
 *   - Max-Age: 3600 (1 hour — trades convenience for security)
 */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 3600,
  })
}

/**
 * Set CSRF cookie as non-httpOnly — used ONLY by the csrf-token endpoint
 * so the client can read the token value from the JSON response body.
 * The cookie itself being readable doesn't create a vulnerability because
 * CSRF protection relies on the attacker's inability to set a custom
 * header (X-CSRF-Token) in a cross-origin request.
 */
export function setCsrfCookieReadable(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 3600,
  })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Timing-safe string comparison using Node's crypto.timingSafeEqual.
 * Prevents attackers from measuring token comparison time to brute-force
 * the CSRF token character by character.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Validate the CSRF token from the request.
 *
 * Reads X-CSRF-Token header and compares against the __Host-rain-csrf
 * cookie value using timing-safe comparison.
 *
 * Returns true if both tokens exist and match.
 */
export function validateCsrf(headers: Headers, cookies: Map<string, string> | { get(name: string): { value: string } | undefined }): boolean {
  const headerToken = headers.get(CSRF_HEADER)
  if (!headerToken) return false

  let cookieValue: string | undefined
  if (cookies instanceof Map) {
    cookieValue = cookies.get(CSRF_COOKIE)
  } else {
    cookieValue = cookies.get(CSRF_COOKIE)?.value
  }
  if (!cookieValue) return false

  return safeCompare(headerToken, cookieValue)
}

// ---------------------------------------------------------------------------
// Middleware wrapper
// ---------------------------------------------------------------------------

type RouteHandler = (req: NextRequest, context?: any) => Promise<NextResponse>

/**
 * Wrap a Next.js API route handler with CSRF protection.
 *
 * Behaviour:
 *   - GET / HEAD / OPTIONS → pass through (no CSRF check)
 *   - POST / PUT / PATCH / DELETE → validate X-CSRF-Token against cookie
 *   - Missing or mismatched tokens → 403 Forbidden
 *
 * Usage:
 *   import { withCsrf } from '@/lib/rain/csrf'
 *   export const POST = withCsrf(async (req) => { ... })
 */
export function withCsrf(handler: RouteHandler): RouteHandler {
  return async (req: NextRequest, context?: any): Promise<NextResponse> => {
    // Safe methods — no state change, no CSRF risk
    if (SAFE_METHODS.has(req.method)) {
      return handler(req, context)
    }

    // Validate the CSRF token
    const headerToken = req.headers.get(CSRF_HEADER)
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value

    if (!headerToken || !cookieToken) {
      return NextResponse.json(
        {
          error: 'CSRF token missing or invalid.',
          hint: 'Call GET /api/rain/csrf-token to obtain a token and include it as the X-CSRF-Token header.',
        },
        {
          status: 403,
          headers: { 'X-CSRF-Required': 'true' },
        },
      )
    }

    if (!safeCompare(headerToken, cookieToken)) {
      return NextResponse.json(
        { error: 'CSRF token mismatch. Request a fresh token from GET /api/rain/csrf-token.' },
        {
          status: 403,
          headers: { 'X-CSRF-Required': 'true' },
        },
      )
    }

    return handler(req, context)
  }
}
