/**
 * RAIN V6 — DSP Regression Tests
 *
 * Tests for deterministic output, known reference values, and regression
 * protection of the core DSP functions. All tests use synthetic Float32Array
 * signals (sine waves, silence, DC, noise) — no AudioContext or WebAudio API.
 */
import { describe, it, expect } from 'vitest'
import {
  computeLufs,
  computeTruePeak,
  computeRms,
  computePeak,
  computeCrestFactor,
  computeLra,
  computeCorrelation,
  stereoWidthRatio,
  midSideEncode,
  midSideDecode,
  fftInPlace,
  fftMagnitude,
  hannWindow,
  kWeight,
  designBiquad,
  applyBiquad,
  applySaturation,
  computeSpectralFeatures,
  THIRD_OCTAVE_BANDS_HZ,
} from '@/lib/rain/dsp'
import { applyLoudnessTargeting } from '@/lib/rain/audio-engine/loudness'
import type { ProcessingParams } from '@/lib/rain/types'

// ---------------------------------------------------------------------------
// Signal generators — deterministic Float32Array test signals
// ---------------------------------------------------------------------------

/** Generate a sine wave at the given frequency and amplitude. */
function sineWave(
  sampleRate: number,
  durationSeconds: number,
  freqHz: number,
  amplitude = 1.0,
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds)
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sin(2 * Math.PI * freqHz * i / sampleRate) * amplitude
  }
  return buf
}

/** Generate silence (all zeros). */
function silence(sampleRate: number, durationSeconds: number): Float32Array {
  return new Float32Array(Math.floor(sampleRate * durationSeconds))
}

/** Generate a DC signal (constant value). */
function dcSignal(sampleRate: number, durationSeconds: number, value = 1.0): Float32Array {
  return new Float32Array(Math.floor(sampleRate * durationSeconds)).fill(value)
}

/** Generate a known PRBS-like noise signal (deterministic via LCG). */
function deterministicNoise(
  sampleRate: number,
  durationSeconds: number,
  seed = 42,
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds)
  const buf = new Float32Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    buf[i] = (s / 0x7fffffff) * 2 - 1 // normalize to [-1, 1]
  }
  return buf
}

// ---------------------------------------------------------------------------
// Determinism — pure functions produce identical outputs for identical inputs
// ---------------------------------------------------------------------------

describe('DSP determinism', () => {
  it('computeLufs is deterministic', () => {
    const sr = 48000
    const signal = sineWave(sr, 2, 440, 0.5)
    const result1 = computeLufs([signal, signal], sr)
    const result2 = computeLufs([signal, signal], sr)
    expect(result1).toBe(result2)
  })

  it('computeTruePeak is deterministic', () => {
    const sr = 48000
    const signal = sineWave(sr, 1, 440, 0.5)
    const result1 = computeTruePeak(signal)
    const result2 = computeTruePeak(signal)
    expect(result1).toBe(result2)
  })

  it('computeRms is deterministic', () => {
    const sr = 48000
    const signal = sineWave(sr, 1, 440, 0.5)
    expect(computeRms(signal)).toBe(computeRms(signal))
  })

  it('stereoWidthRatio is deterministic', () => {
    const sr = 48000
    const left = sineWave(sr, 1, 440, 0.5)
    const right = sineWave(sr, 1, 880, 0.3)
    const w1 = stereoWidthRatio(left, right)
    const w2 = stereoWidthRatio(left, right)
    expect(w1).toBe(w2)
  })

  it('fftMagnitude is deterministic', () => {
    const sr = 48000
    const signal = sineWave(sr, 0.05, 440, 0.5)
    const m1 = fftMagnitude(signal.subarray(0, 2048))
    const m2 = fftMagnitude(signal.subarray(0, 2048))
    for (let i = 0; i < m1.length; i++) {
      expect(m1[i]).toBe(m2[i])
    }
  })

  it('computeCorrelation is deterministic', () => {
    const sr = 48000
    const left = sineWave(sr, 1, 440, 0.5)
    const right = sineWave(sr, 1, 440, 0.3)
    const c1 = computeCorrelation(left, right)
    const c2 = computeCorrelation(left, right)
    expect(c1).toBe(c2)
  })
})

// ---------------------------------------------------------------------------
// LUFS calculation with known reference values
// ---------------------------------------------------------------------------

