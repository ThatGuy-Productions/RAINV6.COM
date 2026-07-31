/**
 * RAIN V6 — DSP Regression Certification
 *
 * Generates deterministic baseline outputs for all core DSP functions.
 * Produces a JSON file with reference values that must be preserved
 * across all subsequent changes.
 *
 * RAIN V6 is an audio operating system. Audio correctness takes precedence
 * over code elegance. If a refactor improves code quality but changes
 * mastering output, the refactor must be rejected.
 *
 * Usage: npx tsx scripts/dsp-baseline.ts
 * Output: tests/dsp-baseline.json
 */

import { createHash } from 'crypto'
import { writeFileSync } from 'fs'

// ─── Test signal generators ───────────────────────────────────────────────

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

// ─── DSP Functions ────────────────────────────────────────────────────────

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

// ─── Generate baseline ───────────────────────────────────────────────────

const SAMPLE_RATE = 48000
const DURATION = 2.0

const baseline: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  sampleRate: SAMPLE_RATE,
  duration: DURATION,
  note: 'RAIN V6 DSP Baseline — all values must be preserved across refactors. Audio correctness takes precedence over code elegance.',
}

const sine1k = generateSine(1000, SAMPLE_RATE, DURATION)
const sine440 = generateSine(440, SAMPLE_RATE, DURATION)
const silence = generateSilence(SAMPLE_RATE, DURATION)
const dcFull = generateDC(1.0, SAMPLE_RATE, DURATION)
const dcHalf = generateDC(0.5, SAMPLE_RATE, DURATION)
const noise = generateWhiteNoise(SAMPLE_RATE, DURATION, 42)

baseline.lufs = {
  silence: computeLufs([silence], SAMPLE_RATE),
  sine1k_mono: computeLufs([sine1k], SAMPLE_RATE),
  sine1k_stereo: computeLufs([sine1k, sine1k], SAMPLE_RATE),
  sine440_mono: computeLufs([sine440], SAMPLE_RATE),
  dcFull_mono: computeLufs([dcFull], SAMPLE_RATE),
  noise_mono: computeLufs([noise], SAMPLE_RATE),
  short_0_5s: computeLufs([generateSine(1000, SAMPLE_RATE, 0.5)], SAMPLE_RATE),
}

baseline.truePeak = {
  silence: computeTruePeak(silence),
  sine1k: computeTruePeak(sine1k),
  dcFull: computeTruePeak(dcFull),
  dcHalf: computeTruePeak(dcHalf),
  noise: computeTruePeak(noise),
}

baseline.rms = {
  silence: computeRms(silence),
  sine1k: computeRms(sine1k),
  dcFull: computeRms(dcFull),
  dcHalf: computeRms(dcHalf),
  noise: computeRms(noise),
}

baseline.stereoWidth = {
  mono: stereoWidthRatio(sine1k, sine1k),
  stereo: stereoWidthRatio(sine1k, generateSine(1000, SAMPLE_RATE, DURATION)),
  antiPhase: stereoWidthRatio(sine1k, Float32Array.from(sine1k).map(s => -s)),
  silence: stereoWidthRatio(silence, silence),
}

baseline.correlation = {
  identical: computeCorrelation(sine1k, sine1k),
  antiPhase: computeCorrelation(sine1k, Float32Array.from(sine1k).map(s => -s)),
  different: computeCorrelation(sine1k, sine440),
  silence: computeCorrelation(silence, silence),
}

baseline.signalHashes = {
  sine1k: hashFloat32Array(sine1k),
  sine440: hashFloat32Array(sine440),
  silence: hashFloat32Array(silence),
  dcFull: hashFloat32Array(dcFull),
  dcHalf: hashFloat32Array(dcHalf),
  noise: hashFloat32Array(noise),
}

baseline.fftBinMapping = {
  fftSize: 4096,
  binResolution: SAMPLE_RATE / 4096,
  binFor440Hz: Math.round(440 / (SAMPLE_RATE / 4096)),
  binFor1kHz: Math.round(1000 / (SAMPLE_RATE / 4096)),
  binForNyquist: 4096 / 2,
}

const outputPath = 'tests/dsp-baseline.json'
writeFileSync(outputPath, JSON.stringify(baseline, null, 2))
console.log(`DSP baseline written to ${outputPath}`)
console.log(`  LUFS: ${Object.keys(baseline.lufs as Record<string, unknown>).length} reference values`)
console.log(`  True Peak: ${Object.keys(baseline.truePeak as Record<string, unknown>).length} reference values`)
console.log(`  RMS: ${Object.keys(baseline.rms as Record<string, unknown>).length} reference values`)
console.log(`  Stereo Width: ${Object.keys(baseline.stereoWidth as Record<string, unknown>).length} reference values`)
console.log(`  Correlation: ${Object.keys(baseline.correlation as Record<string, unknown>).length} reference values`)
console.log(`  Signal hashes: ${Object.keys(baseline.signalHashes as Record<string, unknown>).length} SHA-256 checksums`)
console.log(`  FFT bin mapping: ${Object.keys(baseline.fftBinMapping as Record<string, unknown>).length} reference values`)
