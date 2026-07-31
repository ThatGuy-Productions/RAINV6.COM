/**
 * RAIN V6 — API Request/Response Validation Tests
 *
 * Tests for the API utility functions (validateRequest, apiSuccess, apiError,
 * apiValidationError) and input sanitization patterns used across the API layer.
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  validateRequest,
  apiSuccess,
  apiError,
  apiValidationError,
  logApiRequest,
  getRecentApiLogs,
} from '@/lib/rain/api-utils'
import {
  sanitizeText,
  sanitizeMetadataField,
  encodeHtml,
  hasXssPatterns,
} from '@/lib/rain/sanitize'

// ---------------------------------------------------------------------------
// Request body validation (validateRequest)
// ---------------------------------------------------------------------------

describe('validateRequest', () => {
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })

  it('returns { data } for valid request bodies', () => {
    const result = validateRequest(
      { email: 'user@example.com', password: 'securepassword' },
      loginSchema,
    )
    expect('data' in result).toBe(true)
    if ('data' in result) {
      expect(result.data.email).toBe('user@example.com')
      expect(result.data.password).toBe('securepassword')
    }
  })

  it('returns { error } for invalid request bodies', () => {
    const result = validateRequest(
      { email: 'not-an-email', password: 'short' },
      loginSchema,
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBeTruthy()
    }
  })

  it('returns { error } for missing required fields', () => {
    const result = validateRequest({}, loginSchema)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('email')
    }
  })

  it('returns { error } for null/undefined input', () => {
    const result = validateRequest(null, loginSchema)
    expect('error' in result).toBe(true)
  })

  it('returns { error } for wrong types', () => {
    const schema = z.object({ count: z.number() })
    const result = validateRequest({ count: 'not-a-number' }, schema)
    expect('error' in result).toBe(true)
  })

  it('validates nested objects', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number(),
      }),
    })
    const result = validateRequest({ user: { name: 'Test', age: 25 } }, schema)
    expect('data' in result).toBe(true)
  })

  it('validates arrays', () => {
    const schema = z.object({
      items: z.array(z.string()).min(1),
    })
    const result = validateRequest({ items: [] }, schema)
    expect('error' in result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Invalid JSON handling (simulated at the API route level)
// ---------------------------------------------------------------------------

describe('invalid JSON body handling', () => {
  it('returns 400 for malformed JSON', () => {
    // Simulate what an API route handler does when JSON.parse fails
    const badJson = '{ not valid json }'
    let parsed: unknown
    try {
      parsed = JSON.parse(badJson)
    } catch {
      parsed = null
    }
    const schema = z.object({ name: z.string() })
    const result = validateRequest(parsed, schema)
    expect('error' in result).toBe(true)
  })

  it('returns 400 for empty body', () => {
    const schema = z.object({ name: z.string() })
    const result = validateRequest(undefined, schema)
    expect('error' in result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Structured error responses
// ---------------------------------------------------------------------------

describe('apiError', () => {
  it('returns a response with { ok: false, error: string }', async () => {
    const response = apiError('Invalid session', 401, 'auth')
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Invalid session')
    expect(response.status).toBe(401)
  })

  it('includes optional stage field', async () => {
    const response = apiError('DB write failed', 500, 'db_write')
    const body = await response.json()
    expect(body.stage).toBe('db_write')
  })

  it('omits stage when not provided', async () => {
    const response = apiError('Something went wrong', 500)
    const body = await response.json()
    expect(body.stage).toBeUndefined()
  })

  it('returns correct status code', () => {
    const r400 = apiError('Bad request', 400)
    expect(r400.status).toBe(400)
    const r404 = apiError('Not found', 404)
    expect(r404.status).toBe(404)
    const r500 = apiError('Internal error', 500)
    expect(r500.status).toBe(500)
  })
})

describe('apiValidationError', () => {
  it('returns 422 with { ok: false, error, errors }', async () => {
    const response = apiValidationError(['Name is required', 'Rating must be 1-5'])
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Validation failed')
    expect(body.errors).toEqual(['Name is required', 'Rating must be 1-5'])
    expect(response.status).toBe(422)
  })
})

describe('apiSuccess', () => {
  it('returns 200 with { ok: true, data }', async () => {
    const response = apiSuccess({ sessionId: 'abc123' })
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({ sessionId: 'abc123' })
    expect(response.status).toBe(200)
  })

  it('supports custom status codes', () => {
    const response = apiSuccess({ id: 'new' }, 201)
    expect(response.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Sanitization applied to user inputs
// ---------------------------------------------------------------------------

describe('input sanitization in API context', () => {
  it('rejects XSS patterns in user-submitted text', () => {
    const result = sanitizeText('<script>alert("xss")</script>')
    expect(result.rejected).toBe(true)
  })

  it('encodes HTML entities in user input', () => {
    const result = sanitizeText('Hello <b>World</b>', { stripHtml: false, rejectXss: false })
    expect(result.sanitized).toContain('&lt;')
    expect(result.sanitized).toContain('&gt;')
  })

  it('strips HTML tags from user input', () => {
    const result = sanitizeText('Hello <b>World</b>', { encodeHtml: false, rejectXss: false })
    expect(result.sanitized).toBe('Hello World')
  })

  it('enforces max length on metadata fields', () => {
    const result = sanitizeMetadataField('a'.repeat(600))
    expect(result.sanitized.length).toBeLessThanOrEqual(500)
  })

  it('detects javascript: URLs', () => {
    expect(hasXssPatterns('javascript:alert(1)')).toBe(true)
  })

  it('detects event handlers', () => {
    expect(hasXssPatterns('<img onerror="alert(1)">')).toBe(true)
  })

  it('allows safe text content', () => {
    const result = sanitizeText('This is a normal review comment.')
    expect(result.rejected).toBe(false)
    expect(result.sanitized).toBe('This is a normal review comment.')
  })

  it('encodes special characters for safe output', () => {
    expect(encodeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
    expect(encodeHtml('5 < 10')).toBe('5 &lt; 10')
  })
})

// ---------------------------------------------------------------------------
// API request logging
// ---------------------------------------------------------------------------

describe('API request logging', () => {
  it('logApiRequest stores entries', () => {
    logApiRequest('POST', '/api/rain/render', 200, 150)
    logApiRequest('GET', '/api/rain/stats', 200, 30)
    const logs = getRecentApiLogs(10)
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })

  it('getRecentApiLogs returns newest first', () => {
    const before = getRecentApiLogs(10)
    const lenBefore = before.length
    logApiRequest('DELETE', '/api/rain/test', 204, 5)
    const after = getRecentApiLogs(10)
    // The newest entry should be the one we just added
    expect(after[0].method).toBe('DELETE')
    expect(after[0].path).toBe('/api/rain/test')
  })

  it('log entries have correct structure', () => {
    logApiRequest('GET', '/api/rain/test-structure', 200, 42)
    const logs = getRecentApiLogs(1)
    const entry = logs[0]
    expect(entry).toHaveProperty('method')
    expect(entry).toHaveProperty('path')
    expect(entry).toHaveProperty('status')
    expect(entry).toHaveProperty('durationMs')
    expect(entry).toHaveProperty('timestamp')
  })
})
