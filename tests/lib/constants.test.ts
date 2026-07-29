/**
 * RAIN V6 — Constants tests
 *
 * Validates: DSP_DELIVERY_PARTNERS is separate from PLATFORM_TARGETS,
 * GENRES includes amapiano and gospel, DSP list has no loudness-only entries.
 *
 * Run: bun test tests/lib/constants.test.ts
 */

import { describe, expect, test } from 'bun:test'
import {
  GENRES,
  PLATFORM_TARGETS,
  DSP_DELIVERY_PARTNERS,
  MACROS,
  TENSION_PAIRS,
  PIPELINE_STAGES,
  QC_CHECK_NAMES,
  STEM_KEYS,
} from '../../src/lib/rain/constants'

// ---------------------------------------------------------------------------
// GENRES — expanded, includes SA genres (audit bug #4)
// ---------------------------------------------------------------------------

describe('GENRES', () => {
  test('includes amapiano', () => {
    expect(GENRES).toContain('amapiano')
  })

  test('includes gospel', () => {
    expect(GENRES).toContain('gospel')
  })

  test('includes afrobeats', () => {
    expect(GENRES).toContain('afrobeats')
  })

  test('has at least 15 entries (was 12)', () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(15)
  })
})

// ---------------------------------------------------------------------------
// PLATFORM_TARGETS — 27 loudness targets (audit bug #3 context)
// ---------------------------------------------------------------------------

describe('PLATFORM_TARGETS', () => {
  test('has exactly 27 entries', () => {
    expect(PLATFORM_TARGETS.length).toBe(27)
  })

  test('all entries have required fields', () => {
    for (const p of PLATFORM_TARGETS) {
      expect(p.slug).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(typeof p.targetLufs).toBe('number')
      expect(typeof p.truePeakCeiling).toBe('number')
      expect(p.codec).toBeTruthy()
      expect(p.tier).toBeGreaterThanOrEqual(1)
    }
  })

  test('includes CD, vinyl, EBU R128, ATSC A/85, Podcast (loudness profiles)', () => {
    const slugs = PLATFORM_TARGETS.map((p) => p.slug)
    expect(slugs).toContain('cd')
    expect(slugs).toContain('vinyl')
    expect(slugs).toContain('broadcast_ebu')
    expect(slugs).toContain('broadcast_atsc')
    expect(slugs).toContain('podcast')
  })
})

// ---------------------------------------------------------------------------
// DSP_DELIVERY_PARTNERS — real DDEX delivery partners (audit bug #3 fix)
// ---------------------------------------------------------------------------

describe('DSP_DELIVERY_PARTNERS', () => {
  test('exists as a separate list from PLATFORM_TARGETS', () => {
    expect(DSP_DELIVERY_PARTNERS).toBeDefined()
    expect(DSP_DELIVERY_PARTNERS.length).toBeGreaterThan(0)
  })

  test('does NOT contain non-DDEX entries (CD, vinyl, broadcast, podcast)', () => {
    const slugs = DSP_DELIVERY_PARTNERS.map((p) => p.slug)
    expect(slugs).not.toContain('cd')
    expect(slugs).not.toContain('vinyl')
    expect(slugs).not.toContain('broadcast_ebu')
    expect(slugs).not.toContain('broadcast_atsc')
    expect(slugs).not.toContain('podcast')
  })

  test('includes real DSPs', () => {
    const slugs = DSP_DELIVERY_PARTNERS.map((p) => p.slug)
    expect(slugs).toContain('spotify')
    expect(slugs).toContain('apple_music')
    expect(slugs).toContain('youtube_music')
    expect(slugs).toContain('tidal')
    expect(slugs).toContain('deezer')
    expect(slugs).toContain('boomplay')
  })

  test('includes LabelGrid direct delivery', () => {
    expect(DSP_DELIVERY_PARTNERS.some((p) => p.slug === 'labelgrid')).toBe(true)
  })

  test('all entries have required fields', () => {
    for (const p of DSP_DELIVERY_PARTNERS) {
      expect(p.slug).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(typeof p.requiresIsrc).toBe('boolean')
      expect(typeof p.requiresUpc).toBe('boolean')
      expect(Array.isArray(p.territoryRestrictions)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Macros — 7 canonical
// ---------------------------------------------------------------------------

describe('MACROS', () => {
  test('has exactly 7 macros', () => {
    expect(MACROS.length).toBe(7)
  })

  test('each macro has a key, label, color, and default', () => {
    for (const m of MACROS) {
      expect(m.key).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(typeof m.default).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// Pipeline stages — 16
// ---------------------------------------------------------------------------

describe('PIPELINE_STAGES', () => {
  test('has exactly 16 stages', () => {
    expect(PIPELINE_STAGES.length).toBe(16)
  })

  test('stages are ordered 1-16', () => {
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      expect(PIPELINE_STAGES[i].id).toBe(i + 1)
    }
  })
})

// ---------------------------------------------------------------------------
// QC checks — 18
// ---------------------------------------------------------------------------

describe('QC_CHECK_NAMES', () => {
  test('has exactly 18 checks', () => {
    expect(QC_CHECK_NAMES.length).toBe(18)
  })

  test('each check has an id, name, category, and target', () => {
    for (const qc of QC_CHECK_NAMES) {
      expect(qc.id).toBeTruthy()
      expect(qc.name).toBeTruthy()
      expect(qc.category).toBeTruthy()
      expect(qc.target).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Stems — 12
// ---------------------------------------------------------------------------

describe('STEM_KEYS', () => {
  test('has exactly 12 stems', () => {
    expect(STEM_KEYS.length).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// Tension pairs — must reference real macros
// ---------------------------------------------------------------------------

describe('TENSION_PAIRS', () => {
  test('each pair references valid macro keys', () => {
    const validKeys = new Set(MACROS.map((m) => m.key))
    for (const pair of TENSION_PAIRS) {
      expect(validKeys.has(pair.keys[0])).toBe(true)
      expect(validKeys.has(pair.keys[1])).toBe(true)
    }
  })
})