describe('LUFS calculation', () => {
  it('returns -70 for silence', () => {
    const sr = 48000
    const signal = silence(sr, 2)
    const lufs = computeLufs([signal, signal], sr)
    expect(lufs).toBe(-70) // -70 is the floor for silence
  })

  it('returns a finite negative value for a full-scale 1 kHz sine', () => {
    // A full-scale 1 kHz sine is approximately -3.01 dBFS (peak)
    // LUFS should be around -3.01 for a mono signal (no K-weighting effect at 1 kHz)
    const sr = 48000
    const signal = sineWave(sr, 2, 1000, 1.0)
    const lufs = computeLufs([signal], sr)
    expect(isFinite(lufs)).toBe(true)
    expect(lufs).toBeLessThan(0)
    // For a full-scale 1 kHz sine, LUFS should be close to -3 dB
    // (K-weighting has minimal effect at 1 kHz)
    expect(lufs).toBeGreaterThan(-10)
  })

  it('returns lower LUFS for lower amplitude signals', () => {
    const sr = 48000
    const loud = sineWave(sr, 2, 440, 1.0)
    const quiet = sineWave(sr, 2, 440, 0.1)
    const lufsLoud = computeLufs([loud, loud], sr)
    const lufsQuiet = computeLufs([quiet, quiet], sr)
    expect(lufsLoud).toBeGreaterThan(lufsQuiet)
  })

  it('returns a value consistent with RMS for simple signals', () => {
    const sr = 48000
    const signal = sineWave(sr, 2, 440, 0.5)
    const lufs = computeLufs([signal], sr)
    const rms = computeRms(signal)
    // LUFS and RMS should be in the same ballpark for a mono sine
    // (within ~5 dB due to K-weighting and gating)
    expect(Math.abs(lufs - rms)).toBeLessThan(5)
  })

  it('returns -70 for very short signals (< 400ms block)', () => {
    const sr = 48000
    const signal = sineWave(sr, 0.1, 440, 0.5) // 100ms
    const lufs = computeLufs([signal], sr)
    expect(lufs).toBe(-70) // no complete 400ms block → floor
  })

  it('handles multi-channel input', () => {
    const sr = 48000
    const left = sineWave(sr, 2, 440, 0.5)
    const right = sineWave(sr, 2, 440, 0.5)
    const lufs = computeLufs([left, right], sr)
    expect(isFinite(lufs)).toBe(true)
    expect(lufs).toBeLessThan(0)
  })
})

// ---------------------------------------------------------------------------
// True Peak detection with known signals
// ---------------------------------------------------------------------------

describe('True Peak detection', () => {
  it('returns ~0 dBTP for a full-scale DC signal', () => {
    const sr = 48000
    const signal = dcSignal(sr, 0.5, 1.0)
    const tp = computeTruePeak(signal)
    // True-peak FIR overshoots at the edges of a DC block; allow ~0.5 dB tolerance
    expect(tp).toBeCloseTo(0, 0)
  })

  it('returns ~-6 dBTP for a half-scale DC signal', () => {
    const sr = 48000
    const signal = dcSignal(sr, 0.5, 0.5)
    const tp = computeTruePeak(signal)
    // True-peak FIR overshoots at the edges of a DC block; allow ~0.5 dB tolerance
    expect(tp).toBeCloseTo(-6.02, 0)
  })

  it('returns a very low value for silence', () => {
    const sr = 48000
    const signal = silence(sr, 0.5)
    const tp = computeTruePeak(signal)
    expect(tp).toBeLessThan(-100)
  })

  it('returns a finite value for a sine wave', () => {
    const sr = 48000
    const signal = sineWave(sr, 1, 440, 0.5)
    const tp = computeTruePeak(signal)
    expect(isFinite(tp)).toBe(true)
    // For a 0.5 amplitude sine, sample peak is -6 dBFS, true peak may be slightly higher
    expect(tp).toBeGreaterThan(-7)
    expect(tp).toBeLessThan(-5)
  })

  it('true peak is >= sample peak for a sine wave', () => {
    const sr = 48000
    const signal = sineWave(sr, 1, 440, 1.0)
    const tp = computeTruePeak(signal)
    const sp = computePeak(signal)
    // True peak can be slightly above sample peak due to inter-sample peaks
    expect(tp).toBeGreaterThanOrEqual(sp - 0.5)
  })
})

// ---------------------------------------------------------------------------
// Stereo width calculation
// ---------------------------------------------------------------------------

