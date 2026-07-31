'use client'

/**
 * RAIN V6 — Reference Track Matching
 *
 * Real spectral matching against a user-uploaded reference track. Implements
 * the iZotope DAFx 2022 paradigm (simplified, in-browser):
 *
 *   1. Compute the 31-band 1/3-octave spectrum (IEC 61260 base-10 series,
 *      20 Hz → 20 kHz) of both the reference and the current input.
 *   2. Compute the matching curve: curve[i] = ref[i] − target[i], clamped
 *      to ±6 dB (prevents extreme EQ that would sound unnatural).
 *   3. Apply the curve as a chain of 31 BiquadFilterNode peak filters via
 *      OfflineAudioContext.
 *   4. Compute a match score: 1 − mean(|afterCurve|) / mean(|beforeCurve|),
 *      clamped to [0, 1]. A perfect match (afterCurve → 0) scores 1.0.
 *
 * The matching curve is also stashed in the session store so Stage 5 of the
 * mastering pipeline can apply it as an in-place biquad chain BEFORE the
 * genre tilt — keeping the rendered output consistent with the preview.
 *
 * Determinism: same input → same output. No Math.random in the DSP path.
 */

import { applyBiquad, computeLufs, designBiquad, fftInPlace } from './dsp'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReferenceMatch {
  /** Per-band gain in dB, length 31, clamped to [-6, +6]. */
  curveDb: Float32Array
  /** 31 ISO 1/3-octave center frequencies (Hz). */
  bands: number[]
  /** Match score in [0, 1] — 1.0 = perfect spectral match. */
  matchScore: number
  /** Reference integrated LUFS (measured, not target). */
  referenceLufs: number
  /** Target (current input) integrated LUFS (measured, not target). */
  targetLufs: number
}

// ---------------------------------------------------------------------------
// Constants — ISO 1/3-octave base-10 center frequencies, 20 Hz → 20 kHz
// (IEC 61260 class 1). 31 bands total.
// ---------------------------------------------------------------------------

export const THIRD_OCTAVE_BANDS: number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
  20000,
]

const NUM_BANDS = THIRD_OCTAVE_BANDS.length // 31
const MAX_MATCH_GAIN_DB = 6.0
const MIN_MATCH_GAIN_DB = -6.0

// Q for a peak filter with 1/3-octave bandwidth.
// Q = sqrt(2^B) / (2^B - 1) for bandwidth B in octaves; B = 1/3 → Q ≈ 4.318.
const THIRD_OCTAVE_Q = 4.318

// STFT parameters for spectral measurement
const FFT_SIZE = 4096
const HOP_SIZE = 1024 // 75% overlap
const NUM_BINS = FFT_SIZE / 2 + 1

// ---------------------------------------------------------------------------
// Periodic Hann window
// ---------------------------------------------------------------------------

const HANN = (() => {
  const w = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE))
  }
  return w
})()

// ---------------------------------------------------------------------------
// FFT primitive — imported from dsp.ts (single source of truth).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Band edges (1/3-octave on either side of each center frequency)
// ---------------------------------------------------------------------------

function bandEdgesFor(fc: number): { lo: number; hi: number } {
  const factor = Math.pow(2, 1 / 6) // ±1/6 octave → full band = 1/3 octave
  return { lo: fc / factor, hi: fc * factor }
}

function binRangeForEdge(loHz: number, hiHz: number, sampleRate: number): { start: number; end: number } {
  const startBin = Math.max(0, Math.floor((loHz / sampleRate) * FFT_SIZE))
  const endBin = Math.min(NUM_BINS, Math.ceil((hiHz / sampleRate) * FFT_SIZE) + 1)
  return { start: startBin, end: Math.max(startBin + 1, endBin) }
}

// ---------------------------------------------------------------------------
// Public: computeThirdOctaveSpectrum
// ---------------------------------------------------------------------------

/**
 * Compute the 31-band 1/3-octave spectrum of an AudioBuffer.
 *
 * Returns:
 *   - bands: 31 ISO center frequencies (Hz)
 *   - energiesDb: per-band integrated energy in dB, averaged across channels
 *     and across STFT frames
 *
 * Mono buffers are measured directly; stereo buffers average L+R energy.
 */
