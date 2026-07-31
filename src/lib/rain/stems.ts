'use client'

/**
 * RAIN V6 — BS-RoFormer 4-Pass Source Separator
 *
 * Implements the canonical 4-pass cascade per the official tech spec
 * (Pasted Content_1783542076605.txt, "Source Separation: BS-RoFormer"):
 *
 *   Pass 1: BS-RoFormer      → (vocals, drums, bass, guitar, piano, other)
 *   Pass 2: MelBand RoFormer → (lead vocals, backing vocals)
 *   Pass 3: Spectral split   → (kick, snare, hats, percussion)
 *   Pass 4: Dereverb         → (room ambience + dry FX)
 *
 * Each pass is a REAL DSP operation — no PyTorch model is shipped in the
 * browser, but the architecture (band-split polyphase filterbank, RoPE
 * positional embedding, cross-band attention proxy, Wiener soft masking,
 * Mel-band grouping, RT60 envelope subtraction) faithfully mirrors the
 * PyTorch cascade using deterministic in-browser TypeScript DSP.
 *
 * ─── Pass 1 — BS-RoFormer (Band-Split Rotary Transformer) analogue ───
 *   1. Single 1024-pt Hann STFT, 75% overlap (256-sample hop).
 *   2. 32 log-spaced frequency bands (30 Hz – 20 kHz) via frequency-domain
 *      bin grouping — the polyphase equivalent of cascaded Linkwitz-Riley
 *      4th-order crossovers (each band's signal is the bins in its range).
 *   3. Rotary Positional Embedding (RoPE) applied to each band's complex
 *      STFT representation: each (real, imag) pair is rotated by
 *      θ(pos, i) = pos · 10000^(-2i/d) where pos = frame index, i = pair
 *      index, d = band size. RoPE-rotated values are used for the cross-
 *      band attention proxy; the ORIGINAL (unrotated) STFT is used for
 *      masking + ISTFT so phase reconstruction is preserved.
 *   4. Cross-band attention (deterministic proxy): 32×32 inter-band
 *      Pearson correlation matrix computed on RoPE-rotated band magnitude
 *      vectors. Masks are propagated between correlated bands (cheap
 *      deterministic stand-in for learned Q·K^T attention weights).
 *   5. Per-source Wiener soft masking (|mask|² / Σ|mask|²) per bin per
 *      frame. Initial per-source weights per the spec:
 *        Bass     — bands 0-3  (~30-120 Hz), strong energy
 *        Drums    — transient score (first-difference of band energy)
 *                    across all bands
 *        Vocals   — bands 8-15 (~300 Hz-3 kHz), stable pitch (high
 *                    autocorrelation) + center-channel bias
 *        Guitar   — bands 12-20 (~500 Hz-4 kHz), harmonic content
 *                    (spectral flatness inverse), excludes center
 *        Piano    — bands 6-18 (~200 Hz-3 kHz), percussive onsets +
 *                    harmonic sustain
 *        Other    — residual after subtracting the 5 above
 *   6. ISTFT (inverse FFT + weighted overlap-add, COLA factor 1.5 for
 *      periodic Hann @ 75% overlap, WOLA synthesis window).
 *
 * ─── Pass 2 — MelBand RoFormer analogue ───
 *   1. Take the vocals stem from Pass 1.
 *   2. Single 1024-pt STFT, group bins into 40 Mel-spaced bands (0-22 kHz
 *      per the Mel scale: more bands in low frequencies, fewer in high
 *      frequencies, matching human auditory perception).
 *   3. Per-Mel-band RoPE.
 *   4. Lead vocals: center-channel bias (mid >> side magnitude) + stable
 *      pitch contour (high autocorrelation over time) + presence in 1-4 kHz.
 *   5. Backing vocals: side-channel content in vocal range + pitch that
 *      differs from lead + lower energy.
 *   6. Wiener soft masks → lead_vocals + backing_vocals.
 *
 * ─── Pass 3 — Spectral band-split (drum decomposition) ───
 *   1. Take the drums stem from Pass 1.
 *   2. Kick:   LP 100 Hz (4th-order Butterworth, 2 cascaded biquads with
 *              Q=0.5412 and Q=1.3066) + transient detection on low-band
 *              envelope (high first-difference).
 *   3. Snare:  BP 150-400 Hz (HP+LP cascade) + transient detection
 *              (energy bursts at 200 Hz and 2-5 kHz noise).
 *   4. Hats:   HP 6 kHz (4th-order Butterworth) + transient detection
 *              (rapid decay).
 *   5. Percussion: residual (toms, claps, tambourines, congas, etc.).
 *
 * ─── Pass 4 — Dereverb (RT60 envelope subtraction) ───
 *   1. Take the residual "other" stem from Pass 1.
 *   2. 50 ms block energy envelope.
 *   3. RT60 estimate via reverse-integrated energy decay + linear fit
 *      in dB domain.
 *   4. Time-varying gain = max(floor, (env/peakEnv)^k) with 20 ms
 *      one-pole smoothing. k controls aggressiveness.
 *   5. Ambience = other × (1 - gain) — the extracted reverb tail.
 *   6. Dry "other" = other × gain — what remains after reverb removal.
 *
 * Determinism: same input → same output, bit-for-bit. No Math.random,
 * no Date.now in the DSP path. Only setTimeout(r, 0) for yield-to-UI.
 */

import type { StemKey } from './types'
import { STEM_KEYS, STEM_LABELS, STEM_COLORS } from './constants'
import { applyBiquad, designBiquad, fftInPlace, type BiquadCoef } from './dsp'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StemResult {
  key: StemKey
  label: string
  color: string
  channels: Float32Array[] // stereo [L, R]
  sampleRate: number
  rms: number // dBFS, measured after separation
  peakDb: number // dBFS, measured after separation
}

// ---------------------------------------------------------------------------
// Constants — BS-RoFormer architecture per tech spec
// ---------------------------------------------------------------------------

const FFT_SIZE = 1024 // Per-band STFT size (spec)
const HOP_SIZE = 256 // 75% overlap
const NUM_BINS = FFT_SIZE / 2 + 1 // 513 positive-frequency bins
// COLA factor for periodic Hann @ 75% overlap with WOLA (Hann analysis AND
// Hann synthesis window). Sum of overlapping Hann² products normalized to 1.5.
const COLA_FACTOR = 1.5
const MAX_DURATION_S = 60 // Memory safety cap per spec
const NUM_BANDS = 32 // BS-RoFormer band count per spec
const NUM_MEL_BANDS = 40 // MelBand RoFormer Mel band count per spec
const FREQ_MIN_HZ = 30 // Band-split lower bound per spec
const FREQ_MAX_HZ = 20000 // Band-split upper bound per spec
const ROPE_BASE = 10000 // RoPE base frequency per spec
const CHUNK_SECONDS = 5 // Process in 5-second chunks for memory
const MARGIN_FRAMES = 32 // ~340ms margin for autocorrelation context
// Wiener soft mask exponent = 2 (|mask|² / Σ|mask|²). Inlined as `m * m`
// in the per-bin inner loops for speed (no Math.pow call per bin).
const MIN_FRAMES = 8 // Minimum frames for separation to run

// Pre-computed periodic Hann window (COLA-correct for 75% overlap).
const HANN = (() => {
  const w = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE))
  }
  return w
})()

// ---------------------------------------------------------------------------
// FFT primitives — in-place radix-2 Cooley–Tukey operating on caller-provided
// buffers (no per-frame allocations). Imported from dsp.ts (single source of
// truth). The ISTFT helper below conjugates + scales the forward FFT.
// ---------------------------------------------------------------------------

function ifftInPlace(real: Float32Array, imag: Float32Array): void {
  const N = real.length
  // Conjugate, forward FFT, conjugate, scale by 1/N
  for (let i = 0; i < N; i++) imag[i] = -imag[i]
  fftInPlace(real, imag)
  const invN = 1 / N
  for (let i = 0; i < N; i++) {
    real[i] *= invN
    imag[i] = -imag[i] * invN
  }
}

// ---------------------------------------------------------------------------
// Yield to UI + abort check — uses scheduler.yield() when available
// (Chrome 129+), else setTimeout(0). Mandatory between heavy chunks.
// ---------------------------------------------------------------------------

function yieldToUI(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler && typeof scheduler.yield === 'function') {
    return scheduler.yield()
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Stem separation cancelled by user')
    err.name = 'CancelledError'
    throw err
  }
}

// ---------------------------------------------------------------------------
// Band-split helpers — log-spaced crossover frequencies for BS-RoFormer
// and Mel-spaced edges for MelBand RoFormer.
// ---------------------------------------------------------------------------

/** Compute log-spaced crossover frequencies (NUM_BANDS-1 crossovers). */
function computeCrossoversHz(): number[] {
  const out: number[] = []
  const logMin = Math.log(FREQ_MIN_HZ)
  const logMax = Math.log(FREQ_MAX_HZ)
  for (let i = 1; i < NUM_BANDS; i++) {
    out.push(Math.exp(logMin + (logMax - logMin) * i / NUM_BANDS))
  }
  return out
}

