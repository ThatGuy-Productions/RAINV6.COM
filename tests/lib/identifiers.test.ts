/**
 * RAIN V6 — Identifier generation tests
 *
 * Validates: ISRC generation follows ISO 3901 format, UPC generation with
 * valid EAN-13 check digit.
 *
 * Run: bun test tests/lib/identifiers.test.ts
 */

import { describe, expect, test } from 'vitest'
import { generateIsrc, generateUpc } from '../../src/lib/rain/provenance'
import { validateIsrc, validateUpc } from '../../src/lib/rain/metadata-validation'

describe('generateIsrc', () => {
  test('produces a valid ISRC per ISO 3901', () => {
    // Run multiple times — ISRC contains random designation digits
    for (let i = 0; i < 20; i++) {
      const isrc = generateIsrc()
      expect(validateIsrc(isrc)).toBe(true)
    }
  })

  test('returns a string in the correct format', () => {
    const isrc = generateIsrc()
    // Format: CC-XXX-YY-NNNNN with dashes, or CCXXXYYNNNNN without
    expect(/^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(isrc.replace(/[-\s]/g, '').toUpperCase())).toBe(true)
  })
})

describe('generateUpc', () => {
  test('produces a valid UPC with correct EAN-13 check digit', () => {
    for (let i = 0; i < 20; i++) {
      const upc = generateUpc()
      expect(validateUpc(upc)).toBe(true)
    }
  })

  test('returns a 12-digit string', () => {
    for (let i = 0; i < 5; i++) {
      const upc = generateUpc()
      expect(upc).toMatch(/^\d{12}$/)
    }
  })
})