export function computeThirdOctaveSpectrum(
  buffer: AudioBuffer,
  _sampleRate?: number,
): { bands: number[]; energiesDb: Float32Array } {
  const sampleRate = buffer.sampleRate
  const numCh = buffer.numberOfChannels
  const out = new Float32Array(NUM_BANDS)

  // Pre-compute band bin ranges
  const binRanges = THIRD_OCTAVE_BANDS.map((fc) => {
    const { lo, hi } = bandEdgesFor(fc)
    return binRangeForEdge(lo, hi, sampleRate)
  })

  // Average per-band energy across all channels
  for (let ch = 0; ch < numCh; ch++) {
    const samples = buffer.getChannelData(ch)
    const len = samples.length
    const numFrames = Math.max(1, Math.floor((len - 1) / HOP_SIZE) + 1)
    const real = new Float32Array(FFT_SIZE)
    const imag = new Float32Array(FFT_SIZE)

    // Per-band accumulator
    const bandSums = new Float64Array(NUM_BANDS)
    const bandCounts = new Float64Array(NUM_BANDS)

    for (let f = 0; f < numFrames; f++) {
      const start = f * HOP_SIZE - Math.floor(FFT_SIZE / 2)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = start + i
        real[i] = (idx >= 0 && idx < len ? samples[idx] : 0) * HANN[i]
        imag[i] = 0
      }
      fftInPlace(real, imag)

      for (let b = 0; b < NUM_BANDS; b++) {
        const { start: bStart, end: bEnd } = binRanges[b]
        let e = 0
        let n = 0
        for (let i = bStart; i < bEnd; i++) {
          e += real[i] * real[i] + imag[i] * imag[i]
          n++
        }
        if (n > 0) {
          bandSums[b] += e / n
          bandCounts[b] += 1
        }
      }
    }

    // Convert per-band mean energy to dB and accumulate across channels
    for (let b = 0; b < NUM_BANDS; b++) {
      if (bandCounts[b] > 0) {
        const meanEnergy = bandSums[b] / bandCounts[b]
        const db = 10 * Math.log10(meanEnergy + 1e-12)
        // Running average across channels (for stereo → mean of L and R dB)
        out[b] = ch === 0 ? db : (out[b] + db) / 2
      } else if (ch === 0) {
        out[b] = -120
      }
    }
  }

  return { bands: THIRD_OCTAVE_BANDS.slice(), energiesDb: out }
}

// ---------------------------------------------------------------------------
// Public: computeMatchingCurve
// ---------------------------------------------------------------------------

/**
 * Compute the matching EQ curve.
 *
 *   curve[i] = clamp(ref[i] − target[i], -6, +6)
 *
 * Positive values = boost (the reference is brighter/louder in that band),
 * negative = cut.
 */
export function computeMatchingCurve(ref: Float32Array, target: Float32Array): Float32Array {
  const n = Math.min(ref.length, target.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const diff = ref[i] - target[i]
    out[i] = Math.max(MIN_MATCH_GAIN_DB, Math.min(MAX_MATCH_GAIN_DB, diff))
  }
  return out
}

// ---------------------------------------------------------------------------
// Public: applyMatchingCurve (OfflineAudioContext biquad peak chain)
// ---------------------------------------------------------------------------

/**
 * Apply the matching curve to an AudioBuffer via a chain of BiquadFilterNode
 * peak filters (one per 1/3-octave band) processed through an
 * OfflineAudioContext.
 *
 * The returned AudioBuffer has the same sampleRate, length, and channel count
 * as the input.
 *
 * Note: This function is async because OfflineAudioContext.startRendering()
 * returns a Promise. The async boundary is the only non-deterministic part
 * of the pipeline (it depends on the audio thread's scheduling); the DSP
 * itself is deterministic.
 */
export async function applyMatchingCurve(
  buffer: AudioBuffer,
  curve: Float32Array,
  bands: number[],
  sampleRate: number,
): Promise<AudioBuffer> {
  // Sanity: OfflineAudioContext requires at least 1 channel and 1 sample
  const numChannels = Math.max(1, buffer.numberOfChannels)
  const length = Math.max(1, buffer.length)

  const Ctx: typeof OfflineAudioContext =
    (typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext!)
  if (!Ctx) {
    throw new Error('OfflineAudioContext not available')
  }
  const ctx = new Ctx(numChannels, length, sampleRate)

  // Source
  const src = ctx.createBufferSource()
  // Copy input buffer to avoid mutation
  const copy = ctx.createBuffer(numChannels, length, sampleRate)
  for (let ch = 0; ch < numChannels; ch++) {
    copy.copyToChannel(buffer.getChannelData(ch), ch)
  }
  src.buffer = copy

  // Build the biquad chain: src → peak[0] → peak[1] → ... → peak[30] → dest
  let node: AudioNode = src
  for (let i = 0; i < bands.length; i++) {
    const fc = bands[i]
    const gain = i < curve.length ? curve[i] : 0
    // Skip bands that are out of reach at this sample rate (fc >= Nyquist)
    if (fc >= sampleRate / 2) continue
    const peak = ctx.createBiquadFilter()
    peak.type = 'peaking'
    peak.frequency.value = fc
    peak.Q.value = THIRD_OCTAVE_Q
    peak.gain.value = gain
    node.connect(peak)
    node = peak
  }
  node.connect(ctx.destination)

  src.start(0)
  const rendered = await ctx.startRendering()
  return rendered
}

// ---------------------------------------------------------------------------
// Public: applyMatchingCurveInPlace (Float32Array chain via dsp.applyBiquad)
// ---------------------------------------------------------------------------