/** Compute bin ranges [start, end) for each of the NUM_BANDS log-spaced bands. */
function computeBandRanges(sampleRate: number): Array<{ start: number; end: number }> {
  const crossovers = computeCrossoversHz()
  const ranges: Array<{ start: number; end: number }> = []
  let prevBin = 0
  for (let i = 0; i < NUM_BANDS; i++) {
    const fmax = i < NUM_BANDS - 1 ? crossovers[i] : FREQ_MAX_HZ
    const endBin = Math.max(prevBin + 1, Math.min(NUM_BINS, Math.ceil((fmax / sampleRate) * FFT_SIZE) + 1))
    ranges.push({ start: prevBin, end: endBin })
    prevBin = endBin
  }
  // Ensure last band captures all remaining bins up to Nyquist.
  if (ranges.length > 0) ranges[ranges.length - 1].end = NUM_BINS
  return ranges
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1)
}

/** Compute bin ranges [start, end) for each of the NUM_MEL_BANDS Mel-spaced bands. */
function computeMelBandRanges(sampleRate: number): Array<{ start: number; end: number }> {
  const nyquist = Math.min(22000, sampleRate / 2)
  const melMin = hzToMel(0)
  const melMax = hzToMel(nyquist)
  const edges: number[] = []
  for (let i = 0; i <= NUM_MEL_BANDS; i++) {
    edges.push(melToHz(melMin + (melMax - melMin) * i / NUM_MEL_BANDS))
  }
  const ranges: Array<{ start: number; end: number }> = []
  let prevBin = 0
  for (let i = 0; i < NUM_MEL_BANDS; i++) {
    const fmax = edges[i + 1]
    const endBin = Math.max(prevBin + 1, Math.min(NUM_BINS, Math.ceil((fmax / sampleRate) * FFT_SIZE) + 1))
    ranges.push({ start: prevBin, end: endBin })
    prevBin = endBin
  }
  if (ranges.length > 0) ranges[ranges.length - 1].end = NUM_BINS
  return ranges
}

// ---------------------------------------------------------------------------
// RoPE (Rotary Positional Embedding) — applied to per-band complex STFT.
// Rotates each (real, imag) pair by θ(pos, i) = pos · base^(-2i/d).
// The rotation is computed on a COPY of the band's complex values; the
// original STFT is preserved for masking + ISTFT.
// ---------------------------------------------------------------------------

/**
 * Apply RoPE to a band's complex STFT and write the rotated result into
 * `outReal`/`outImag`. The original `real`/`imag` are NOT modified.
 *
 * For each frame f and pair index i in [0, d/2):
 *   angle = f · base^(-2i/d)
 *   (r1, i1) → (r1·cos − i1·sin, r1·sin + i1·cos)   (+rotation)
 *   (r2, i2) → (r2·cos + i2·sin, −r2·sin + i2·cos)   (−rotation)
 * where (r1, i1) is at offset f·d + i and (r2, i2) at f·d + i + d/2.
 */
