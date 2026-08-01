/**
 * RAIN V6 — DSP Utility Tests
 *
 * Tests for the core DSP functions in the audio processing pipeline.
 * Note: computeRms and computePeak return dBFS values, not linear.
 */
import { describe, it, expect }
import { seededRandom } from '../helpers/seeded-random' from 'vitest'
import {
  computeLufs,
  computeTruePeak,
  computeRms,
  computePeak,
  midSideEncode,
  midSideDecode,
  computeCorrelation,
  stereoWidthRatio,
} from '@/lib/rain/dsp'

describe('DSP Utilities', () => {
  describe('computeRms', () => {
    it('returns ~0 dBFS for a full-scale DC signal', () => {
      const signal = new Float32Array(1024).fill(1.0)
      const rmsDb = computeRms(signal)
      expect(rmsDb).toBeCloseTo(0, 1)
    })

    it('returns ~-6 dBFS for a half-scale DC signal', () => {
      const signal = new Float32Array(1024).fill(0.5)
      const rmsDb = computeRms(signal)
      expect(rmsDb).toBeCloseTo(-6.02, 1)
    })

    it('returns -200 for silence (dBFS floor)', () => {
      const signal = new Float32Array(1024).fill(0)
      const rmsDb = computeRms(signal)
      expect(rmsDb).toBeLessThan(-100)
    })
  })

  describe('computePeak', () => {
    it('returns ~0 dBFS for a full-scale signal', () => {
      const signal = new Float32Array(1024).fill(1.0)
      expect(computePeak(signal)).toBeCloseTo(0, 1)
    })

    it('returns ~-6 dBFS for a half-scale signal', () => {
      const signal = new Float32Array(1024).fill(0.5)
      expect(computePeak(signal)).toBeCloseTo(-6.02, 1)
    })
  })

  describe('computeLufs', () => {
    it('returns a finite number for a sine wave', () => {
      const sampleRate = 48000
      const signal = new Float32Array(sampleRate)
      for (let i = 0; i < sampleRate; i++) {
        signal[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5
      }
      const lufs = computeLufs([signal, signal], sampleRate)
      expect(isFinite(lufs)).toBe(true)
      expect(lufs).toBeLessThan(0)
    })
  })

  describe('computeTruePeak', () => {
    it('returns a finite value for a sine wave', () => {
      const sampleRate = 48000
      const signal = new Float32Array(sampleRate)
      for (let i = 0; i < sampleRate; i++) {
        signal[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5
      }
      const tp = computeTruePeak(signal)
      expect(isFinite(tp)).toBe(true)
    })
  })

  describe('midSideEncode / midSideDecode', () => {
    it('round-trips correctly', () => {
      const left = new Float32Array(100)
      const right = new Float32Array(100)
      for (let i = 0; i < 100; i++) {
        left[i] = seededRandom(42) * 0.5
        right[i] = seededRandom(42) * 0.5
      }
      const { mid, side } = midSideEncode(left, right)
      const decoded = midSideDecode(mid, side)
      for (let i = 0; i < 100; i++) {
        expect(decoded.left[i]).toBeCloseTo(left[i], 5)
        expect(decoded.right[i]).toBeCloseTo(right[i], 5)
      }
    })
  })

  describe('computeCorrelation', () => {
    it('returns 1 for identical signals', () => {
      const signal = new Float32Array(100)
      for (let i = 0; i < 100; i++) signal[i] = Math.sin(i * 0.1)
      const corr = computeCorrelation(signal, signal)
      expect(corr).toBeCloseTo(1.0, 2)
    })
  })

  describe('stereoWidthRatio', () => {
    it('returns a value between 0 and 1', () => {
      const left = new Float32Array(100)
      const right = new Float32Array(100)
      for (let i = 0; i < 100; i++) {
        left[i] = seededRandom(42) * 0.5
        right[i] = seededRandom(42) * 0.5
      }
      const width = stereoWidthRatio(left, right)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(1)
    })
  })
})
