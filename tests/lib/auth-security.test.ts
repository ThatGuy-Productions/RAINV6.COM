import { describe, expect, it } from 'bun:test'
import { NextRequest } from 'next/server'
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearCookieHeader,
  hashPassword,
  sessionCookieHeader,
  verifyPassword,
} from '../../src/lib/rain/auth'

describe('authentication primitives', () => {
  it('stores salted scrypt hashes and verifies only the correct password', () => {
    const stored = hashPassword('correct-horse-battery-staple')
    expect(stored).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/)
    expect(stored).not.toBe(hashPassword('correct-horse-battery-staple'))
    expect(verifyPassword('correct-horse-battery-staple', stored)).toBe(true)
    expect(verifyPassword('wrong-password', stored)).toBe(false)
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(verifyPassword('anything', 'scrypt$$broken')).toBe(false)
  })

  it('sets secure cross-site cookies for HTTPS requests with a bounded session lifetime', () => {
    const request = new NextRequest('https://rainv6.com/api/rain/auth/login')
    const cookie = sessionCookieHeader('test-session-token', request)

    expect(cookie).toContain(`${SESSION_COOKIE}=test-session-token`)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
  })

  it('does not treat a spoof-like forwarded protocol value as HTTPS', () => {
    const request = new NextRequest('http://localhost:3000/api/rain/auth/login', {
      headers: { 'x-forwarded-proto': 'nothttps' },
    })
    const cookie = sessionCookieHeader('test-session-token', request)

    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('; Secure')
  })

  it('clears the same cookie attributes used by the session cookie', () => {
    const request = new NextRequest('https://rainv6.com/api/rain/auth/logout')
    const cookie = clearCookieHeader(request)

    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
  })
})