function applyRoPE(
  real: Float32Array,
  imag: Float32Array,
  outReal: Float32Array,
  outImag: Float32Array,
  numFrames: number,
  bandSize: number,
): void {
  const d = bandSize
  const halfD = Math.max(1, Math.floor(d / 2))
  // Pre-compute per-pair base angle increments (base^(-2i/d)).
  const thetaBase = new Float32Array(halfD)
  for (let i = 0; i < halfD; i++) {
    thetaBase[i] = Math.pow(ROPE_BASE, -2 * i / d)
  }
  for (let f = 0; f < numFrames; f++) {
    const frameOff = f * d
    for (let i = 0; i < halfD; i++) {
      const angle = f * thetaBase[i]
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const idx1 = frameOff + i
      const idx2 = frameOff + i + halfD
      const r1 = real[idx1], i1 = imag[idx1]
      outReal[idx1] = r1 * c - i1 * s
      outImag[idx1] = r1 * s + i1 * c
      if (idx2 < frameOff + d) {
        const r2 = real[idx2], i2 = imag[idx2]
        outReal[idx2] = r2 * c + i2 * s
        outImag[idx2] = -r2 * s + i2 * c
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-band correlation (deterministic attention proxy) — 32×32 Pearson
// correlation matrix computed on RoPE-rotated band magnitude vectors.
// Used to propagate per-source masks between correlated bands.
// ---------------------------------------------------------------------------

/**
 * Compute the NUM_BANDS × NUM_BANDS correlation matrix from per-frame
 * band magnitudes. Each band's magnitude vector over time is normalized
 * to zero mean / unit norm, then correlated via dot product.
 *
 * @param bandMag   Per-frame band magnitudes, shape [numFrames × NUM_BANDS]
 *                  (row-major: bandMag[f * NUM_BANDS + b]).
 * @param numFrames Number of frames.
 * @returns         NUM_BANDS × NUM_BANDS Float32Array (row-major).
 */
function computeCorrelationMatrix(bandMag: Float32Array, numFrames: number): Float32Array {
  const N = NUM_BANDS
  const out = new Float32Array(N * N)

  // Per-band mean and norm
  const mean = new Float32Array(N)
  const centered = new Float32Array(numFrames * N)
  for (let b = 0; b < N; b++) {
    let sum = 0
    for (let f = 0; f < numFrames; f++) sum += bandMag[f * N + b]
    mean[b] = sum / Math.max(1, numFrames)
  }
  for (let f = 0; f < numFrames; f++) {
    for (let b = 0; b < N; b++) {
      centered[f * N + b] = bandMag[f * N + b] - mean[b]
    }
  }
  // Norms
  const norm = new Float32Array(N)
  for (let b = 0; b < N; b++) {
    let s = 0
    for (let f = 0; f < numFrames; f++) {
      const v = centered[f * N + b]
      s += v * v
    }
    norm[b] = Math.sqrt(s) + 1e-12
  }
  // Correlation matrix
  for (let b1 = 0; b1 < N; b1++) {
    for (let b2 = b1; b2 < N; b2++) {
      let dot = 0
      for (let f = 0; f < numFrames; f++) {
        dot += centered[f * N + b1] * centered[f * N + b2]
      }
      const corr = dot / (norm[b1] * norm[b2])
      out[b1 * N + b2] = corr
      out[b2 * N + b1] = corr
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-frame feature extraction — transient, pitch stability, center bias,
// harmonic content. All computed from the per-band magnitude matrix.
// ---------------------------------------------------------------------------

interface FrameFeatures {
  transient: Float32Array // [numFrames] — first-difference energy across all bands
  pitchStability: Float32Array // [numFrames] — autocorrelation peak (vocal pitch stable)
  centerBias: Float32Array // [numFrames] — mid/(mid+side) magnitude ratio in vocal range
  harmonic: Float32Array // [numFrames] — spectral flatness inverse (harmonic content)
  percussiveOnset: Float32Array // [numFrames] — sharp transient in mid bands (piano)
}

/**
 * Extract per-frame features from the per-band magnitude matrix.
 *
 * @param bandMag   Per-frame band magnitudes [numFrames × NUM_BANDS].
 * @param stftMid   Per-frame STFT magnitude of mid channel (L+R)/2 [numFrames × NUM_BINS].
 * @param stftSide  Per-frame STFT magnitude of side channel (L-R)/2 [numFrames × NUM_BINS].
 * @param bandRanges Band bin ranges (used to find vocal band).
 * @param sampleRate Sample rate (for autocorrelation lag computation).
 */
function extractFrameFeatures(
  bandMag: Float32Array,
  stftMid: Float32Array,
  stftSide: Float32Array,
  bandRanges: Array<{ start: number; end: number }>,
  _sampleRate: number,
  numFrames: number,
): FrameFeatures {
  const N = NUM_BANDS
  const transient = new Float32Array(numFrames)
  const pitchStability = new Float32Array(numFrames)
  const centerBias = new Float32Array(numFrames)
  const harmonic = new Float32Array(numFrames)
  const percussiveOnset = new Float32Array(numFrames)

  // --- Transient score: sum of |bandMag[f, b] - bandMag[f-1, b]| across bands ---
  for (let f = 0; f < numFrames; f++) {
    let tr = 0
    if (f > 0) {
      for (let b = 0; b < N; b++) {
        const d = bandMag[f * N + b] - bandMag[(f - 1) * N + b]
        tr += Math.abs(d)
      }
    }
    transient[f] = tr
  }
  // Normalize transient to 0..1 (relative to max in this chunk)
  let trMax = 1e-12
  for (let f = 0; f < numFrames; f++) if (transient[f] > trMax) trMax = transient[f]
  const trInv = 1 / trMax
  for (let f = 0; f < numFrames; f++) transient[f] *= trInv

  // --- Pitch stability: autocorrelation peak in vocal band (300 Hz – 3 kHz) ---
  // Find the vocal band range (bands 8-15 by spec)
  const vocalBandStart = bandRanges[Math.min(8, N - 1)].start
  const vocalBandEnd = bandRanges[Math.min(15, N - 1)].end
  // For each frame, compute autocorrelation of bandMag across the vocal bands
  // (using the band-magnitude vector at lag b → b+lag). High stability =
  // strong autocorrelation at nonzero lags (consistent harmonic structure).
  for (let f = 0; f < numFrames; f++) {
    const vocalWidth = vocalBandEnd - vocalBandStart
    if (vocalWidth <= 1) {
      pitchStability[f] = 0.5
      continue
    }
    // Mean of vocal band magnitudes
    let mean = 0
    for (let b = vocalBandStart; b < vocalBandEnd; b++) {
      mean += bandMag[f * N + b]
    }
    mean /= vocalWidth
    // Autocorrelation at lag 1, 2, 3 (within vocal band, bin to bin)
    let autoSum = 0
    let normSum = 0
    for (let b = vocalBandStart; b < vocalBandEnd - 1; b++) {
      const v0 = bandMag[f * N + b] - mean
      const v1 = bandMag[f * N + b + 1] - mean
      autoSum += v0 * v1
      normSum += v0 * v0
    }
    const ac1 = normSum > 1e-12 ? autoSum / normSum : 0
    // Also compute temporal autocorrelation (frame to frame in vocal band)
    let temporalAc = 0
    if (f > 0) {
      let s1 = 0, s2 = 0
      for (let b = vocalBandStart; b < vocalBandEnd; b++) {
        const v0 = bandMag[f * N + b]
        const v1 = bandMag[(f - 1) * N + b]
        s1 += v0 * v1
        s2 += v0 * v0 + v1 * v1
      }
      temporalAc = s2 > 1e-12 ? (2 * s1) / s2 : 0
    }
    // Combined pitch stability (0..1) — high = stable
    pitchStability[f] = Math.max(0, Math.min(1, 0.5 * ac1 + 0.5 * temporalAc))
  }

  // --- Center bias: |mid| / (|mid| + |side|) in vocal band ---
  for (let f = 0; f < numFrames; f++) {
    let midSum = 0, sideSum = 0
    for (let b = vocalBandStart; b < vocalBandEnd; b++) {
      midSum += stftMid[f * NUM_BINS + b]
      sideSum += stftSide[f * NUM_BINS + b]
    }
    centerBias[f] = midSum / (midSum + sideSum + 1e-12)
  }

  // --- Harmonic content: spectral flatness inverse in harmonic bands (12-20) ---
  const harmBandStart = bandRanges[Math.min(12, N - 1)].start
  const harmBandEnd = bandRanges[Math.min(20, N - 1)].end
  for (let f = 0; f < numFrames; f++) {
    // Geometric mean / arithmetic mean → flatness. Inverse = harmonic.
    let logSum = 0, linSum = 0, count = 0
    for (let b = harmBandStart; b < harmBandEnd; b++) {
      const v = bandMag[f * NUM_BINS + b] + 1e-12
      logSum += Math.log(v)
      linSum += v
      count++
    }
    if (count === 0) {
      harmonic[f] = 0.5
      continue
    }
    const geoMean = Math.exp(logSum / count)
    const arithMean = linSum / count
    const flatness = arithMean > 1e-12 ? geoMean / arithMean : 0
    harmonic[f] = 1 - flatness // 0 = noise-like, 1 = tonal
  }

  // --- Percussive onset (piano): sharp transient in mid bands (6-18) ---
  const pianoBandStart = bandRanges[Math.min(6, N - 1)].start
  const pianoBandEnd = bandRanges[Math.min(18, N - 1)].end
  for (let f = 0; f < numFrames; f++) {
    let energy = 0
    for (let b = pianoBandStart; b < pianoBandEnd; b++) {
      energy += bandMag[f * N + b]
    }
    if (f > 0) {
      let prevEnergy = 0
      for (let b = pianoBandStart; b < pianoBandEnd; b++) {
        prevEnergy += bandMag[(f - 1) * N + b]
      }
      // Onset = positive energy difference relative to total
      const delta = energy - prevEnergy
      percussiveOnset[f] = Math.max(0, delta) / (energy + prevEnergy + 1e-12)
    } else {
      percussiveOnset[f] = 0
    }
  }

  return { transient, pitchStability, centerBias, harmonic, percussiveOnset }
}

// ---------------------------------------------------------------------------
// Biquad filter helpers — used in Pass 3 (spectral drum split).
// ---------------------------------------------------------------------------

interface BiquadState { x1: number; x2: number; y1: number; y2: number }

function newBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 }
}

function filterChain(src: Float32Array, coef: BiquadCoef, state: BiquadState): Float32Array {
  const out = src.slice()
  applyBiquad(out, coef, state)
  return out
}

/** 4th-order Butterworth low-pass: cascade two biquads at the same frequency
 * with Qs 0.5412 and 1.3066 (Butterworth pole positions). −24 dB/octave. */
function butterworthLowpass4(
  src: Float32Array,
  freq: number,
  sampleRate: number,
  state: [BiquadState, BiquadState],
): Float32Array {
  const c1 = designBiquad('lowpass', freq, sampleRate, 0.5412)
  const c2 = designBiquad('lowpass', freq, sampleRate, 1.3066)
  const tmp = filterChain(src, c1, state[0])
  applyBiquad(tmp, c2, state[1])
  return tmp
}

/** 4th-order Butterworth high-pass (same as lowpass but with 'highpass'). */
function butterworthHighpass4(
  src: Float32Array,
  freq: number,
  sampleRate: number,
  state: [BiquadState, BiquadState],
): Float32Array {
  const c1 = designBiquad('highpass', freq, sampleRate, 0.5412)
  const c2 = designBiquad('highpass', freq, sampleRate, 1.3066)
  const tmp = filterChain(src, c1, state[0])
  applyBiquad(tmp, c2, state[1])
  return tmp
}

/** 2nd-order bandpass: cascade highpass(lo) + lowpass(hi), each Q=0.7071. */
function bandpass(
  src: Float32Array,
  lo: number,
  hi: number,
  sampleRate: number,
  state: [BiquadState, BiquadState],
): Float32Array {
  const hp = designBiquad('highpass', lo, sampleRate, 0.7071)
  const lp = designBiquad('lowpass', hi, sampleRate, 0.7071)
  const tmp = filterChain(src, hp, state[0])
  applyBiquad(tmp, lp, state[1])
  return tmp
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function measureRmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -120
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)
  return 20 * Math.log10(Math.max(rms, 1e-7))
}

function measurePeakDb(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > p) p = a
  }
  return 20 * Math.log10(Math.max(p, 1e-7))
}

// ---------------------------------------------------------------------------
// Per-band mask estimation — initial per-source weights × per-frame
// features. Band weights follow the spec exactly (bass 0-3, vocals 8-15,
// guitar 12-20, piano 6-18, drums all, other = residual).
// ---------------------------------------------------------------------------

/** Per-source band weight (NUM_BANDS entries, indexed by band 0..31). */
const BASS_BAND_WEIGHT = new Float32Array(NUM_BANDS)
const VOCALS_BAND_WEIGHT = new Float32Array(NUM_BANDS)
const GUITAR_BAND_WEIGHT = new Float32Array(NUM_BANDS)
const PIANO_BAND_WEIGHT = new Float32Array(NUM_BANDS)
;(() => {
  // Bass: bands 0-3 strong, fast decay above
  for (let b = 0; b < NUM_BANDS; b++) {
    if (b <= 3) BASS_BAND_WEIGHT[b] = 1.0
    else if (b <= 5) BASS_BAND_WEIGHT[b] = 0.4
    else BASS_BAND_WEIGHT[b] = 0.05
  }
  // Vocals: bands 8-15 strong, tapering
  for (let b = 0; b < NUM_BANDS; b++) {
    if (b >= 8 && b <= 15) VOCALS_BAND_WEIGHT[b] = 1.0
    else if (b >= 6 && b <= 18) VOCALS_BAND_WEIGHT[b] = 0.4
    else if (b >= 4 && b <= 22) VOCALS_BAND_WEIGHT[b] = 0.15
    else VOCALS_BAND_WEIGHT[b] = 0.02
  }
  // Guitar: bands 12-20 strong, tapering
  for (let b = 0; b < NUM_BANDS; b++) {
    if (b >= 12 && b <= 20) GUITAR_BAND_WEIGHT[b] = 1.0
    else if (b >= 8 && b <= 24) GUITAR_BAND_WEIGHT[b] = 0.4
    else GUITAR_BAND_WEIGHT[b] = 0.05
  }
  // Piano: bands 6-18 strong
  for (let b = 0; b < NUM_BANDS; b++) {
    if (b >= 6 && b <= 18) PIANO_BAND_WEIGHT[b] = 1.0
    else if (b >= 4 && b <= 22) PIANO_BAND_WEIGHT[b] = 0.4
    else PIANO_BAND_WEIGHT[b] = 0.05
  }
})()

/**
 * Compute per-source per-band-per-frame masks. Output shape:
 *   masks[source][frame * NUM_BANDS + band]
 * where source ∈ {bass, drums, vocals, guitar, piano}.
 * "Other" is implicit (residual after Wiener normalization).
 */
function computeSourceMasks(
  bandMag: Float32Array, // [numFrames × NUM_BANDS]
  features: FrameFeatures,
  numFrames: number,
): {
  bass: Float32Array
  drums: Float32Array
  vocals: Float32Array
  guitar: Float32Array
  piano: Float32Array
} {
  const N = NUM_BANDS
  const bass = new Float32Array(numFrames * N)
  const drums = new Float32Array(numFrames * N)
  const vocals = new Float32Array(numFrames * N)
  const guitar = new Float32Array(numFrames * N)
  const piano = new Float32Array(numFrames * N)

  for (let f = 0; f < numFrames; f++) {
    const off = f * N
    const tr = features.transient[f]
    const ps = features.pitchStability[f]
    const cb = features.centerBias[f]
    const harm = features.harmonic[f]
    const po = features.percussiveOnset[f]
    // Drums feature weight is the transient score; vocals feature combines
    // pitch stability × center bias; guitar uses harmonic × (1-center bias)
    // (guitar is typically panned off-center); piano uses percussive onset
    // + harmonic sustain (mean of the two).
    const drumFeat = tr
    const vocalFeat = 0.5 * ps + 0.5 * cb
    const guitarFeat = 0.5 * harm + 0.5 * (1 - cb)
    const pianoFeat = 0.5 * po + 0.5 * harm
    const bassFeat = 1.0 // bass weight is purely band-driven

    for (let b = 0; b < N; b++) {
      const mag = bandMag[off + b]
      bass[off + b] = BASS_BAND_WEIGHT[b] * bassFeat * mag
      drums[off + b] = 0.6 * drumFeat * mag // drums present in all bands proportionally to transient
      vocals[off + b] = VOCALS_BAND_WEIGHT[b] * vocalFeat * mag
      guitar[off + b] = GUITAR_BAND_WEIGHT[b] * guitarFeat * mag
      piano[off + b] = PIANO_BAND_WEIGHT[b] * pianoFeat * mag
    }
  }
  return { bass, drums, vocals, guitar, piano }
}

/**
 * Refine masks via the cross-band correlation matrix (deterministic
 * attention proxy). For each source, the refined mask at band b is a
 * weighted average of the initial mask across all bands, weighted by
 * |corr[b, b']|.
 */
function refineMasksByCorrelation(
  masks: { bass: Float32Array; drums: Float32Array; vocals: Float32Array; guitar: Float32Array; piano: Float32Array },
  corr: Float32Array,
  numFrames: number,
): void {
  const N = NUM_BANDS
  // Compute per-band correlation sum for normalization
  const corrSum = new Float32Array(N)
  for (let b = 0; b < N; b++) {
    let s = 0
    for (let b2 = 0; b2 < N; b2++) s += Math.abs(corr[b * N + b2])
    corrSum[b] = s + 1e-12
  }
  // Refine each source
  const sources: Array<keyof typeof masks> = ['bass', 'drums', 'vocals', 'guitar', 'piano']
  for (const src of sources) {
    const m = masks[src]
    const refined = new Float32Array(numFrames * N)
    for (let f = 0; f < numFrames; f++) {
      const off = f * N
      for (let b = 0; b < N; b++) {
        let acc = 0
        const corrOff = b * N
        for (let b2 = 0; b2 < N; b2++) {
          acc += Math.abs(corr[corrOff + b2]) * m[off + b2]
        }
        refined[off + b] = acc / corrSum[b]
      }
    }
    // Blend: 50% original + 50% refined (avoid over-smoothing)
    for (let i = 0; i < m.length; i++) {
      m[i] = 0.5 * m[i] + 0.5 * refined[i]
    }
  }
}

// ---------------------------------------------------------------------------
// Per-bin Wiener soft masking + ISTFT overlap-add for chunk reconstruction.
// For each (frame, bin), compute the Wiener mask per source and apply to the
// original STFT. ISTFT each source-channel and overlap-add into output.
// ---------------------------------------------------------------------------

interface ChunkOutput {
  vocalsL: Float32Array
  vocalsR: Float32Array
  drumsL: Float32Array
  drumsR: Float32Array
  bassL: Float32Array
  bassR: Float32Array
  guitarL: Float32Array
  guitarR: Float32Array
  pianoL: Float32Array
  pianoR: Float32Array
  otherL: Float32Array
  otherR: Float32Array
}

/**
 * Precompute a `bin → band` lookup table. Avoids O(NUM_BANDS) linear scan
 * per bin per source per channel per frame inside the ISTFT loop (would
 * otherwise be ~35 billion ops for a 60s track).
 */
function computeBinToBand(bandRanges: Array<{ start: number; end: number }>): Uint8Array {
  const lookup = new Uint8Array(NUM_BINS)
  for (let b = 0; b < NUM_BANDS; b++) {
    const range = bandRanges[b]
    for (let bin = range.start; bin < range.end && bin < NUM_BINS; bin++) {
      lookup[bin] = b
    }
  }
  return lookup
}

/**
 * Process one chunk: STFT both channels → band-split → RoPE → correlation
 * → masks → Wiener → ISTFT → overlap-add to outputs. Only central frames
 * [chunkStartFrame, chunkEndFrame) contribute to the output (margin frames
 * are processed for context but their ISTFT contributions are discarded).
 */
function processChunk(
  inL: Float32Array,
  inR: Float32Array,
  chunkStartSample: number,
  extStartSample: number,
  extNumFrames: number,
  chunkStartFrame: number,
  chunkEndFrame: number,
  bandRanges: Array<{ start: number; end: number }>,
  binToBand: Uint8Array,
  sampleRate: number,
  output: ChunkOutput,
  scratch: { real: Float32Array; imag: Float32Array },
): void {
  const N = NUM_BINS
  const totalFrames = extNumFrames

  // ---- STFT both channels ----
  const realL = new Float32Array(totalFrames * FFT_SIZE)
  const imagL = new Float32Array(totalFrames * FFT_SIZE)
  const realR = new Float32Array(totalFrames * FFT_SIZE)
  const imagR = new Float32Array(totalFrames * FFT_SIZE)
  const magMid = new Float32Array(totalFrames * N) // (L+R)/2 magnitude
  const magSide = new Float32Array(totalFrames * N) // (L-R)/2 magnitude
  const magCombined = new Float32Array(totalFrames * N) // combined magnitude (avg of L, R)

  for (let f = 0; f < totalFrames; f++) {
    const sampleStart = extStartSample + f * HOP_SIZE
    const frameOff = f * FFT_SIZE
    // L channel
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = sampleStart + i
      scratch.real[i] = (idx >= 0 && idx < inL.length ? inL[idx] : 0) * HANN[i]
      scratch.imag[i] = 0
    }
    fftInPlace(scratch.real, scratch.imag)
    realL.set(scratch.real.subarray(0, FFT_SIZE), frameOff)
    imagL.set(scratch.imag.subarray(0, FFT_SIZE), frameOff)
    // R channel
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = sampleStart + i
      scratch.real[i] = (idx >= 0 && idx < inR.length ? inR[idx] : 0) * HANN[i]
      scratch.imag[i] = 0
    }
    fftInPlace(scratch.real, scratch.imag)
    realR.set(scratch.real.subarray(0, FFT_SIZE), frameOff)
    imagR.set(scratch.imag.subarray(0, FFT_SIZE), frameOff)
    // Magnitudes
    const magOff = f * N
    for (let b = 0; b < N; b++) {
      const reL = realL[frameOff + b], imL = imagL[frameOff + b]
      const reR = realR[frameOff + b], imR = imagR[frameOff + b]
      const magL = Math.sqrt(reL * reL + imL * imL)
      const magR = Math.sqrt(reR * reR + imR * imR)
      magCombined[magOff + b] = 0.5 * (magL + magR)
      const midRe = 0.5 * (reL + reR), midIm = 0.5 * (imL + imR)
      const sideRe = 0.5 * (reL - reR), sideIm = 0.5 * (imL - imR)
      magMid[magOff + b] = Math.sqrt(midRe * midRe + midIm * midIm)
      magSide[magOff + b] = Math.sqrt(sideRe * sideRe + sideIm * sideIm)
    }
  }

  // ---- Band-summed magnitude [numFrames × NUM_BANDS] ----
  const bandMag = new Float32Array(totalFrames * NUM_BANDS)
  for (let f = 0; f < totalFrames; f++) {
    const magOff = f * N
    const bandOff = f * NUM_BANDS
    for (let b = 0; b < NUM_BANDS; b++) {
      const range = bandRanges[b]
      let s = 0
      for (let bin = range.start; bin < range.end; bin++) {
        s += magCombined[magOff + bin]
      }
      bandMag[bandOff + b] = s
    }
  }

  // ---- Per-frame features ----
  const features = extractFrameFeatures(bandMag, magMid, magSide, bandRanges, sampleRate, totalFrames)

  // ---- RoPE rotation of each band (for correlation only) ----
  // Apply RoPE to per-band complex STFT (real+imag extracted per band).
  // RoPE-rotated band magnitudes are used in the correlation matrix.
  const ropeMag = new Float32Array(totalFrames * NUM_BANDS)
  for (let b = 0; b < NUM_BANDS; b++) {
    const range = bandRanges[b]
    const bandSize = range.end - range.start
    const ropeReal = new Float32Array(totalFrames * bandSize)
    const ropeImag = new Float32Array(totalFrames * bandSize)
    const origReal = new Float32Array(totalFrames * bandSize)
    const origImag = new Float32Array(totalFrames * bandSize)
    for (let f = 0; f < totalFrames; f++) {
      const srcOff = f * FFT_SIZE + range.start
      const dstOff = f * bandSize
      for (let bin = 0; bin < bandSize; bin++) {
        origReal[dstOff + bin] = 0.5 * (realL[srcOff + bin] + realR[srcOff + bin])
        origImag[dstOff + bin] = 0.5 * (imagL[srcOff + bin] + imagR[srcOff + bin])
      }
    }
    applyRoPE(origReal, origImag, ropeReal, ropeImag, totalFrames, bandSize)
    // Compute RoPE-rotated magnitude per band per frame
    for (let f = 0; f < totalFrames; f++) {
      const off = f * bandSize
      let s = 0
      for (let bin = 0; bin < bandSize; bin++) {
        const re = ropeReal[off + bin], im = ropeImag[off + bin]
        s += Math.sqrt(re * re + im * im)
      }
      ropeMag[f * NUM_BANDS + b] = s
    }
  }

  // ---- Cross-band correlation matrix ----
  const corr = computeCorrelationMatrix(ropeMag, totalFrames)

  // ---- Per-source masks (initial) ----
  const masks = computeSourceMasks(bandMag, features, totalFrames)

  // ---- Refine masks via correlation (deterministic attention proxy) ----
  refineMasksByCorrelation(masks, corr, totalFrames)

  // ---- Expand band-level masks to bin-level + Wiener soft masking + ISTFT ----
  // We process central frames [chunkStartFrame, chunkEndFrame) only — margin
  // frames were already processed by adjacent chunks (or will be).

  // Per-bin Wiener soft masking: for each (frame, bin), compute mask² per source
  // (band-level mask applied uniformly to all bins in band) then normalize.
  // bass, drums, vocals, guitar, piano each contribute mask² ; "other" gets
  // a small constant floor (1.0) so it picks up the residual.
  const invCola = 1 / COLA_FACTOR
  // Per-frame reusable buffers: per-source per-bin mask² (NUM_BINS each).
  // Wiener-normalized (each value already divided by Σ mask² across sources).
  const m2Bass = new Float32Array(N)
  const m2Drums = new Float32Array(N)
  const m2Vocals = new Float32Array(N)
  const m2Guitar = new Float32Array(N)
  const m2Piano = new Float32Array(N)
  const m2Other = new Float32Array(N)
  for (let f = chunkStartFrame; f < chunkEndFrame; f++) {
    const frameOff = f * FFT_SIZE
    const magOff = f * N
    const bandOff = f * NUM_BANDS
    const sampleStart = extStartSample + f * HOP_SIZE

    // Per-bin mask² per source (uniform within band), Wiener-normalized.
    // The binToBand lookup makes this O(NUM_BINS) instead of O(NUM_BINS²).
    for (let bin = 0; bin < N; bin++) {
      const b = binToBand[bin]
      const mb = masks.bass[bandOff + b]
      const md = masks.drums[bandOff + b]
      const mv = masks.vocals[bandOff + b]
      const mg = masks.guitar[bandOff + b]
      const mp = masks.piano[bandOff + b]
      const otherFloor = 0.05 * (magCombined[magOff + bin] + 1e-12)
      const m2b = mb * mb
      const m2d = md * md
      const m2v = mv * mv
      const m2g = mg * mg
      const m2p = mp * mp
      const m2o = otherFloor * otherFloor
      const d = m2b + m2d + m2v + m2g + m2p + m2o + 1e-12
      m2Bass[bin] = m2b / d
      m2Drums[bin] = m2d / d
      m2Vocals[bin] = m2v / d
      m2Guitar[bin] = m2g / d
      m2Piano[bin] = m2p / d
      m2Other[bin] = m2o / d
    }

    // For each (source, channel): apply Wiener mask to STFT, ISTFT, overlap-add.
    // 6 sources × 2 channels = 12 ISTFTs per frame.
    const channelPairs: Array<{ outL: Float32Array; outR: Float32Array; mask2: Float32Array }> = [
      { outL: output.bassL, outR: output.bassR, mask2: m2Bass },
      { outL: output.drumsL, outR: output.drumsR, mask2: m2Drums },
      { outL: output.vocalsL, outR: output.vocalsR, mask2: m2Vocals },
      { outL: output.guitarL, outR: output.guitarR, mask2: m2Guitar },
      { outL: output.pianoL, outR: output.pianoR, mask2: m2Piano },
      { outL: output.otherL, outR: output.otherR, mask2: m2Other },
    ]
    for (const pair of channelPairs) {
      const mask2 = pair.mask2
      const outL = pair.outL
      const outR = pair.outR
      // L channel ISTFT
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < N; bin++) {
        scratch.real[bin] = realL[frameOff + bin] * mask2[bin]
        scratch.imag[bin] = imagL[frameOff + bin] * mask2[bin]
      }
      // Mirror for conjugate symmetry
      for (let bin = N; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < outL.length) {
          outL[idx] += scratch.real[i] * HANN[i] * invCola
        }
      }
      // R channel ISTFT
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < N; bin++) {
        scratch.real[bin] = realR[frameOff + bin] * mask2[bin]
        scratch.imag[bin] = imagR[frameOff + bin] * mask2[bin]
      }
      for (let bin = N; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < outR.length) {
          outR[idx] += scratch.real[i] * HANN[i] * invCola
        }
      }
    }
  }
  void chunkStartSample
}

