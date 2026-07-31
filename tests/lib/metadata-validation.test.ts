/**
 * RAIN V6 — Metadata Validation Tests
 *
 * Tests for the metadata validation logic used in the DDEX ERN 4.3.2
 * manifest generation and the RAIN-CERT provenance certificate.
 */
import { describe, it, expect } from 'vitest'
import { validateMetadata } from '@/lib/rain/metadata-validation'

describe('Metadata Validation', () => {
  it('flags missing title', () => {
    const issues = validateMetadata({ title: '', artist: 'Test Artist' })
    expect(issues.some((i) => i.field === 'title')).toBe(true)
  })

  it('flags missing artist', () => {
    const issues = validateMetadata({ title: 'Test Track', artist: '' })
    expect(issues.some((i) => i.field === 'artist')).toBe(true)
  })

  it('flags invalid ISRC format', () => {
    const issues = validateMetadata({ title: 'T', artist: 'A', isrc: 'INVALID' })
    expect(issues.some((i) => i.field === 'isrc')).toBe(true)
  })

  it('flags invalid UPC format', () => {
    const issues = validateMetadata({ title: 'T', artist: 'A', upc: '123' })
    expect(issues.some((i) => i.field === 'upc')).toBe(true)
  })

  it('returns an array of issues', () => {
    const issues = validateMetadata({ title: 'Test', artist: 'Artist' })
    expect(Array.isArray(issues)).toBe(true)
  })

  it('each issue has a field and message', () => {
    const issues = validateMetadata({ title: '', artist: '' })
    for (const issue of issues) {
      expect(issue.field).toBeDefined()
      expect(issue.message).toBeDefined()
    }
  })
})
