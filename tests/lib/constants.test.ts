/**
 * RAIN V6 — Constants Tests
 *
 * Tests for the core constants used across the mastering pipeline.
 */
import { describe, it, expect } from 'vitest'
import {
  PLATFORM_TARGETS,
  GENRES,
  MACROS,
  PIPELINE_STAGES,
  QC_CHECK_NAMES,
  STEM_KEYS,
  PRICING_TIERS,
} from '@/lib/rain/constants'

describe('Constants', () => {
  describe('PLATFORM_TARGETS', () => {
    it('contains at least one platform target', () => {
      expect(PLATFORM_TARGETS.length).toBeGreaterThan(0)
    })

    it('each target has a slug and targetLufs', () => {
      for (const target of PLATFORM_TARGETS) {
        expect(target.slug).toBeDefined()
        expect(typeof target.targetLufs).toBe('number')
      }
    })
  })

  describe('GENRES', () => {
    it('contains at least 5 genres', () => {
      expect(GENRES.length).toBeGreaterThanOrEqual(5)
    })

    it('all genres are strings', () => {
      for (const genre of GENRES) {
        expect(typeof genre).toBe('string')
        expect(genre.length).toBeGreaterThan(0)
      }
    })
  })

  describe('MACROS', () => {
    it('contains 7 macros', () => {
      expect(MACROS).toHaveLength(7)
    })

    it('each macro has a key and label', () => {
      for (const macro of MACROS) {
        expect(macro.key).toBeDefined()
        expect(macro.label).toBeDefined()
      }
    })
  })

  describe('PIPELINE_STAGES', () => {
    it('contains 16 stages', () => {
      expect(PIPELINE_STAGES).toHaveLength(16)
    })
  })

  describe('QC_CHECK_NAMES', () => {
    it('contains at least 10 checks', () => {
      expect(QC_CHECK_NAMES.length).toBeGreaterThanOrEqual(10)
    })
  })

  describe('STEM_KEYS', () => {
    it('contains 12 stems', () => {
      expect(STEM_KEYS).toHaveLength(12)
    })
  })

  describe('PRICING_TIERS', () => {
    it('contains at least one tier', () => {
      expect(PRICING_TIERS.length).toBeGreaterThan(0)
    })

    it('each tier has a name', () => {
      for (const tier of PRICING_TIERS) {
        expect(tier.name).toBeDefined()
      }
    })
  })
})