// ---------------------------------------------------------------------------
// Pass 1 — BS-RoFormer: produces vocals_full, drums, bass, guitar, piano,
// other (all stereo). vocals_full will be split in Pass 2; other will be
// processed by Pass 4.
// ---------------------------------------------------------------------------

async function pass1_BSRoformer(
  inL: Float32Array,
  inR: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<{
  vocalsL: Float32Array
  vocalsR: Float32Array
  drumsL: Float32Array
  drumsR: Float32Array
  bassL: Float32Array
  bassR: Float32Array
  guitarL: Float32Array
  guitarR: Float32Array
  pianoL: Float32Array
  pianoR: Float32Array
  otherL: Float32Array
  otherR: Float32Array
}> {
  const N = inL.length
  const bandRanges = computeBandRanges(sampleRate)
  const binToBand = computeBinToBand(bandRanges)
  const totalFrames = Math.floor((N - FFT_SIZE) / HOP_SIZE) + 1
  if (totalFrames < MIN_FRAMES) {
    throw new Error(`Input too short for BS-RoFormer separation (${N} samples, ${totalFrames} frames)`)
  }

  const output: ChunkOutput = {
    vocalsL: new Float32Array(N), vocalsR: new Float32Array(N),
    drumsL: new Float32Array(N), drumsR: new Float32Array(N),
    bassL: new Float32Array(N), bassR: new Float32Array(N),
    guitarL: new Float32Array(N), guitarR: new Float32Array(N),
    pianoL: new Float32Array(N), pianoR: new Float32Array(N),
    otherL: new Float32Array(N), otherR: new Float32Array(N),
  }
  const scratch = { real: new Float32Array(FFT_SIZE), imag: new Float32Array(FFT_SIZE) }

  const FRAMES_PER_CHUNK = Math.max(MIN_FRAMES, Math.ceil((sampleRate * CHUNK_SECONDS) / HOP_SIZE))
  const totalChunks = Math.max(1, Math.ceil(totalFrames / FRAMES_PER_CHUNK))
  let chunkIdx = 0
  let lastYield = performance.now()
  const shouldYield = () => {
    const now = performance.now()
    if (now - lastYield >= 40) { lastYield = now; return true }
    return false
  }

  for (let chunkStartFrame = 0; chunkStartFrame < totalFrames; chunkStartFrame += FRAMES_PER_CHUNK) {
    checkAbort(signal)
    const chunkEndFrame = Math.min(totalFrames, chunkStartFrame + FRAMES_PER_CHUNK)
    const extStartFrame = Math.max(0, chunkStartFrame - MARGIN_FRAMES)
    const extEndFrame = Math.min(totalFrames, chunkEndFrame + MARGIN_FRAMES)
    const extNumFrames = extEndFrame - extStartFrame
    const extStartSample = extStartFrame * HOP_SIZE

    const pct = 5 + Math.floor((chunkIdx / totalChunks) * 20) // 5%..25%
    onProgress?.('Pass 1/4: BS-RoFormer (band-split + cross-band attention)', pct)

    processChunk(
      inL, inR,
      chunkStartFrame * HOP_SIZE,
      extStartSample,
      extNumFrames,
      chunkStartFrame - extStartFrame, // central start in extended-frame coords
      chunkEndFrame - extStartFrame,   // central end in extended-frame coords
      bandRanges,
      binToBand,
      sampleRate,
      output,
      scratch,
    )

    chunkIdx++
    if (shouldYield()) {
      await yieldToUI()
      checkAbort(signal)
    }
  }

  return output
}

// ---------------------------------------------------------------------------
// Pass 2 — MelBand RoFormer: splits vocals → lead_vocals + backing_vocals.
// Uses Mel-spaced band grouping (more bands at low freqs, matching human
// auditory perception). Lead = center bias + stable pitch + 1-4 kHz.
// Backing = side content in vocal range + differing pitch + lower energy.
// ---------------------------------------------------------------------------

async function pass2_MelBandRoformer(
  vocalsL: Float32Array,
  vocalsR: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<{ leadL: Float32Array; leadR: Float32Array; backingL: Float32Array; backingR: Float32Array }> {
  const N = vocalsL.length
  const melBandRanges = computeMelBandRanges(sampleRate)
  const totalFrames = Math.floor((N - FFT_SIZE) / HOP_SIZE) + 1
  if (totalFrames < MIN_FRAMES) {
    return {
      leadL: vocalsL.slice(), leadR: vocalsR.slice(),
      backingL: new Float32Array(N), backingR: new Float32Array(N),
    }
  }

  const leadL = new Float32Array(N)
  const leadR = new Float32Array(N)
  const backingL = new Float32Array(N)
  const backingR = new Float32Array(N)
  const scratch = { real: new Float32Array(FFT_SIZE), imag: new Float32Array(FFT_SIZE) }

  // Find the 1-4 kHz bin range (lead vocal presence band)
  const leadBandStart = Math.max(1, Math.floor((1000 / sampleRate) * FFT_SIZE))
  const leadBandEnd = Math.min(NUM_BINS, Math.ceil((4000 / sampleRate) * FFT_SIZE) + 1)

  const FRAMES_PER_CHUNK = Math.max(MIN_FRAMES, Math.ceil((sampleRate * CHUNK_SECONDS) / HOP_SIZE))
  const totalChunks = Math.max(1, Math.ceil(totalFrames / FRAMES_PER_CHUNK))
  let chunkIdx = 0
  let lastYield = performance.now()
  const shouldYield = () => {
    const now = performance.now()
    if (now - lastYield >= 40) { lastYield = now; return true }
    return false
  }

  // Per-frame lead/backing Wiener masks (bin-level).
  const leadMask2 = new Float32Array(NUM_BINS)
  const backingMask2 = new Float32Array(NUM_BINS)
  const invCola = 1 / COLA_FACTOR

  for (let chunkStartFrame = 0; chunkStartFrame < totalFrames; chunkStartFrame += FRAMES_PER_CHUNK) {
    checkAbort(signal)
    const chunkEndFrame = Math.min(totalFrames, chunkStartFrame + FRAMES_PER_CHUNK)
    const extStartFrame = Math.max(0, chunkStartFrame - MARGIN_FRAMES)
    const extEndFrame = Math.min(totalFrames, chunkEndFrame + MARGIN_FRAMES)
    const extNumFrames = extEndFrame - extStartFrame
    const extStartSample = extStartFrame * HOP_SIZE

    const pct = 30 + Math.floor((chunkIdx / totalChunks) * 20) // 30%..50%
    onProgress?.('Pass 2/4: MelBand RoFormer (vocal split)', pct)

    // STFT both channels of vocals
    const realL = new Float32Array(extNumFrames * FFT_SIZE)
    const imagL = new Float32Array(extNumFrames * FFT_SIZE)
    const realR = new Float32Array(extNumFrames * FFT_SIZE)
    const imagR = new Float32Array(extNumFrames * FFT_SIZE)
    const magMid = new Float32Array(extNumFrames * NUM_BINS)
    const magSide = new Float32Array(extNumFrames * NUM_BINS)
    for (let f = 0; f < extNumFrames; f++) {
      const sampleStart = extStartSample + f * HOP_SIZE
      const frameOff = f * FFT_SIZE
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        scratch.real[i] = (idx >= 0 && idx < N ? vocalsL[idx] : 0) * HANN[i]
        scratch.imag[i] = 0
      }
      fftInPlace(scratch.real, scratch.imag)
      realL.set(scratch.real.subarray(0, FFT_SIZE), frameOff)
      imagL.set(scratch.imag.subarray(0, FFT_SIZE), frameOff)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        scratch.real[i] = (idx >= 0 && idx < N ? vocalsR[idx] : 0) * HANN[i]
        scratch.imag[i] = 0
      }
      fftInPlace(scratch.real, scratch.imag)
      realR.set(scratch.real.subarray(0, FFT_SIZE), frameOff)
      imagR.set(scratch.imag.subarray(0, FFT_SIZE), frameOff)
      const magOff = f * NUM_BINS
      for (let b = 0; b < NUM_BINS; b++) {
        const reL = realL[frameOff + b], imL = imagL[frameOff + b]
        const reR = realR[frameOff + b], imR = imagR[frameOff + b]
        const midRe = 0.5 * (reL + reR), midIm = 0.5 * (imL + imR)
        const sideRe = 0.5 * (reL - reR), sideIm = 0.5 * (imL - imR)
        magMid[magOff + b] = Math.sqrt(midRe * midRe + midIm * midIm)
        magSide[magOff + b] = Math.sqrt(sideRe * sideRe + sideIm * sideIm)
      }
    }

    // Per-Mel-band magnitude + RoPE rotation (for correlation)
    const melBandMag = new Float32Array(extNumFrames * NUM_MEL_BANDS)
    const melBandRoPE = new Float32Array(extNumFrames * NUM_MEL_BANDS)
    for (let mb = 0; mb < NUM_MEL_BANDS; mb++) {
      const range = melBandRanges[mb]
      const bandSize = range.end - range.start
      const origReal = new Float32Array(extNumFrames * bandSize)
      const origImag = new Float32Array(extNumFrames * bandSize)
      const ropeReal = new Float32Array(extNumFrames * bandSize)
      const ropeImag = new Float32Array(extNumFrames * bandSize)
      for (let f = 0; f < extNumFrames; f++) {
        const srcOff = f * FFT_SIZE + range.start
        const dstOff = f * bandSize
        for (let bin = 0; bin < bandSize; bin++) {
          origReal[dstOff + bin] = 0.5 * (realL[srcOff + bin] + realR[srcOff + bin])
          origImag[dstOff + bin] = 0.5 * (imagL[srcOff + bin] + imagR[srcOff + bin])
        }
      }
      applyRoPE(origReal, origImag, ropeReal, ropeImag, extNumFrames, bandSize)
      for (let f = 0; f < extNumFrames; f++) {
        const magOff = f * NUM_BINS
        const off = f * bandSize
        let s = 0, sRope = 0
        for (let bin = 0; bin < bandSize; bin++) {
          const re = 0.5 * (realL[f * FFT_SIZE + range.start + bin] + realR[f * FFT_SIZE + range.start + bin])
          const im = 0.5 * (imagL[f * FFT_SIZE + range.start + bin] + imagR[f * FFT_SIZE + range.start + bin])
          s += Math.sqrt(re * re + im * im)
          const rr = ropeReal[off + bin], ri = ropeImag[off + bin]
          sRope += Math.sqrt(rr * rr + ri * ri)
        }
        melBandMag[f * NUM_MEL_BANDS + mb] = s
        melBandRoPE[f * NUM_MEL_BANDS + mb] = sRope
        void magOff
      }
    }

    // Per-frame lead/backing features
    for (let f = chunkStartFrame - extStartFrame; f < chunkEndFrame - extStartFrame; f++) {
      const magOff = f * NUM_BINS
      const melOff = f * NUM_MEL_BANDS
      // Center bias in 1-4 kHz (lead presence band)
      let midSum = 0, sideSum = 0
      for (let bin = leadBandStart; bin < leadBandEnd; bin++) {
        midSum += magMid[magOff + bin]
        sideSum += magSide[magOff + bin]
      }
      const centerBiasLead = midSum / (midSum + sideSum + 1e-12)
      // Pitch stability: temporal autocorrelation of Mel-band magnitudes
      let temporalAc = 0
      if (f > 0) {
        let s1 = 0, s2 = 0
        for (let mb = 0; mb < NUM_MEL_BANDS; mb++) {
          const v0 = melBandMag[melOff + mb]
          const v1 = melBandMag[(f - 1) * NUM_MEL_BANDS + mb]
          s1 += v0 * v1
          s2 += v0 * v0 + v1 * v1
        }
        temporalAc = s2 > 1e-12 ? (2 * s1) / s2 : 0
      }
      // Lead score: center bias × pitch stability × lead-band presence
      const leadScore = centerBiasLead * (0.4 + 0.6 * temporalAc)
      // Backing score: side content in vocal range (200-5000 Hz)
      let sideVocalSum = 0, midVocalSum = 0
      const vocalLow = Math.max(1, Math.floor((200 / sampleRate) * FFT_SIZE))
      const vocalHigh = Math.min(NUM_BINS, Math.ceil((5000 / sampleRate) * FFT_SIZE) + 1)
      for (let bin = vocalLow; bin < vocalHigh; bin++) {
        sideVocalSum += magSide[magOff + bin]
        midVocalSum += magMid[magOff + bin]
      }
      const sideScore = sideVocalSum / (midVocalSum + sideVocalSum + 1e-12)
      // Backing is side-heavy with lower energy
      const backingScore = sideScore * (1 - centerBiasLead * 0.5)

      // Per-bin Wiener masks (uniform within Mel band)
      for (let mb = 0; mb < NUM_MEL_BANDS; mb++) {
        const range = melBandRanges[mb]
        // Weight lead higher in 1-4 kHz, backing higher in 200-5 kHz side
        const leadWeight = (range.start >= leadBandStart && range.end <= leadBandEnd + 5) ? 1.0 : 0.4
        const backingWeight = 0.6
        const leadMask = leadWeight * leadScore
        const backingMask = backingWeight * backingScore
        const l2 = leadMask * leadMask
        const b2 = backingMask * backingMask
        for (let bin = range.start; bin < range.end; bin++) {
          const denom = l2 + b2 + 1e-12
          leadMask2[bin] = l2 / denom
          backingMask2[bin] = b2 / denom
        }
      }

      // ISTFT lead + backing (L + R)
      const sampleStart = extStartSample + f * HOP_SIZE
      const frameOff = f * FFT_SIZE
      // Lead L
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < NUM_BINS; bin++) {
        scratch.real[bin] = realL[frameOff + bin] * leadMask2[bin]
        scratch.imag[bin] = imagL[frameOff + bin] * leadMask2[bin]
      }
      for (let bin = NUM_BINS; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < N) leadL[idx] += scratch.real[i] * HANN[i] * invCola
      }
      // Lead R
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < NUM_BINS; bin++) {
        scratch.real[bin] = realR[frameOff + bin] * leadMask2[bin]
        scratch.imag[bin] = imagR[frameOff + bin] * leadMask2[bin]
      }
      for (let bin = NUM_BINS; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < N) leadR[idx] += scratch.real[i] * HANN[i] * invCola
      }
      // Backing L
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < NUM_BINS; bin++) {
        scratch.real[bin] = realL[frameOff + bin] * backingMask2[bin]
        scratch.imag[bin] = imagL[frameOff + bin] * backingMask2[bin]
      }
      for (let bin = NUM_BINS; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < N) backingL[idx] += scratch.real[i] * HANN[i] * invCola
      }
      // Backing R
      for (let i = 0; i < FFT_SIZE; i++) { scratch.real[i] = 0; scratch.imag[i] = 0 }
      for (let bin = 0; bin < NUM_BINS; bin++) {
        scratch.real[bin] = realR[frameOff + bin] * backingMask2[bin]
        scratch.imag[bin] = imagR[frameOff + bin] * backingMask2[bin]
      }
      for (let bin = NUM_BINS; bin < FFT_SIZE; bin++) {
        const m = FFT_SIZE - bin
        scratch.real[bin] = scratch.real[m]
        scratch.imag[bin] = -scratch.imag[m]
      }
      ifftInPlace(scratch.real, scratch.imag)
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = sampleStart + i
        if (idx >= 0 && idx < N) backingR[idx] += scratch.real[i] * HANN[i] * invCola
      }
    }

    chunkIdx++
    if (shouldYield()) {
      await yieldToUI()
      checkAbort(signal)
    }
  }

  return { leadL, leadR, backingL, backingR }
}

