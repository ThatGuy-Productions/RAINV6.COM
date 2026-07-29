/**
 * RAIN V6 — Metadata validation tests
 *
 * Validates: ISRC format, UPC check digit, ISWC check digit, language/territory
 * lists include SA entries, PRO list includes SAMRO/CAPASSO/SAMPRA.
 *
 * Run: bun test tests/lib/metadata-validation.test.ts
 */

import { describe, expect, test } from 'bun:test'
import {
  validateIsrc,
  validateUpc,
  validateIswc,
  validateMetadata,
  LANGUAGE_OPTIONS,
  PRO_OPTIONS,
  TERRITORY_OPTIONS,
  GENRE_SUBGENRE_OPTIONS,
} from '../../src/lib/rain/metadata-validation'

// ---------------------------------------------------------------------------
// ISRC validation
// ---------------------------------------------------------------------------

describe('validateIsrc', () => {
  test('accepts valid ISRC with dashes', () => {
    expect(validateIsrc('US-ABC-24-00001')).toBe(true)
  })

  test('accepts valid ISRC without dashes', () => {
    expect(validateIsrc('USABC2400001')).toBe(true)
  })

  test('rejects empty string', () => {
    expect(validateIsrc('')).toBe(false)
    expect(validateIsrc(undefined as unknown as string)).toBe(false)
  })

  test('rejects too-short ISRC', () => {
    expect(validateIsrc('US-ABC-24-001')).toBe(false)
  })

  test('rejects invalid country code (numeric)', () => {
    expect(validateIsrc('12-ABC-24-00001')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UPC validation (12-digit EAN-13 without leading zero)
// ---------------------------------------------------------------------------

describe('validateUpc', () => {
  test('accepts valid UPC with correct check digit', () => {
    // 012345678905 — known valid EAN-13, UPC is last 12
    expect(validateUpc('123456789059')).toBe(true)
  })

  test('rejects short UPC', () => {
    expect(validateUpc('123456')).toBe(false)
  })

  test('rejects UPC with letters', () => {
    expect(validateUpc('1234567890AB')).toBe(false)
  })

  test('rejects UPC with wrong check digit', () => {
    expect(validateUpc('123456789050')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ISWC validation
// ---------------------------------------------------------------------------

describe('validateIswc', () => {
  test('accepts valid ISWC', () => {
    // T-034.524.680-1 is a well-known test ISWC
    expect(validateIswc('T-034.524.680-1')).toBe(true)
  })

  test('rejects malformed ISWC', () => {
    expect(validateIswc('ISWC-123')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(validateIswc('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Metadata validation
// ---------------------------------------------------------------------------

describe('validateMetadata', () => {
  test('returns errors for missing title and artist', () => {
    const issues = validateMetadata({} as any)
    expect(issues.length).toBeGreaterThanOrEqual(2)
    const fields = issues.map((i) => i.field)
    expect(fields).toContain('title')
    expect(fields).toContain('artist')
  })

  test('returns no errors for valid minimal metadata', () => {
    const issues = validateMetadata({
      title: 'Test Track',
      artist: 'Test Artist',
    } as any)
    expect(issues).toEqual([])
  })

  test('flags invalid ISRC', () => {
    const issues = validateMetadata({
      title: 'Test',
      artist: 'Artist',
      isrc: 'bad',
    } as any)
    expect(issues.some((i) => i.field === 'isrc')).toBe(true)
  })

  test('flags invalid UPC', () => {
    const issues = validateMetadata({
      title: 'Test',
      artist: 'Artist',
      upc: 'not-valid',
    } as any)
    expect(issues.some((i) => i.field === 'upc')).toBe(true)
  })

  test('flags bad release date format', () => {
    const issues = validateMetadata({
      title: 'Test',
      artist: 'Artist',
      releaseDate: '01-01-2024',
    } as any)
    expect(issues.some((i) => i.field === 'releaseDate')).toBe(true)
  })

  test('accepts YYYY-MM-DD release date', () => {
    const issues = validateMetadata({
      title: 'Test',
      artist: 'Artist',
      releaseDate: '2024-01-15',
    } as any)
    expect(issues.some((i) => i.field === 'releaseDate')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SA-first data: all 3 confirmed gaps are closed
// ---------------------------------------------------------------------------

describe('South African metadata coverage', () => {
  test('SAMRO is in PRO_OPTIONS (audit bug #1)', () => {
    const samro = PRO_OPTIONS.find((o) => o.value === 'SAMRO')
    expect(samro).toBeDefined()
    expect(samro!.label).toContain('South Africa')
  })

  test('CAPASSO is in PRO_OPTIONS', () => {
    const capasso = PRO_OPTIONS.find((o) => o.value === 'CAPASSO')
    expect(capasso).toBeDefined()
  })

  test('SAMPRA is in PRO_OPTIONS', () => {
    const sampra = PRO_OPTIONS.find((o) => o.value === 'SAMPRA')
    expect(sampra).toBeDefined()
  })

  test('Afrikaans is in LANGUAGE_OPTIONS (audit bug #2)', () => {
    const afr = LANGUAGE_OPTIONS.find((l) => l.value === 'afr')
    expect(afr).toBeDefined()
    expect(afr!.label).toBe('Afrikaans')
  })

  test('isiZulu is in LANGUAGE_OPTIONS', () => {
    const zul = LANGUAGE_OPTIONS.find((l) => l.value === 'zul')
    expect(zul).toBeDefined()
  })

  test('isiXhosa is in LANGUAGE_OPTIONS', () => {
    const xho = LANGUAGE_OPTIONS.find((l) => l.value === 'xho')
    expect(xho).toBeDefined()
  })

  test('Sesotho is in LANGUAGE_OPTIONS', () => {
    const sot = LANGUAGE_OPTIONS.find((l) => l.value === 'sot')
    expect(sot).toBeDefined()
  })

  test('South Africa (ZA) is in TERRITORY_OPTIONS (audit bug #1 — was already present)', () => {
    const za = TERRITORY_OPTIONS.find((t) => t.value === 'ZA')
    expect(za).toBeDefined()
    expect(za!.label).toBe('South Africa')
  })

  test('Nigeria (NG) is in TERRITORY_OPTIONS', () => {
    const ng = TERRITORY_OPTIONS.find((t) => t.value === 'NG')
    expect(ng).toBeDefined()
  })

  test('Amapiano is in GENRE_SUBGENRE_OPTIONS (audit bug #4)', () => {
    const amapiano = GENRE_SUBGENRE_OPTIONS.find((g) => g.genre === 'Amapiano')
    expect(amapiano).toBeDefined()
    expect(amapiano!.subgenres.length).toBeGreaterThanOrEqual(3)
  })

  test('Gospel is in GENRE_SUBGENRE_OPTIONS (audit bug #4)', () => {
    const gospel = GENRE_SUBGENRE_OPTIONS.find((g) => g.genre === 'Gospel')
    expect(gospel).toBeDefined()
    expect(gospel!.subgenres.length).toBeGreaterThanOrEqual(3)
  })

  test('Afro House and Gqom are World subgenres', () => {
    const world = GENRE_SUBGENRE_OPTIONS.find((g) => g.genre === 'World')
    expect(world!.subgenres).toContain('Gqom')
    expect(world!.subgenres).toContain('Afro House')
  })

  test('Amapiano appears as an Electronic subgenre', () => {
    const electronic = GENRE_SUBGENRE_OPTIONS.find((g) => g.genre === 'Electronic')
    expect(electronic!.subgenres).toContain('Amapiano')
  })
})
