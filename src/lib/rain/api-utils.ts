/**
 * RAIN V6 — API Reliability Utilities (Phase 5)
 *
 * Typed response helpers, request validation, structured error handling,
 * and request logging for API routes. These are drop-in wrappers that
 * add observability and consistency without changing business logic.
 *
 * Usage:
 *   import { apiSuccess, apiError, withErrorHandler, validateRequest, logApiRequest } from '@/lib/rain/api-utils'
 */

import { NextResponse, NextRequest } from 'next/server'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// 1. Typed API response helpers
// ---------------------------------------------------------------------------

type RouteHandler = (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse> | Promise<Response>

interface ApiSuccessEnvelope<T> {
  ok: true
  data: T
}

interface ApiErrorEnvelope {
  ok: false
  error: string
  stage?: string
}

interface ApiValidationErrorEnvelope {
  ok: false
  error: string
  errors: string[]
}

/**
 * Return a structured success response.
 *
 * ```ts
 * return apiSuccess({ sessionId: 'abc' }, 201)
 * ```
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  const body: ApiSuccessEnvelope<T> = { ok: true, data }
  return NextResponse.json(body, { status })
}

/**
 * Return a structured error response.
 *
 * `stage` is optional — use it to tag where in the pipeline the error
 * occurred (e.g. "validation", "db_write", "auth") for easier log filtering.
 *
 * ```ts
 * return apiError('Invalid session', 401, 'auth')
 * ```
 */
export function apiError(error: string, status: number, stage?: string): NextResponse {
  const body: ApiErrorEnvelope = { ok: false, error, ...(stage ? { stage } : {}) }
  return NextResponse.json(body, { status })
}

/**
 * Return a structured validation-error response (422).
 *
 * ```ts
 * return apiValidationError(['Name is required', 'Rating must be 1-5'])
 * ```
 */
export function apiValidationError(errors: string[]): NextResponse {
  const body: ApiValidationErrorEnvelope = {
    ok: false,
    error: 'Validation failed',
    errors,
  }
  return NextResponse.json(body, { status: 422 })
}

// ---------------------------------------------------------------------------
// 2. Request validation helper
// ---------------------------------------------------------------------------

/**
 * Validate a request body against a Zod schema.
 *
 * Returns `{ data: T }` on success, or `{ error: string }` on failure.
 * The caller decides how to respond — typically by returning
 * `apiValidationError` or `apiError`.
 *
 * ```ts
 * const result = validateRequest(body, z.object({ email: z.string().email() }))
 * if ('error' in result) return apiError(result.error, 400, 'validation')
 * const { email } = result.data
 * ```
 */
export function validateRequest<T>(
  body: unknown,
  schema: z.ZodType<T>,
): { data: T } | { error: string } {
  const result = schema.safeParse(body)
  if (result.success) {
    return { data: result.data }
  }
  // Zod v4: error.issues is the standard field for validation issues
  const messages = result.error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') + ': ' : ''
    return `${path}${i.message}`
  })
  return { error: messages.join('; ') }
}

// ---------------------------------------------------------------------------
// 3. Structured error handler — wrapper for API routes
// ---------------------------------------------------------------------------

/**
 * Wrap an API route handler with structured error handling.
 *
 * Catches any unhandled exception and returns a consistent 500 response
 * with the error message. Also logs the error with the route path for
 * observability.
 *
 * ```ts
 * export const POST = withErrorHandler(async (req: NextRequest) => {
 *   // ... business logic — throw/let errors propagate naturally
 *   return apiSuccess({ id: '123' }, 201)
 * })
 * ```
 */
export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, context) => {
    const start = Date.now()
    try {
      const result = await handler(req, context)
      // Log successful requests
      const method = req.method ?? 'UNKNOWN'
      const path = req.nextUrl?.pathname ?? 'unknown'
      const durationMs = Date.now() - start
      logApiRequest(method, path, 200, durationMs)
      return result
    } catch (err) {
      const method = req.method ?? 'UNKNOWN'
      const path = req.nextUrl?.pathname ?? 'unknown'
      const durationMs = Date.now() - start

      const message = err instanceof Error ? err.message : 'Internal server error'
      console.error(`[api] ${method} ${path} failed (${durationMs}ms):`, err)

      logApiRequest(method, path, 500, durationMs)
      return apiError(message, 500, 'unhandled')
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Request logging
// ---------------------------------------------------------------------------

/** In-memory log buffer for the most recent API requests (for admin dashboards). */
interface ApiLogEntry {
  method: string
  path: string
  status: number
  durationMs: number
  timestamp: number
}

const MAX_LOG_ENTRIES = 500
const apiLogBuffer: ApiLogEntry[] = []

/**
 * Log an API request for observability.
 *
 * Stores the last 500 requests in memory (capped, no unbounded growth).
 * This is a lightweight, single-instance solution — for multi-instance
 * deploys, ship to a structured log aggregator instead.
 */
export function logApiRequest(method: string, path: string, status: number, durationMs: number): void {
  apiLogBuffer.push({
    method,
    path,
    status,
    durationMs,
    timestamp: Date.now(),
  })
  // Cap the buffer to prevent unbounded memory growth
  if (apiLogBuffer.length > MAX_LOG_ENTRIES) {
    apiLogBuffer.splice(0, apiLogBuffer.length - MAX_LOG_ENTRIES)
  }
}

/**
 * Retrieve recent API request logs (for admin dashboards / diagnostics).
 * Returns the last N entries, newest first.
 */
export function getRecentApiLogs(limit = 50): ApiLogEntry[] {
  return apiLogBuffer.slice(-limit).reverse()
}