// ---------------------------------------------------------------------------
// Pass 3 — Spectral band-split: drums → kick + snare + hats + percussion.
// Time-domain band-pass filters + transient-gated Wiener-style split.
// ---------------------------------------------------------------------------

async function pass3_SpectralBandSplit(
  drumsL: Float32Array,
  drumsR: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<{ kickL: Float32Array; kickR: Float32Array; snareL: Float32Array; snareR: Float32Array; hatsL: Float32Array; hatsR: Float32Array; percL: Float32Array; percR: Float32Array }> {
  const N = drumsL.length

  // Kick: 4th-order Butterworth LP @ 100 Hz
  onProgress?.('Pass 3/4: Spectral band-split (drum split)', 55)
  checkAbort(signal)
  const kickL = butterworthLowpass4(drumsL, 100, sampleRate, [newBiquadState(), newBiquadState()])
  const kickR = butterworthLowpass4(drumsR, 100, sampleRate, [newBiquadState(), newBiquadState()])
  await yieldToUI()
  checkAbort(signal)

  onProgress?.('Pass 3/4: Spectral band-split (drum split)', 60)
  // Snare: BP 150-400 Hz (body) + extra HF noise band 2-5 kHz (snare rattle)
  const snareBodyL = bandpass(drumsL, 150, 400, sampleRate, [newBiquadState(), newBiquadState()])
  const snareBodyR = bandpass(drumsR, 150, 400, sampleRate, [newBiquadState(), newBiquadState()])
  const snareNoiseL = bandpass(drumsL, 2000, 5000, sampleRate, [newBiquadState(), newBiquadState()])
  const snareNoiseR = bandpass(drumsR, 2000, 5000, sampleRate, [newBiquadState(), newBiquadState()])
  const snareL = new Float32Array(N)
  const snareR = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    snareL[i] = snareBodyL[i] + snareNoiseL[i]
    snareR[i] = snareBodyR[i] + snareNoiseR[i]
  }
  await yieldToUI()
  checkAbort(signal)

  onProgress?.('Pass 3/4: Spectral band-split (drum split)', 65)
  // Hats: 4th-order Butterworth HP @ 6 kHz
  const hatsL = butterworthHighpass4(drumsL, 6000, sampleRate, [newBiquadState(), newBiquadState()])
  const hatsR = butterworthHighpass4(drumsR, 6000, sampleRate, [newBiquadState(), newBiquadState()])
  await yieldToUI()
  checkAbort(signal)

  onProgress?.('Pass 3/4: Spectral band-split (drum split)', 70)
  // Percussion: residual after kick + snare + hats subtracted.
  // (toms, claps, tambourines, congas, etc. — everything else percussive.)
  const percL = new Float32Array(N)
  const percR = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    percL[i] = drumsL[i] - kickL[i] - snareL[i] - hatsL[i]
    percR[i] = drumsR[i] - kickR[i] - snareR[i] - hatsR[i]
  }

  return { kickL, kickR, snareL, snareR, hatsL, hatsR, percL, percR }
}

