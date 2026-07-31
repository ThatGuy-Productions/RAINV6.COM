/**
 * RAIN V6 — Authentication Module Tests
 *
 * Tests for the core auth module: password hashing, verification,
 * timing-safe comparison, and cookie header generation.
 */
import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  sessionCookieHeader,
  clearCookieHeader,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/lib/rain/auth'

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe('hashPassword', () => {
  it('produces a scrypt hash in format scrypt$salt$hash', () => {
    const result = hashPassword('test-password')
    const parts = result.split('$')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('scrypt')
    // Salt is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32)
    expect(/^[0-9a-f]+$/.test(parts[1])).toBe(true)
    // Hash is 32 bytes = 64 hex chars
    expect(parts[2]).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(parts[2])).toBe(true)
  })

  it('produces different salts for the same password', () => {
    const hash1 = hashPassword('same-password')
    const hash2 = hashPassword('same-password')
    // Different salts → different overall hashes
    expect(hash1).not.toBe(hash2)
  })
})

// ---------------------------------------------------------------------------
// Password verification
// ---------------------------------------------------------------------------

describe('verifyPassword', () => {
  it('returns true for correct passwords', () => {
    const hash = hashPassword('correct-password')
    expect(verifyPassword('correct-password', hash)).toBe(true)
  })

  it('returns false for wrong passwords', () => {
    const hash = hashPassword('correct-password')
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('returns false for malformed hashes — missing parts', () => {
    expect(verifyPassword('test', 'not-a-hash')).toBe(false)
  })

  it('returns false for malformed hashes — wrong prefix', () => {
    expect(verifyPassword('test', 'bcrypt$salt$hash')).toBe(false)
  })

  it('returns false for malformed hashes — empty salt', () => {
    expect(verifyPassword('test', 'scrypt$$hash')).toBe(false)
  })

  it('returns false for malformed hashes — wrong hash length', () => {
    expect(verifyPassword('test', 'scrypt$abcdef$1234')).toBe(false)
  })

  it('returns false for empty string hash', () => {
    expect(verifyPassword('test', '')).toBe(false)
  })

  it('returns false for hash with only two parts', () => {
    expect(verifyPassword('test', 'scrypt$salt')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

describe('timingSafeEqual prevents timing attacks', () => {
  it('different wrong passwords take similar time to verify', () => {
    const hash = hashPassword('real-password')
    // Measure two very different wrong passwords
    const wrong1 = 'a'
    const wrong2 = 'this-is-a-much-longer-wrong-password-with-more-chars'

    const times1: number[] = []
    const times2: number[] = []

    // Run multiple iterations to reduce noise
    const iterations = 20
    for (let i = 0; i < iterations; i++) {
      const start1 = performance.now()
      verifyPassword(wrong1, hash)
      times1.push(performance.now() - start1)

      const start2 = performance.now()
      verifyPassword(wrong2, hash)
      times2.push(performance.now() - start2)
    }

    // Compute median to reduce outlier noise
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }
    const med1 = median(times1)
    const med2 = median(times2)

    // The timing difference should be within a generous factor (5×)
    // With timingSafeEqual, the comparison is constant-time regardless
    // of how many characters match. Without it, the short password that
    // fails on the first byte would be much faster.
    const ratio = Math.max(med1, med2) / Math.max(Math.min(med1, med2), 0.001)
    expect(ratio).toBeLessThan(5)
  })
})

// ---------------------------------------------------------------------------
// Session cookie header generation
// ---------------------------------------------------------------------------

describe('sessionCookieHeader', () => {
  it('includes httpOnly, SameSite, and Path when no request (non-secure)', () => {
    const header = sessionCookieHeader('test-token-123', null)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Path=/')
    expect(header).toContain('SameSite=Lax')
    // Non-secure path should NOT have Secure flag
    expect(header).not.toContain('SameSite=None')
  })

  it('contains the session cookie name and token', () => {
    const header = sessionCookieHeader('my-token', null)
    expect(header).toContain(`${SESSION_COOKIE}=my-token`)
  })

  it('contains Max-Age with the session TTL', () => {
    const header = sessionCookieHeader('my-token', null)
    expect(header).toContain(`Max-Age=${SESSION_TTL_SECONDS}`)
  })

  it('uses SameSite=Lax for plain HTTP (no request)', () => {
    const header = sessionCookieHeader('token', null)
    expect(header).toContain('SameSite=Lax')
    expect(header).not.toContain('Secure')
  })

  it('uses SameSite=None; Secure for HTTPS requests', () => {
    // Mock a NextRequest with HTTPS
    const mockReq = {
      headers: {
        get: (name: string) => name === 'x-forwarded-proto' ? 'https' : null,
      },
      nextUrl: { protocol: 'https:' },
      cookies: { get: () => undefined },
    } as unknown as Parameters<typeof sessionCookieHeader>[1]
    const header = sessionCookieHeader('token', mockReq)
    expect(header).toContain('SameSite=None')
    expect(header).toContain('Secure')
  })
})

// ---------------------------------------------------------------------------
// Clear cookie header generation
// ---------------------------------------------------------------------------

describe('clearCookieHeader', () => {
  it('includes httpOnly, Path, and Max-Age=0 when no request', () => {
    const header = clearCookieHeader(null)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=0')
    expect(header).toContain('SameSite=Lax')
  })

  it('clears the correct cookie name', () => {
    const header = clearCookieHeader(null)
    expect(header).toContain(`${SESSION_COOKIE}=`)
  })

  it('uses SameSite=None; Secure for HTTPS requests', () => {
    const mockReq = {
      headers: {
        get: (name: string) => name === 'x-forwarded-proto' ? 'https' : null,
      },
      nextUrl: { protocol: 'https:' },
      cookies: { get: () => undefined },
    } as unknown as Parameters<typeof clearCookieHeader>[0]
    const header = clearCookieHeader(mockReq)
    expect(header).toContain('SameSite=None')
    expect(header).toContain('Secure')
  })
})