/**
 * In-place variant of applyMatchingCurve that operates directly on a
 * Float32Array channel (used by audio-engine Stage 5 to apply the reference
 * curve to the in-render channel data without spinning up an
 * OfflineAudioContext).
 *
 * Each band gets a peak biquad (designBiquad 'peak') with Q = 4.318 and
 * the per-band gain from `curve`. Filters are cascaded sequentially.
 */
export function applyMatchingCurveInPlace(
  samples: Float32Array,
  curve: Float32Array,
  bands: number[],
  sampleRate: number,
): void {
  const nyquist = sampleRate / 2
  for (let i = 0; i < bands.length; i++) {
    const fc = bands[i]
    if (fc >= nyquist) continue
    const gain = i < curve.length ? curve[i] : 0
    if (Math.abs(gain) < 0.05) continue // no-op bands skipped for efficiency
    const coef = designBiquad('peak', fc, sampleRate, THIRD_OCTAVE_Q, gain)
    applyBiquad(samples, coef)
  }
}

// ---------------------------------------------------------------------------
// Public: computeMatchScore
// ---------------------------------------------------------------------------

/**
 * Match score: 1 − mean(|afterCurve|) / mean(|beforeCurve|), clamped to [0, 1].
 *
 *   beforeCurve — the ref-target difference BEFORE applying the matching EQ
 *   afterCurve  — the ref-target difference AFTER applying the matching EQ
 *
 * A perfect match (afterCurve = 0) scores 1.0. If afterCurve is unchanged
 * from beforeCurve, scores 0. The score can go negative if the matching
 * overshoots (afterCurve > beforeCurve); we clamp to 0 in that case.
 */
export function computeMatchScore(beforeCurve: Float32Array, afterCurve: Float32Array): number {
  const n = Math.min(beforeCurve.length, afterCurve.length)
  if (n === 0) return 0
  let beforeSum = 0
  let afterSum = 0
  for (let i = 0; i < n; i++) {
    beforeSum += Math.abs(beforeCurve[i])
    afterSum += Math.abs(afterCurve[i])
  }
  const beforeMean = beforeSum / n
  const afterMean = afterSum / n
  if (beforeMean < 1e-9) return afterMean < 1e-9 ? 1 : 0
  const score = 1 - afterMean / beforeMean
  return Math.max(0, Math.min(1, score))
}

// ---------------------------------------------------------------------------
// Public: measureLufs (simplified BS.1770-4 integrated LUFS)
// ---------------------------------------------------------------------------

/**
 * Lightweight BS.1770-4 integrated LUFS measurement for the reference tab.
 * Delegates to the canonical implementation in dsp.ts to avoid divergence.
 */
export function measureLufs(channels: Float32Array[], sampleRate: number): number {
  return computeLufs(channels, sampleRate)
}

// ---------------------------------------------------------------------------
// Convenience: full reference-match pipeline (compute → match → score)
// ---------------------------------------------------------------------------

/**
 * End-to-end helper: compute both spectra, the matching curve, and the
 * (predicted) match score. The match score here is the THEORETICAL score
 * assuming perfect EQ application — it equals the fraction of the original
 * spectral mismatch that the ±6 dB clamped curve can correct.
 *
 * The actual post-EQ match score (measured on the rendered audio) will
 * usually be slightly lower than this theoretical value, because real
 * biquad peak filters have finite Q and slight band overlap.
 */
export function computeReferenceMatch(
  referenceBuffer: AudioBuffer,
  targetBuffer: AudioBuffer,
): ReferenceMatch {
  const refSpec = computeThirdOctaveSpectrum(referenceBuffer)
  const targetSpec = computeThirdOctaveSpectrum(targetBuffer)
  const beforeCurve = computeMatchingCurve(refSpec.energiesDb, targetSpec.energiesDb)

  // Theoretical afterCurve: the residual after applying the clamped curve.
  // For each band: residual = (ref - target) - curve = original_diff - curve.
  // If the curve was unclamped, residual = 0. With clamping, residual is the
  // part of the difference that exceeded ±6 dB.
  const afterCurve = new Float32Array(beforeCurve.length)
  for (let i = 0; i < beforeCurve.length; i++) {
    const rawDiff = refSpec.energiesDb[i] - targetSpec.energiesDb[i]
    afterCurve[i] = rawDiff - beforeCurve[i]
  }
  const matchScore = computeMatchScore(beforeCurve, afterCurve)

  // Measure LUFS for both buffers (simplified — uses K-weighted BS.1770-4)
  const refChannels: Float32Array[] = []
  for (let c = 0; c < referenceBuffer.numberOfChannels; c++) {
    refChannels.push(referenceBuffer.getChannelData(c))
  }
  const targetChannels: Float32Array[] = []
  for (let c = 0; c < targetBuffer.numberOfChannels; c++) {
    targetChannels.push(targetBuffer.getChannelData(c))
  }
  const referenceLufs = measureLufs(refChannels, referenceBuffer.sampleRate)
  const targetLufs = measureLufs(targetChannels, targetBuffer.sampleRate)

  return {
    curveDb: beforeCurve,
    bands: refSpec.bands,
    matchScore,
    referenceLufs,
    targetLufs,
  }
}