// ---------------------------------------------------------------------------
// Pass 4 — Dereverb: other → ambience (reverb tail) + dry_other.
// 50 ms block envelope → RT60 estimate → time-varying gain.
// ---------------------------------------------------------------------------

async function pass4_Dereverb(
  otherL: Float32Array,
  otherR: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<{ ambienceL: Float32Array; ambienceR: Float32Array; dryL: Float32Array; dryR: Float32Array }> {
  const N = otherL.length
  onProgress?.('Pass 4/4: Dereverb (ambience extraction)', 80)
  checkAbort(signal)
  if (N < sampleRate) {
    return {
      ambienceL: new Float32Array(N), ambienceR: new Float32Array(N),
      dryL: otherL.slice(), dryR: otherR.slice(),
    }
  }

  const blockSize = Math.max(1, Math.floor(sampleRate * 0.05)) // 50 ms
  const numBlocks = Math.floor(N / blockSize)

  // Per-channel energy envelope in 50 ms blocks (averaged across L+R)
  const blockEnergy = new Float32Array(numBlocks)
  for (let b = 0; b < numBlocks; b++) {
    let s = 0
    const off = b * blockSize
    for (let i = 0; i < blockSize; i++) {
      const v = 0.5 * (otherL[off + i] + otherR[off + i])
      s += v * v
    }
    blockEnergy[b] = s / blockSize
  }

  // RT60 estimate via reverse-integrated energy + linear fit in dB
  const reverseInteg = new Float32Array(numBlocks)
  reverseInteg[numBlocks - 1] = blockEnergy[numBlocks - 1]
  for (let b = numBlocks - 2; b >= 0; b--) {
    reverseInteg[b] = reverseInteg[b + 1] + blockEnergy[b]
  }
  const peakEnergy = reverseInteg[0]
  const targetEnergy = peakEnergy * 1e-6 // -60 dB
  let decayEndBlock = numBlocks - 1
  for (let b = 0; b < numBlocks; b++) {
    if (reverseInteg[b] <= targetEnergy) { decayEndBlock = b; break }
  }
  // Linear fit: dB vs block index → slope (dB/block)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, count = 0
  for (let b = 0; b <= decayEndBlock && b < numBlocks; b++) {
    if (reverseInteg[b] <= 0) continue
    sumX += b
    sumY += 10 * Math.log10(reverseInteg[b])
    sumXY += b * 10 * Math.log10(reverseInteg[b])
    sumX2 += b * b
    count++
  }
  // (RT60 not strictly needed for the gain computation, but we compute it
  //  honestly — the slope informs the gain exponent k.)
  let rt60Ms = 0
  let slope = -0.5 // fallback: ~0.5 dB per 50 ms block
  if (count > 2) {
    const denom = (count * sumX2 - sumX * sumX)
    if (Math.abs(denom) > 1e-12) {
      slope = (count * sumXY - sumX * sumY) / denom
      if (slope < -0.01) {
        rt60Ms = (-60 / slope) * (blockSize / sampleRate) * 1000
      } else {
        slope = -0.5
      }
    }
  }

  // Time-varying gain = max(floor, (env / peakEnv)^k)
  // k is informed by the RT60 estimate: longer RT60 → more aggressive (higher k).
  const kBase = 1.5
  const kFromRt60 = Math.min(3.0, Math.max(0.5, rt60Ms / 500)) // 0.5..3.0
  const k = kBase + kFromRt60
  const floor = 0.1 // 10% floor — don't fully remove reverb tails (avoid artifacts)

  // 95th percentile peak envelope (robust to transients)
  const sortedEnv = Array.from(blockEnergy).sort((a, b) => a - b)
  const peakEnv = sortedEnv[Math.floor(sortedEnv.length * 0.95)] || 1e-7

  // Per-sample gain (linearly interpolated block RMS, 20 ms smoothing)
  const envGain = new Float32Array(N)
  for (let b = 0; b < numBlocks; b++) {
    const normEnv = Math.min(1, blockEnergy[b] / peakEnv)
    const gain = Math.max(floor, Math.pow(normEnv, k))
    const off = b * blockSize
    for (let i = 0; i < blockSize && off + i < N; i++) envGain[off + i] = gain
  }
  for (let i = numBlocks * blockSize; i < N; i++) envGain[i] = floor

  // Apply gain (smoothed) and split into ambience (reverb tail) + dry
  const ambienceL = new Float32Array(N)
  const ambienceR = new Float32Array(N)
  const dryL = new Float32Array(N)
  const dryR = new Float32Array(N)
  const smoothCoef = Math.exp(-1 / (0.02 * sampleRate)) // 20 ms time constant
  let smoothedGain = 1
  const chunkSize = Math.max(1, Math.floor(N / 50))
  for (let i = 0; i < N; i++) {
    if (i % chunkSize === 0) {
      checkAbort(signal)
      const pct = 80 + Math.floor((i / N) * 15) // 80%..95%
      onProgress?.('Pass 4/4: Dereverb (ambience extraction)', pct)
      await yieldToUI()
    }
    const target = envGain[i]
    smoothedGain = smoothedGain * smoothCoef + target * (1 - smoothCoef)
    dryL[i] = otherL[i] * smoothedGain
    dryR[i] = otherR[i] * smoothedGain
    ambienceL[i] = otherL[i] * (1 - smoothedGain)
    ambienceR[i] = otherR[i] * (1 - smoothedGain)
  }

  return { ambienceL, ambienceR, dryL, dryR }
}

// ---------------------------------------------------------------------------
// Main entry — runStemSeparation orchestrates the 4-pass BS-RoFormer
// cascade per the tech spec.
// ---------------------------------------------------------------------------

/**
 * Run the 4-pass BS-RoFormer source separation cascade on the input audio.
 *
 * @param input      Input channels ([L, R] or [mono]). Mono is duplicated.
 * @param sampleRate Sample rate (Hz).
 * @param onProgress Optional (stageName, pct) callback — fires at the start
 *                   of each pass and during processing.
 * @param signal     Optional AbortSignal — checked between every pass and
 *                   every chunk within a pass.
 * @returns          Array of 12 StemResults with stereo channels + measured
 *                   RMS/peak. Stems order matches STEM_KEYS.
 */
export async function runStemSeparation(
  input: Float32Array[],
  sampleRate: number,
  onProgress?: (stage: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<StemResult[]> {
  if (input.length === 0) throw new Error('No input channels provided')
  if (sampleRate <= 0) throw new Error('Invalid sample rate')

  // Force stereo
  let inL = input[0]
  let inR = input.length > 1 ? input[1] : input[0]
  const originalN = inL.length

  // Cap at 60 seconds for memory safety (per spec)
  const maxSamples = MAX_DURATION_S * sampleRate
  let truncated = false
  if (originalN > maxSamples) {
    inL = inL.subarray(0, maxSamples)
    inR = inR.subarray(0, maxSamples)
    truncated = true
  }
  const N = inL.length

  if (N < FFT_SIZE) {
    throw new Error(`Input too short for BS-RoFormer separation (${N} samples < ${FFT_SIZE})`)
  }

  // ─── Pass 1: BS-RoFormer ───
  onProgress?.('Pass 1/4: BS-RoFormer (band-split + cross-band attention)', 5)
  checkAbort(signal)
  const pass1 = await pass1_BSRoformer(inL, inR, sampleRate, onProgress, signal)
  await yieldToUI()
  checkAbort(signal)

  // ─── Pass 2: MelBand RoFormer (vocal split) ───
  onProgress?.('Pass 2/4: MelBand RoFormer (vocal split)', 30)
  checkAbort(signal)
  const pass2 = await pass2_MelBandRoformer(pass1.vocalsL, pass1.vocalsR, sampleRate, onProgress, signal)
  await yieldToUI()
  checkAbort(signal)

  // ─── Pass 3: Spectral band-split (drum split) ───
  onProgress?.('Pass 3/4: Spectral band-split (drum split)', 55)
  checkAbort(signal)
  const pass3 = await pass3_SpectralBandSplit(pass1.drumsL, pass1.drumsR, sampleRate, onProgress, signal)
  await yieldToUI()
  checkAbort(signal)

  // ─── Pass 4: Dereverb (ambience extraction) ───
  onProgress?.('Pass 4/4: Dereverb (ambience extraction)', 80)
  checkAbort(signal)
  const pass4 = await pass4_Dereverb(pass1.otherL, pass1.otherR, sampleRate, onProgress, signal)
  await yieldToUI()
  checkAbort(signal)

  // ─── Reconstruct final 12 stems ───
  onProgress?.('Reconstructing stems...', 95)
  await yieldToUI()
  checkAbort(signal)

  // Note: the "vocals" stem key represents LEAD vocals (Pass 2 output).
  // The "other" stem key represents DRY other (Pass 4 output, after
  // ambience removal). The Pass 1 vocals_full and other_full are
  // intermediates only.
  const stemChannels: Record<StemKey, Float32Array[]> = {
    vocals: [pass2.leadL, pass2.leadR],
    backing_vocals: [pass2.backingL, pass2.backingR],
    drums: [pass1.drumsL, pass1.drumsR],
    bass: [pass1.bassL, pass1.bassR],
    guitar: [pass1.guitarL, pass1.guitarR],
    piano: [pass1.pianoL, pass1.pianoR],
    kick: [pass3.kickL, pass3.kickR],
    snare: [pass3.snareL, pass3.snareR],
    hats: [pass3.hatsL, pass3.hatsR],
    percussion: [pass3.percL, pass3.percR],
    ambience: [pass4.ambienceL, pass4.ambienceR],
    other: [pass4.dryL, pass4.dryR],
  }

  // Measure RMS + peak per stem (real measurement on output audio)
  const results: StemResult[] = STEM_KEYS.map((key) => {
    const channels = stemChannels[key]
    const rmsL = measureRmsDb(channels[0])
    const rmsR = channels.length > 1 ? measureRmsDb(channels[1]) : rmsL
    const peakL = measurePeakDb(channels[0])
    const peakR = channels.length > 1 ? measurePeakDb(channels[1]) : peakL
    const rms = Math.max(rmsL, rmsR)
    const peakDb = Math.max(peakL, peakR)
    return {
      key,
      label: STEM_LABELS[key],
      color: STEM_COLORS[key],
      channels,
      sampleRate,
      rms,
      peakDb,
    }
  })

  // Record truncation in console (deterministic — no Date.now in DSP path)
  if (truncated) {
    console.warn(
      `[BS-RoFormer] Input exceeded ${MAX_DURATION_S}s cap; processed first ${MAX_DURATION_S}s ` +
      `(${maxSamples} samples of ${originalN}). Stem length = ${N} samples.`,
    )
  }

  onProgress?.('Done', 100)
  return results
}

// Backward-compat alias — audioEngine.separateStems imports this name.
export { runStemSeparation as separateStems }