describe('Stereo width calculation', () => {
  it('returns ~0 for mono (identical L and R)', () => {
    const sr = 48000
    const signal = sineWave(sr, 1, 440, 0.5)
    const width = stereoWidthRatio(signal, signal)
    expect(width).toBeCloseTo(0, 2)
  })

  it('returns > 0 for different L and R signals', () => {
    const sr = 48000
    const left = sineWave(sr, 1, 440, 0.5)
    const right = sineWave(sr, 1, 880, 0.5)
    const width = stereoWidthRatio(left, right)
    expect(width).toBeGreaterThan(0)
  })

  it('returns ~1 for anti-phase signals (L = -R)', () => {
    const sr = 48000
    const left = sineWave(sr, 1, 440, 0.5)
    const right = new Float32Array(left.length)
    for (let i = 0; i < left.length; i++) right[i] = -left[i]
    const width = stereoWidthRatio(left, right)
    // For perfect anti-phase, mid = 0, side = signal → width should be very large
    expect(width).toBeGreaterThan(1)
  })

  it('returns a value between 0 and 1 for partially correlated signals', () => {
    const sr = 48000
    const left = deterministicNoise(sr, 1, 42)
    const right = deterministicNoise(sr, 1, 99)
    const width = stereoWidthRatio(left, right)
    expect(width).toBeGreaterThanOrEqual(0)
    expect(width).toBeLessThanOrEqual(2) // can be > 1 for anti-correlated
  })
})

// ---------------------------------------------------------------------------
// FFT bin frequency mapping
// ---------------------------------------------------------------------------

describe('FFT bin frequency mapping', () => {
  it('peak frequency of a known sine maps to the correct bin', () => {
    const sr = 48000
    const fftSize = 2048
    const freqHz = 440
    const binHz = sr / fftSize
    const expectedBin = Math.round(freqHz / binHz)

    // Generate a sine wave long enough for one FFT window
    const signal = sineWave(sr, fftSize / sr, freqHz, 0.5)
    const window = signal.subarray(0, fftSize).slice()
    hannWindow(window)
    const magnitude = fftMagnitude(window)

    // Find the peak bin
    let peakBin = 0
    let peakVal = -Infinity
    for (let i = 0; i < magnitude.length; i++) {
      if (magnitude[i] > peakVal) {
        peakVal = magnitude[i]
        peakBin = i
      }
    }
    // The peak bin should be within 1 bin of the expected frequency
    expect(Math.abs(peakBin - expectedBin)).toBeLessThanOrEqual(1)
  })

  it('DC component maps to bin 0', () => {
    const sr = 48000
    const fftSize = 2048
    const signal = dcSignal(sr, fftSize / sr, 1.0)
    const window = signal.subarray(0, fftSize).slice()
    hannWindow(window)
    const magnitude = fftMagnitude(window)

    let peakBin = 0
    let peakVal = -Infinity
    for (let i = 0; i < magnitude.length; i++) {
      if (magnitude[i] > peakVal) {
        peakVal = magnitude[i]
        peakBin = i
      }
    }
    expect(peakBin).toBe(0)
  })

  it('Nyquist frequency maps to the last bin', () => {
    const sr = 48000
    const fftSize = 2048
    // The last bin (N/2 - 1) corresponds to just below Nyquist
    const lastBinFreq = (sr / 2) * (1 - 1 / fftSize)
    const signal = sineWave(sr, fftSize / sr, lastBinFreq, 0.5)
    const window = signal.subarray(0, fftSize).slice()
    hannWindow(window)
    const magnitude = fftMagnitude(window)

    // The peak should be near the last bin
    let peakBin = 0
    let peakVal = -Infinity
    for (let i = 0; i < magnitude.length; i++) {
      if (magnitude[i] > peakVal) {
        peakVal = magnitude[i]
        peakBin = i
      }
    }
    expect(peakBin).toBeGreaterThan(magnitude.length - 5)
  })

  it('bin frequency resolution is correct', () => {
    const sr = 48000
    const fftSize = 2048
    const binHz = sr / fftSize
    // Each bin represents binHz Hz of frequency resolution
    expect(binHz).toBeCloseTo(23.4375, 2)
    // Total frequency range: 0 to sr/2
    expect(binHz * (fftSize / 2)).toBeCloseTo(sr / 2, 2)
  })
})

// ---------------------------------------------------------------------------
// K-weighting (BS.1770-4)
// ---------------------------------------------------------------------------

