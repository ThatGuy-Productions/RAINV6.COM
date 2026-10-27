import { describe, expect, it } from 'bun:test'
import { verifyBootstrapSecret } from '../../src/lib/rain/bootstrap-secret'

describe('first-admin bootstrap secret', () => {
  it('is disabled when no sufficiently strong deployment secret is configured', () => {
    expect(verifyBootstrapSecret('anything', undefined)).toBe('disabled')
    expect(verifyBootstrapSecret('anything', '')).toBe('disabled')
    expect(verifyBootstrapSecret('anything', 'too-short')).toBe('disabled')
  })

  it('accepts only the exact configured secret', () => {
    const configured = 'rain-admin-bootstrap-secret-32chars!'
    expect(configured.length).toBeGreaterThanOrEqual(32)
    expect(verifyBootstrapSecret(configured, configured)).toBe('valid')
    expect(verifyBootstrapSecret('wrong-secret', configured)).toBe('invalid')
    expect(verifyBootstrapSecret(undefined, configured)).toBe('invalid')
    expect(verifyBootstrapSecret(42, configured)).toBe('invalid')
  })
})
