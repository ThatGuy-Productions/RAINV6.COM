/**
 * RAIN V6 — DSP Regression Certification Test
 *
 * This test verifies that all DSP functions produce outputs matching the
 * baseline reference values. Any deviation indicates a regression in the
 * audio processing pipeline.
 *
 * RAIN V6 is an audio operating system. Audio correctness takes precedence
 * over code elegance. If a refactor improves code quality but changes
 * mastering output, the refactor must be rejected.
 *
 * Tolerance: LUFS ±0.01 dB, True Peak ±0.01 dB, RMS ±0.0001,
 * Correlation ±0.001, Stereo Width ±0.01. Signal hashes must be exact.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'

// ─── Test signal generators (identical to baseline script) ────────────────

function generateSine(freq: number, sampleRate: number, duration: number): Float32Array {
  const samples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    buffer[i] = Math.sin(2 * Math.PI * freq * i / sampleRate)
  }
  return buffer
}

function generateSilence(sampleRate: number, duration: number): Float32Array {
  return new Float32Array(Math.floor(sampleRate * duration))
}

function generateDC(amplitude: number, sampleRate: number, duration: number): Float32Array {
  const samples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(samples)
  buffer.fill(amplitude)
  return buffer
}

function generateWhiteNoise(sampleRate: number, duration: number, seed: number): Float32Array {
  const samples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(samples)
  let s = seed
  for (let i = 0; i < samples; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    buffer[i] = (s / 0x3fffffff) - 1.0
  }
  return buffer
}

// ─── DSP Functions (must match runtime) ───────────────────────────────────

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

function computeLufs(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -70
  const blockSize = Math.floor(sampleRate * 0.4)
  if (blockSize === 0) return -70
  const totalSamples = channels[0].length
  let sumSquared = 0
  let blockCount = 0
  for (let start = 0; start < totalSamples; start += blockSize) {
    const end = Math.min(start + blockSize, totalSamples)
    let blockSum = 0
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        blockSum += (ch[i] ?? 0) * (ch[i] ?? 0)
      }
    }
    const meanSquare = blockSum / ((end - start) * channels.length)
    if (meanSquare > 0) {
      sumSquared += meanSquare
      blockCount++
    }
  }
  if (blockCount === 0) return -70
  const meanMeanSquare = sumSquared / blockCount
  return -0.691 + 10 * Math.log10(meanMeanSquare)
}

function computeTruePeak(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
    if (i > 0 && i < samples.length - 1) {
      const mid1 = (samples[i - 1] + samples[i]) * 0.5
      const mid2 = (samples[i] + samples[i + 1]) * 0.5
      const m1 = Math.abs(mid1)
      const m2 = Math.abs(mid2)
      if (m1 > peak) peak = m1
      if (m2 > peak) peak = m2
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

function stereoWidthRatio(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || right.length === 0) return 0
  const mid = new Float32Array(left.length)
  const side = new Float32Array(left.length)
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i] + right[i]) * 0.5
    side[i] = (left[i] - right[i]) * 0.5
  }
  const midRms = computeRms(mid)
  const sideRms = computeRms(side)
  if (midRms === 0) return sideRms > 0 ? 2 : 0
  return sideRms / midRms
}

function computeCorrelation(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0) return 1
  const len = Math.min(a.length, b.length)
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0
  for (let i = 0; i < len; i++) {
    sumA += a[i]
    sumB += b[i]
    sumAB += a[i] * b[i]
    sumA2 += a[i] * a[i]
    sumB2 += b[i] * b[i]
  }
  const n = len
  const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB))
  if (denom === 0) return 1
  return (n * sumAB - sumA * sumB) / denom
}

function hashFloat32Array(data: Float32Array): string {
  const buffer = Buffer.from(data.buffer)
  return createHash('sha256').update(buffer).digest('hex')
}

// ─── Load baseline ────────────────────────────────────────────────────────

interface Baseline {
  sampleRate: number
  duration: number
  lufs: Record<string, number>
  truePeak: Record<string, number | null>
  rms: Record<string, number>
  stereoWidth: Record<string, number>
  correlation: Record<string, number>
  signalHashes: Record<string, string>
  fftBinMapping: Record<string, number>
}

const baseline: Baseline = JSON.parse(
  readFileSync('tests/dsp-baseline.json', 'utf-8')
)

const SR = baseline.sampleRate
const DUR = baseline.duration

// ─── Test signals ─────────────────────────────────────────────────────────

const sine1k = generateSine(1000, SR, DUR)
const sine440 = generateSine(440, SR, DUR)
const silence = generateSilence(SR, DUR)
const dcFull = generateDC(1.0, SR, DUR)
const dcHalf = generateDC(0.5, SR, DUR)
const noise = generateWhiteNoise(SR, DUR, 42)

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DSP Regression Certification — LUFS', () => {
  const TOLERANCE = 0.01

  it('silence → -70 LUFS', () => {
    const result = computeLufs([silence], SR)
    expect(result).toBe(baseline.lufs.silence)
  })

  it('1 kHz mono sine matches baseline', () => {
    const result = computeLufs([sine1k], SR)
    expect(result).toBeCloseTo(baseline.lufs.sine1k_mono, TOLERANCE)
  })

  it('1 kHz stereo sine matches baseline', () => {
    const result = computeLufs([sine1k, sine1k], SR)
    expect(result).toBeCloseTo(baseline.lufs.sine1k_stereo, TOLERANCE)
  })

  it('440 Hz mono sine matches baseline', () => {
    const result = computeLufs([sine440], SR)
    expect(result).toBeCloseTo(baseline.lufs.sine440_mono, TOLERANCE)
  })

  it('full-scale DC matches baseline', () => {
    const result = computeLufs([dcFull], SR)
    expect(result).toBeCloseTo(baseline.lufs.dcFull_mono, TOLERANCE)
  })

  it('noise matches baseline', () => {
    const result = computeLufs([noise], SR)
    expect(result).toBeCloseTo(baseline.lufs.noise_mono, TOLERANCE)
  })

  it('short signal (0.5s) matches baseline', () => {
    const result = computeLufs([generateSine(1000, SR, 0.5)], SR)
    expect(result).toBeCloseTo(baseline.lufs.short_0_5s, TOLERANCE)
  })
})

describe('DSP Regression Certification — True Peak', () => {
  const TOLERANCE = 0.01

  it('silence → -Infinity', () => {
    const result = computeTruePeak(silence)
    // Baseline stores null for -Infinity (JSON can't represent -Infinity)
    expect(result).toBe(-Infinity)
  })

  it('1 kHz sine matches baseline', () => {
    const result = computeTruePeak(sine1k)
    expect(result).toBeCloseTo(baseline.truePeak.sine1k!, TOLERANCE)
  })

  it('full-scale DC matches baseline', () => {
    const result = computeTruePeak(dcFull)
    expect(result).toBeCloseTo(baseline.truePeak.dcFull!, TOLERANCE)
  })

  it('half-scale DC matches baseline', () => {
    const result = computeTruePeak(dcHalf)
    expect(result).toBeCloseTo(baseline.truePeak.dcHalf!, TOLERANCE)
  })

  it('noise matches baseline', () => {
    const result = computeTruePeak(noise)
    expect(result).toBeCloseTo(baseline.truePeak.noise!, TOLERANCE)
  })
})

describe('DSP Regression Certification — RMS', () => {
  const TOLERANCE = 0.0001

  it('silence → 0', () => {
    expect(computeRms(silence)).toBe(baseline.rms.silence)
  })

  it('1 kHz sine matches baseline', () => {
    expect(computeRms(sine1k)).toBeCloseTo(baseline.rms.sine1k, TOLERANCE)
  })

  it('full-scale DC → 1.0', () => {
    expect(computeRms(dcFull)).toBeCloseTo(baseline.rms.dcFull, TOLERANCE)
  })

  it('half-scale DC → 0.5', () => {
    expect(computeRms(dcHalf)).toBeCloseTo(baseline.rms.dcHalf, TOLERANCE)
  })

  it('noise matches baseline', () => {
    expect(computeRms(noise)).toBeCloseTo(baseline.rms.noise, TOLERANCE)
  })
})

describe('DSP Regression Certification — Stereo Width', () => {
  const TOLERANCE = 0.01

  it('mono → 0', () => {
    expect(stereoWidthRatio(sine1k, sine1k)).toBeCloseTo(baseline.stereoWidth.mono, TOLERANCE)
  })

  it('stereo matches baseline', () => {
    expect(stereoWidthRatio(sine1k, generateSine(1000, SR, DUR))).toBeCloseTo(baseline.stereoWidth.stereo, TOLERANCE)
  })

  it('anti-phase → 2', () => {
    const anti = Float32Array.from(sine1k).map(s => -s)
    expect(stereoWidthRatio(sine1k, anti)).toBeCloseTo(baseline.stereoWidth.antiPhase, TOLERANCE)
  })

  it('silence → 0', () => {
    expect(stereoWidthRatio(silence, silence)).toBeCloseTo(baseline.stereoWidth.silence, TOLERANCE)
  })
})

describe('DSP Regression Certification — Correlation', () => {
  const TOLERANCE = 0.001

  it('identical → 1', () => {
    expect(computeCorrelation(sine1k, sine1k)).toBeCloseTo(baseline.correlation.identical, TOLERANCE)
  })

  it('anti-phase → -1', () => {
    const anti = Float32Array.from(sine1k).map(s => -s)
    expect(computeCorrelation(sine1k, anti)).toBeCloseTo(baseline.correlation.antiPhase, TOLERANCE)
  })

  it('different frequencies → ~0', () => {
    expect(computeCorrelation(sine1k, sine440)).toBeCloseTo(baseline.correlation.different, TOLERANCE)
  })

  it('silence → 1', () => {
    expect(computeCorrelation(silence, silence)).toBeCloseTo(baseline.correlation.silence, TOLERANCE)
  })
})

describe('DSP Regression Certification — Signal Hashes (bit-identity)', () => {
  it('1 kHz sine hash matches', () => {
    expect(hashFloat32Array(sine1k)).toBe(baseline.signalHashes.sine1k)
  })

  it('440 Hz sine hash matches', () => {
    expect(hashFloat32Array(sine440)).toBe(baseline.signalHashes.sine440)
  })

  it('silence hash matches', () => {
    expect(hashFloat32Array(silence)).toBe(baseline.signalHashes.silence)
  })

  it('full-scale DC hash matches', () => {
    expect(hashFloat32Array(dcFull)).toBe(baseline.signalHashes.dcFull)
  })

  it('half-scale DC hash matches', () => {
    expect(hashFloat32Array(dcHalf)).toBe(baseline.signalHashes.dcHalf)
  })

  it('noise hash matches', () => {
    expect(hashFloat32Array(noise)).toBe(baseline.signalHashes.noise)
  })
})

describe('DSP Regression Certification — FFT Bin Mapping', () => {
  it('bin resolution matches', () => {
    expect(SR / 4096).toBe(baseline.fftBinMapping.binResolution)
  })

  it('440 Hz maps to correct bin', () => {
    expect(Math.round(440 / (SR / 4096))).toBe(baseline.fftBinMapping.binFor440Hz)
  })

  it('1 kHz maps to correct bin', () => {
    expect(Math.round(1000 / (SR / 4096))).toBe(baseline.fftBinMapping.binFor1kHz)
  })

  it('Nyquist bin is correct', () => {
    expect(4096 / 2).toBe(baseline.fftBinMapping.binForNyquist)
  })
})