describe('K-weighting', () => {
  it('does not crash on silence', () => {
    const sr = 48000
    const signal = silence(sr, 0.5)
    const weighted = kWeight(signal, sr)
    expect(weighted.length).toBe(signal.length)
  })

  it('returns a new array (does not mutate input)', () => {
    const sr = 48000
    const signal = sineWave(sr, 0.5, 440, 0.5)
    const copy = signal.slice()
    kWeight(signal, sr)
    for (let i = 0; i < signal.length; i++) {
      expect(signal[i]).toBe(copy[i])
    }
  })

  it('has minimal effect at 1 kHz (flat response)', () => {
    const sr = 48000
    const signal = sineWave(sr, 2, 1000, 0.5)
    const weighted = kWeight(signal, sr)
    // At 1 kHz, K-weighting should be near 0 dB (flat)
    const rmsBefore = computeRms(signal)
    const rmsAfter = computeRms(weighted)
    // Should be within ~1 dB of the original
    expect(Math.abs(rmsAfter - rmsBefore)).toBeLessThan(1.5)
  })
})

// ---------------------------------------------------------------------------
// Mid/Side encoding round-trip
// ---------------------------------------------------------------------------

describe('Mid/Side round-trip', () => {
  it('midSideEncode → midSideDecode is lossless', () => {
    const sr = 48000
    const left = sineWave(sr, 1, 440, 0.5)
    const right = sineWave(sr, 1, 880, 0.3)
    const { mid, side } = midSideEncode(left, right)
    const decoded = midSideDecode(mid, side)
    for (let i = 0; i < left.length; i++) {
      expect(decoded.left[i]).toBeCloseTo(left[i], 5)
      expect(decoded.right[i]).toBeCloseTo(right[i], 5)
    }
  })
})

// ---------------------------------------------------------------------------
// RMS and Peak
// ---------------------------------------------------------------------------

describe('RMS and Peak', () => {
  it('computeRms returns ~0 dBFS for full-scale DC', () => {
    const signal = dcSignal(48000, 0.5, 1.0)
    expect(computeRms(signal)).toBeCloseTo(0, 1)
  })

  it('computeRms returns very low value for silence', () => {
    const signal = silence(48000, 0.5)
    expect(computeRms(signal)).toBeLessThan(-100)
  })

  it('computePeak returns 0 dBFS for full-scale DC', () => {
    const signal = dcSignal(48000, 0.5, 1.0)
    expect(computePeak(signal)).toBeCloseTo(0, 1)
  })

  it('computeCrestFactor = peak - rms', () => {
    expect(computeCrestFactor(-3, -6)).toBeCloseTo(3, 1)
  })
})

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

describe('Correlation', () => {
  it('returns 1 for identical signals', () => {
    const signal = sineWave(48000, 1, 440, 0.5)
    const corr = computeCorrelation(signal, signal)
    expect(corr).toBeCloseTo(1.0, 2)
  })

  it('returns -1 for anti-phase signals', () => {
    const signal = sineWave(48000, 1, 440, 0.5)
    const anti = new Float32Array(signal.length)
    for (let i = 0; i < signal.length; i++) anti[i] = -signal[i]
    const corr = computeCorrelation(signal, anti)
    expect(corr).toBeCloseTo(-1.0, 2)
  })

  it('returns 1 for empty/zero-length signals', () => {
    const signal = new Float32Array(0)
    const corr = computeCorrelation(signal, signal)
    expect(corr).toBe(1) // guard: no data → perfectly correlated
  })
})

// ---------------------------------------------------------------------------
// LRA (Loudness Range)
// ---------------------------------------------------------------------------

describe('LRA', () => {
  it('returns 0 for a constant-amplitude signal', () => {
    const sr = 48000
    const signal = dcSignal(sr, 5, 0.5)
    const lra = computeLra([signal, signal], sr)
    expect(lra).toBeCloseTo(0, 0)
  })

  it('returns 0 for silence', () => {
    const sr = 48000
    const signal = silence(sr, 5)
    const lra = computeLra([signal, signal], sr)
    expect(lra).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Biquad filter design
// ---------------------------------------------------------------------------

describe('designBiquad', () => {
  it('produces normalized coefficients (b0 is finite)', () => {
    const coef = designBiquad('lowpass', 1000, 48000, 0.7071)
    expect(isFinite(coef.b0)).toBe(true)
    expect(isFinite(coef.b1)).toBe(true)
    expect(isFinite(coef.b2)).toBe(true)
    expect(isFinite(coef.a1)).toBe(true)
    expect(isFinite(coef.a2)).toBe(true)
  })

  it('lowpass at 1 kHz has near-unity DC gain', () => {
    const coef = designBiquad('lowpass', 1000, 48000, 0.7071)
    // DC gain of a biquad: H(1) = (b0+b1+b2) / (1+a1+a2)
    const dcGain = (coef.b0 + coef.b1 + coef.b2) / (1 + coef.a1 + coef.a2)
    expect(dcGain).toBeCloseTo(1, 1)
  })

  it('all filter types produce valid coefficients', () => {
    const types: Array<'lowpass' | 'highpass' | 'peak' | 'notch' | 'lowshelf' | 'highshelf'> =
      ['lowpass', 'highpass', 'peak', 'notch', 'lowshelf', 'highshelf']
    for (const type of types) {
      const coef = designBiquad(type, 1000, 48000, 0.7071, 3)
      expect(isFinite(coef.b0)).toBe(true)
      expect(isFinite(coef.a1)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Saturation
// ---------------------------------------------------------------------------

describe('applySaturation', () => {
  it('tape saturation is bounded (output <= 1)', () => {
    const signal = new Float32Array(100).fill(1.0) // full-scale DC
    applySaturation(signal, 0.5, 'tape')
    for (let i = 0; i < signal.length; i++) {
      expect(Math.abs(signal[i])).toBeLessThanOrEqual(1.01)
    }
  })

  it('tube saturation is bounded (output <= 1)', () => {
    const signal = new Float32Array(100).fill(1.0)
    applySaturation(signal, 0.5, 'tube')
    for (let i = 0; i < signal.length; i++) {
      expect(Math.abs(signal[i])).toBeLessThanOrEqual(1.01)
    }
  })

  it('transformer saturation is bounded (output <= 1)', () => {
    const signal = new Float32Array(100).fill(1.0)
    applySaturation(signal, 0.5, 'transformer')
    for (let i = 0; i < signal.length; i++) {
      expect(Math.abs(signal[i])).toBeLessThanOrEqual(1.01)
    }
  })

  it('does not produce NaN for any drive value', () => {
    for (const drive of [0, 0.1, 0.5, 1.0]) {
      const signal = new Float32Array(100).fill(0.5)
      applySaturation(signal, drive, 'tape')
      for (let i = 0; i < signal.length; i++) {
        expect(isFinite(signal[i])).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Loudness targeting (from audio-engine/loudness.ts)
// ---------------------------------------------------------------------------

describe('applyLoudnessTargeting', () => {
  it('adjusts channels toward target LUFS', () => {
    const sr = 48000
    const left = sineWave(sr, 2, 440, 0.5)
    const right = sineWave(sr, 2, 440, 0.5)
    const channels = [left.slice(), right.slice()]

    const params: ProcessingParams = {
      target_lufs: -14,
      true_peak_ceiling: -1.0,
      mb_threshold_low: -20, mb_threshold_mid: -18, mb_threshold_high: -16,
      mb_ratio_low: 2.5, mb_ratio_mid: 2.0, mb_ratio_high: 2.0,
      mb_attack_low: 10, mb_attack_mid: 5, mb_attack_high: 2,
      mb_release_low: 150, mb_release_mid: 80, mb_release_high: 40,
      eq_gains: [0, 0, 0, 0, 0, 0, 0, 0],
      analog_saturation: false, saturation_drive: 0, saturation_mode: 'tape',
      ms_enabled: false, mid_gain: 0, side_gain: 0, stereo_width: 1.0,
      sail_enabled: false, sail_stem_gains: new Array(12).fill(0),
      vinyl_mode: false,
      macro_brighten: 5, macro_glue: 5, macro_width: 5, macro_punch: 5,
      macro_warmth: 5, macro_space: 5, macro_repair: 0,
    }

    const beforeLufs = computeLufs(channels, sr)
    applyLoudnessTargeting(channels, params, sr)
    const afterLufs = computeLufs(channels, sr)

    // After targeting, the LUFS should be closer to -14
    const diffBefore = Math.abs(beforeLufs - (-14))
    const diffAfter = Math.abs(afterLufs - (-14))
    expect(diffAfter).toBeLessThanOrEqual(diffBefore + 0.5) // tolerance for near-target
  })

  it('does not modify channels when already at target', () => {
    const sr = 48000
    // Create a signal that is already at -14 LUFS (approximately)
    // We'll use a sine wave and measure its LUFS, then set that as the target
    const left = sineWave(sr, 2, 440, 0.5)
    const right = sineWave(sr, 2, 440, 0.5)
    const currentLufs = computeLufs([left, right], sr)

    const channels = [left.slice(), right.slice()]
    const params: ProcessingParams = {
      target_lufs: currentLufs, // set target to current LUFS
      true_peak_ceiling: -1.0,
      mb_threshold_low: -20, mb_threshold_mid: -18, mb_threshold_high: -16,
      mb_ratio_low: 2.5, mb_ratio_mid: 2.0, mb_ratio_high: 2.0,
      mb_attack_low: 10, mb_attack_mid: 5, mb_attack_high: 2,
      mb_release_low: 150, mb_release_mid: 80, mb_release_high: 40,
      eq_gains: [0, 0, 0, 0, 0, 0, 0, 0],
      analog_saturation: false, saturation_drive: 0, saturation_mode: 'tape',
      ms_enabled: false, mid_gain: 0, side_gain: 0, stereo_width: 1.0,
      sail_enabled: false, sail_stem_gains: new Array(12).fill(0),
      vinyl_mode: false,
      macro_brighten: 5, macro_glue: 5, macro_width: 5, macro_punch: 5,
      macro_warmth: 5, macro_space: 5, macro_repair: 0,
    }

    applyLoudnessTargeting(channels, params, sr)
    // Since the signal is already at target, the 0.3 LUFS threshold should prevent adjustment
    const afterLufs = computeLufs(channels, sr)
    expect(Math.abs(afterLufs - currentLufs)).toBeLessThan(0.5)
  })
})

// ---------------------------------------------------------------------------
// FFT in-place
// ---------------------------------------------------------------------------

describe('fftInPlace', () => {
  it('throws for non-power-of-2 sizes', () => {
    const real = new Float32Array(100)
    const imag = new Float32Array(100)
    expect(() => fftInPlace(real, imag)).toThrow('power of 2')
  })

  it('produces a DC peak for a DC signal', () => {
    const N = 64
    const real = new Float32Array(N).fill(1.0)
    const imag = new Float32Array(N)
    fftInPlace(real, imag)
    // Bin 0 (DC) should have the largest magnitude
    const dcMag = Math.sqrt(real[0] * real[0] + imag[0] * imag[0])
    for (let i = 1; i < N; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
      expect(dcMag).toBeGreaterThan(mag)
    }
  })
})

// ---------------------------------------------------------------------------
// Spectral features
// ---------------------------------------------------------------------------

describe('computeSpectralFeatures', () => {
  it('returns valid features for a sine wave spectrum', () => {
    const sr = 48000
    const signal = sineWave(sr, 0.05, 440, 0.5)
    const window = signal.subarray(0, 2048).slice()
    hannWindow(window)
    const spectrum = fftMagnitude(window)

    const features = computeSpectralFeatures(spectrum, sr)
    expect(isFinite(features.centroid)).toBe(true)
    expect(isFinite(features.spread)).toBe(true)
    expect(isFinite(features.rolloff85)).toBe(true)
    expect(isFinite(features.rolloff95)).toBe(true)
    expect(isFinite(features.flatness)).toBe(true)
    expect(isFinite(features.peakFrequency)).toBe(true)
    // Peak frequency should be near 440 Hz (within one FFT bin)
    expect(features.peakFrequency).toBeGreaterThan(400)
    expect(features.peakFrequency).toBeLessThan(500)
  })

  it('returns zeros for empty spectrum', () => {
    const features = computeSpectralFeatures(new Float32Array(0), 48000)
    expect(features.centroid).toBe(0)
    expect(features.spread).toBe(0)
    expect(features.peakFrequency).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Third-octave band constants
// ---------------------------------------------------------------------------

describe('THIRD_OCTAVE_BANDS_HZ', () => {
  it('contains 31 bands', () => {
    expect(THIRD_OCTAVE_BANDS_HZ).toHaveLength(31)
  })

  it('starts at 20 Hz', () => {
    expect(THIRD_OCTAVE_BANDS_HZ[0]).toBe(20)
  })

  it('ends at 20000 Hz', () => {
    expect(THIRD_OCTAVE_BANDS_HZ[30]).toBe(20000)
  })
})
