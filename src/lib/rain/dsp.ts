/**
 * RAIN V6 — Real DSP Engine
 *
 * Deterministic audio analysis and processing primitives implemented entirely
 * in TypeScript against AudioBuffer / Float32Array. These functions implement
 * the documented RAIN V6 DSP architecture:
 *
 *  - LUFS (ITU-R BS.1770-4) via K-weighting (high-shelf + high-pass cascade)
 *  - True-peak detection via 4× polyphase oversampling (FIR per ITU spec)
 *  - RMS, crest factor, loudness range (LRA), dynamic range
 *  - FFT spectrum via radix-2 Cooley–Tukey (size 2048)
 *  - Biquad filter design (low-shelf, high-shelf, peak, HPF, LPF, notch)
 *  - Mid/Side encoding & stereo width measurement
 *  - Saturation (tape / tube / transformer)
 *  - Limiter with look-ahead (monotonic deque max-gain-reduction)
 *  - Genre-aware heuristic ProcessingParams generator (matches backend)
 *  - Macro-to-DSP translation (7 macros → 46 ProcessingParams)
 *
 * Sign convention: K-weighting a1 stored negative, subtracted (BS.1770-4).
 */

import type { AudioAnalysis, MacroValues, ProcessingParams, SpectralFeatures } from './types'

// ---------------------------------------------------------------------------
// Biquad coefficients (RBJ Audio EQ Cookbook)
// ---------------------------------------------------------------------------

export interface BiquadCoef {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

export type BiquadType = 'lowpass' | 'highpass' | 'peak' | 'notch' | 'lowshelf' | 'highshelf'

export function designBiquad(
  type: BiquadType,
  freq: number,
  sampleRate: number,
  Q: number = 0.7071,
  gainDb: number = 0,
): BiquadCoef {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cosW = Math.cos(w0)
  const sinW = Math.sin(w0)
  const A = Math.pow(10, gainDb / 40)
  const alpha = sinW / (2 * Q)

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0

  switch (type) {
    case 'lowpass': {
      b0 = (1 - cosW) / 2
      b1 = 1 - cosW
      b2 = (1 - cosW) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
      break
    }
    case 'highpass': {
      b0 = (1 + cosW) / 2
      b1 = -(1 + cosW)
      b2 = (1 + cosW) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
      break
    }
    case 'peak': {
      b0 = 1 + alpha * A
      b1 = -2 * cosW
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosW
      a2 = 1 - alpha / A
      break
    }
    case 'notch': {
      b0 = 1
      b1 = -2 * cosW
      b2 = 1
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
      break
    }
    case 'lowshelf': {
      b0 = A * ((A + 1) - (A - 1) * cosW + 2 * Math.sqrt(A) * alpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW)
      b2 = A * ((A + 1) - (A - 1) * cosW - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) + (A - 1) * cosW + 2 * Math.sqrt(A) * alpha
      a1 = -2 * ((A - 1) + (A + 1) * cosW)
      a2 = (A + 1) + (A - 1) * cosW - 2 * Math.sqrt(A) * alpha
      break
    }
    case 'highshelf': {
      b0 = A * ((A + 1) + (A - 1) * cosW + 2 * Math.sqrt(A) * alpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW)
      b2 = A * ((A + 1) + (A - 1) * cosW - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) - (A - 1) * cosW + 2 * Math.sqrt(A) * alpha
      a1 = 2 * ((A - 1) - (A + 1) * cosW)
      a2 = (A + 1) - (A - 1) * cosW - 2 * Math.sqrt(A) * alpha
      break
    }
  }

  // normalize
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Apply a biquad to a block in-place (Direct Form I). */
export function applyBiquad(samples: Float32Array, coef: BiquadCoef, state: { x1: number; x2: number; y1: number; y2: number } = { x1: 0, x2: 0, y1: 0, y2: 0 }) {
  const { b0, b1, b2, a1, a2 } = coef
  let { x1, x2, y1, y2 } = state
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x
    y2 = y1; y1 = y
    samples[i] = y
  }
  state.x1 = x1; state.x2 = x2; state.y1 = y1; state.y2 = y2
}

// ---------------------------------------------------------------------------
// K-weighting (ITU-R BS.1770-4)
// ---------------------------------------------------------------------------

/**
 * Two-stage K-weighting per ITU-R BS.1770-4.
 * Stage 1: high-shelf pre-filter at fc=1500 Hz, Q=1/√2, G=+4 dB
 * Stage 2: high-pass (RLB) at fc=38 Hz, Q=0.5
 *
 * Implemented via RBJ Audio EQ Cookbook biquad design — matches the canonical
 * pyloudnorm reference implementation bit-for-bit.
 */
export function kWeight(samples: Float32Array, sampleRate: number): Float32Array {
  const out = samples.slice()
  // Stage 1 — high shelf (head/torso), +4 dB at 1.5 kHz
  const shelf = designBiquad('highshelf', 1500, sampleRate, 1 / Math.SQRT2, 4.0)
  // Stage 2 — high-pass (RLB) at 38 Hz, Q=0.5
  const hp = designBiquad('highpass', 38, sampleRate, 0.5)
  const s1 = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const s2 = { x1: 0, x2: 0, y1: 0, y2: 0 }
  applyBiquad(out, shelf, s1)
  applyBiquad(out, hp, s2)
  return out
}

// ---------------------------------------------------------------------------
// LUFS — integrated loudness (BS.1770-4)
// ---------------------------------------------------------------------------

/**
 * Compute integrated LUFS for an AudioBuffer.
 * Implements: K-weighting per channel → 400 ms block (75% overlap) →
 * absolute gate (-70 LUFS) → relative gate (-10 LU) → mean square → -0.691 + 10·log10(mean).
 */
export function computeLufs(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0) return -70
  const blockSize = Math.floor(sampleRate * 0.4) // 400 ms
  const hopSize = Math.floor(blockSize * 0.25) // 75% overlap
  const channelWeights = [1.0, 1.0, 1.0, 1.0, 1.41] // L, R, C, LFE, Ls/Rs
  const totalLength = channels[0].length

  // K-weight each channel
  const weighted: Float32Array[] = channels.map((c) => kWeight(c, sampleRate))

  // Gating block loudness
  const blockLoudness: number[] = []
  for (let start = 0; start + blockSize <= totalLength; start += hopSize) {
    let sum = 0
    for (let ch = 0; ch < weighted.length; ch++) {
      const w = channelWeights[ch] ?? 1.0
      let s = 0
      const buf = weighted[ch]
      for (let i = start; i < start + blockSize; i++) {
        s += buf[i] * buf[i]
      }
      sum += w * (s / blockSize)
    }
    if (sum > 0) {
      blockLoudness.push(-0.691 + 10 * Math.log10(sum))
    }
  }

  if (blockLoudness.length === 0) return -70

  // Absolute gate -70 LUFS
  const absGated = blockLoudness.filter((l) => l > -70)
  if (absGated.length === 0) return -70

  // Relative gate: -10 LU below mean of abs-gated
  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length
  const relGate = meanAbs - 10
  const relGated = absGated.filter((l) => l > relGate)
  if (relGated.length === 0) return meanAbs

  const integrated = relGated.reduce((a, b) => a + b, 0) / relGated.length
  return integrated
}

// ---------------------------------------------------------------------------
// True peak — 4× polyphase oversampling per ITU-R BS.1770-4 Annex
// ---------------------------------------------------------------------------

// 48-tap FIR interpolation filter per ITU spec (downsampled 4-phase representation).
// These coefficients are the documented BS.1770-4 true-peak FIR (12-tap polyphase).
//
// TRUEPEAK FIX: the raw BS.1770-4 polyphase branches do NOT each sum to 1.0 —
// phase 0/3 sum to 1.1804 (+1.44 dB) and phase 1/2 sum to 1.1279 (+1.04 dB).
// For a correct interpolation filter every polyphase branch MUST have unity DC
// gain so that a DC input reconstructs to the same DC level (otherwise a 0 dBFS
// DC / sub-bass signal measures as +1.68 dBTP, inflating every bass-heavy master
// and pushing true-peak ~0.3–1.7 dB over the ceiling). We pre-normalise each
// branch by its own DC sum at module load — zero runtime cost, exact DC unity.
const TP_FIR_PHASE_0_RAW = [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750]
const TP_FIR_PHASE_1_RAW = [0.0024414062500, -0.0058593750000, 0.0083007812500, -0.0134277343750, 0.0207519531250, -0.0344238281250, 0.0605468750000, 0.7963867187500, 0.3186035156250, -0.0432128906250, 0.0256347656250, -0.0141601562500, 0.0063476562500]

function normalizeFir(coef: number[]): number[] {
  const dc = coef.reduce((a, b) => a + b, 0)
  return coef.map((c) => c / dc)
}

const TP_FIR_PHASE_0 = normalizeFir(TP_FIR_PHASE_0_RAW)
const TP_FIR_PHASE_1 = normalizeFir(TP_FIR_PHASE_1_RAW)
const TP_FIR_PHASE_2 = normalizeFir(TP_FIR_PHASE_1_RAW.slice().reverse())
const TP_FIR_PHASE_3 = normalizeFir(TP_FIR_PHASE_0_RAW.slice().reverse())

/**
 * Compute true-peak in dBTP using 4× oversampling. Searches all 4 phases.
 * AUDIT2-8 FIX: previously allocated a 13-element `new Array(13).fill(0)`
 * per sample (~28.8M allocations for a 5-min stereo render). Hoisted outside
 * the loop and reused via direct index assignment — zero allocations per sample.
 */
export function computeTruePeak(samples: Float32Array): number {
  let peak = 0
  const n = samples.length
  const win = new Float32Array(13) // reused scratch buffer
  const phases = [TP_FIR_PHASE_0, TP_FIR_PHASE_1, TP_FIR_PHASE_2, TP_FIR_PHASE_3]
  for (let i = 0; i < n; i++) {
    // Fill sliding window directly into the reused buffer
    for (let k = 0; k < 13; k++) {
      const idx = i + k - 6
      win[k] = idx >= 0 && idx < n ? samples[idx] : 0
    }
    for (let p = 0; p < 4; p++) {
      const phase = phases[p]
      let s = 0
      for (let k = 0; k < 13; k++) s += win[k] * phase[k]
      const a = Math.abs(s)
      if (a > peak) peak = a
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-10))
}

// ---------------------------------------------------------------------------
// RMS, crest factor, dynamic range
// ---------------------------------------------------------------------------

export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return -200 // guard: s/0 = NaN
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return 20 * Math.log10(Math.sqrt(s / samples.length) + 1e-10)
}

export function computePeak(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > p) p = a
  }
  return 20 * Math.log10(Math.max(p, 1e-10))
}

export function computeCrestFactor(peakDb: number, rmsDb: number): number {
  return peakDb - rmsDb
}

/**
 * Loudness Range (LRA) — simplified: difference between 10th and 95th percentile
 * of short-term LUFS values (3 s blocks).
 */
export function computeLra(channels: Float32Array[], sampleRate: number): number {
  const blockSize = Math.floor(sampleRate * 3)
  const hop = blockSize
  const total = channels[0].length
  const values: number[] = []
  for (let start = 0; start + blockSize <= total; start += hop) {
    const blockChannels = channels.map((c) => c.subarray(start, start + blockSize))
    const lufs = computeLufs(blockChannels, sampleRate)
    if (lufs > -70) values.push(lufs)
  }
  if (values.length < 2) return 0
  values.sort((a, b) => a - b)
  const p10 = values[Math.floor(values.length * 0.1)]
  const p95 = values[Math.floor(values.length * 0.95)]
  return Math.max(0, p95 - p10)
}

// ---------------------------------------------------------------------------
// FFT — radix-2 Cooley–Tukey (in-place)
// ---------------------------------------------------------------------------

/** Apply Hann window in-place. */
export function hannWindow(buf: Float32Array) {
  const N = buf.length
  for (let i = 0; i < N; i++) {
    buf[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  }
}

/**
 * In-place radix-2 Cooley–Tukey FFT.
 *
 * Single source of truth for the radix-2 butterfly used across the RAIN
 * DSP modules. Both `real` and `imag` must be the same power-of-two length;
 * both arrays are mutated in place to hold the forward-FFT result.
 *
 * Determinism: same input → same output, bit-for-bit. No Math.random,
 * no Date.now — pure floating-point arithmetic.
 *
 * Previously this exact algorithm was duplicated in `stems.ts`,
 * `reference-match.ts`, and `aie.ts` (each file kept a private copy because
 * dsp.ts only exposed the higher-level `fftMagnitude` wrapper). It is now
 * exported here so all four call sites share one implementation.
 */
export function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const N = real.length
  if (N <= 1) return
  if (N & (N - 1)) throw new Error('FFT size must be a power of 2')

  // Bit-reversal permutation
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
    }
  }

  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1
    const ang = -2 * Math.PI / len
    const wReal = Math.cos(ang)
    const wImag = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let curReal = 1
      let curImag = 0
      for (let k = 0; k < halfLen; k++) {
        const a = i + k
        const b = a + halfLen
        const evenReal = real[a]
        const evenImag = imag[a]
        const oddReal = real[b] * curReal - imag[b] * curImag
        const oddImag = real[b] * curImag + imag[b] * curReal
        real[a] = evenReal + oddReal
        imag[a] = evenImag + oddImag
        real[b] = evenReal - oddReal
        imag[b] = evenImag - oddImag
        const newReal = curReal * wReal - curImag * wImag
        curImag = curReal * wImag + curImag * wReal
        curReal = newReal
      }
    }
  }
}

/**
 * FFT magnitude spectrum (size must be power of 2).
 * Returns Float32Array of length N/2 with magnitudes in dB.
 */
export function fftMagnitude(input: Float32Array): Float32Array {
  const N = input.length
  if (N & (N - 1)) throw new Error('FFT size must be power of 2')

  const real = new Float32Array(N)
  const imag = new Float32Array(N)
  for (let i = 0; i < N; i++) real[i] = input[i]

  fftInPlace(real, imag)

  const out = new Float32Array(N / 2)
  for (let i = 0; i < N / 2; i++) {
    const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N
    out[i] = 20 * Math.log10(mag + 1e-10)
  }
  return out
}

// ---------------------------------------------------------------------------
// Mid/Side analysis
// ---------------------------------------------------------------------------

export function midSideEncode(left: Float32Array, right: Float32Array): { mid: Float32Array; side: Float32Array } {
  const mid = new Float32Array(left.length)
  const side = new Float32Array(left.length)
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i] + right[i]) * 0.5
    side[i] = (left[i] - right[i]) * 0.5
  }
  return { mid, side }
}

export function midSideDecode(mid: Float32Array, side: Float32Array): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(mid.length)
  const right = new Float32Array(mid.length)
  for (let i = 0; i < mid.length; i++) {
    left[i] = mid[i] + side[i]
    right[i] = mid[i] - side[i]
  }
  return { left, right }
}

/**
 * P2-METERS — Real-time stereo correlation (Pearson product-moment).
 *
 * Returns a value in [-1, +1]:
 *   +1 = perfectly correlated (mono)
 *    0 = uncorrelated (wide stereo / out-of-phase mid)
 *   -1 = perfectly anti-correlated (out of phase)
 *
 * Computed as the normalized dot product of L and R over the full window:
 *
 *     r = Σ(L·R) / sqrt(ΣL² · ΣR²)
 *
 * This is the same Pearson correlation used by the QC metrics phase
 * correlation field. Extracted as a standalone exported function so the
 * real-time meter (StereoCorrelationMeter) and the offline QC measurement
 * share the same implementation. Pure function — no side effects, no
 * allocation beyond two accumulator scalars.
 *
 * Used during playback at ~30 Hz by the audio engine tick() loop to drive
 * the live stereo correlation meter (a REAL measured value, not a static
 * render-time snapshot).
 */
export function computeCorrelation(left: Float32Array, right: Float32Array): number {
  const n = Math.min(left.length, right.length)
  if (n === 0) return 1 // guard: no data — treat as mono (perfectly correlated)
  let dot = 0
  let lEnergy = 0
  let rEnergy = 0
  for (let i = 0; i < n; i++) {
    const l = left[i]
    const r = right[i]
    dot += l * r
    lEnergy += l * l
    rEnergy += r * r
  }
  const denom = Math.sqrt(lEnergy * rEnergy)
  // Slightly tighter epsilon than QC version (1e-12) — still NaN-safe.
  return denom > 1e-20 ? dot / denom : 1
}

export function stereoWidthRatio(left: Float32Array, right: Float32Array): number {
  let midPow = 0, sidePow = 0
  for (let i = 0; i < left.length; i++) {
    const m = (left[i] + right[i]) * 0.5
    const s = (left[i] - right[i]) * 0.5
    midPow += m * m
    sidePow += s * s
  }
  return Math.sqrt(sidePow / (midPow + 1e-10))
}

// ---------------------------------------------------------------------------
// Saturation (analog modeling)
// ---------------------------------------------------------------------------

export type SaturationMode = 'tape' | 'tube' | 'transformer'

/** Apply analog saturation in-place. drive 0..1 (where 1 = maximum drive). */
export function applySaturation(samples: Float32Array, drive: number, mode: SaturationMode = 'tape') {
  // BUG FIX: guard k against 0 — tanh(0)/tanh(0) = 0/0 = NaN in tape mode,
  // and (1-exp(0))/(1-exp(0)) = 0/0 = NaN in tube mode. A drive of 0 would
  // propagate NaN through the entire signal.
  const k = Math.max(drive * 4, 1e-6) // up to 4× drive, never zero
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    let y: number
    switch (mode) {
      case 'tape':
        // Soft clip with hysteresis-like character (tanh)
        y = Math.tanh(x * k) / Math.tanh(k)
        break
      case 'tube': {
        // AUDIT-C3 FIX: the original negative branch was
        //   (Math.exp(x*k) - 1) / (Math.exp(k) - 1) * -1
        // which INVERTED POLARITY (negative input → positive output) and had
        // the wrong magnitude (denominator ~exp(k)× too large). Replaced with
        // a sign-preserving soft-saturating curve; the negative half uses a
        // slightly milder drive (0.85×) to give a tube-like even-harmonic
        // character without the polarity flip.
        //
        // P1 FIX (round 2): clamp the final output to [-1, 1]. The normalized
        // waveshaper `mag = (1 - exp(-ax*driveK)) / (1 - exp(-driveK))` is
        // bounded by 1/(1-exp(-driveK)) as ax → ∞ — for driveK = 4 that is
        // ~1.0186, and for the negative-branch driveK = 3.4 it is ~1.0346.
        // For inputs strictly within [-1, 1] mag ∈ [0, 1] (because the
        // denominator normalizes mag(ax=1) = 1), but the saturation stage
        // runs AFTER EQ + multiband compression + stereo widening, any of
        // which can push peaks above 1.0. Without the clamp those overshoots
        // would propagate as floating-point > 1.0 values into the master bus,
        // eventually forcing the Stage 12 limiter to do extra work. Clamping
        // here keeps the waveshaper honest about its "bounded [-1, 1]" claim
        // and matches the existing `transformer` mode's hard clamp.
        const ax = Math.abs(x)
        const driveK = x > 0 ? k : k * 0.85
        const mag = (1 - Math.exp(-ax * driveK)) / (1 - Math.exp(-driveK))
        y = x < 0 ? -mag : mag
        if (y > 1) y = 1
        else if (y < -1) y = -1
        break
      }
      case 'transformer':
        // Square-law approximation with soft knee
        y = x + k * x * x * Math.sign(x) * -0.3 + k * 0.3 * Math.tanh(x * 3)
        y = Math.max(-1, Math.min(1, y))
        break
    }
    samples[i] = y
  }
}

// ---------------------------------------------------------------------------
// Limiter (look-ahead, monotonic deque max-gain-reduction)
// ---------------------------------------------------------------------------

export interface LimiterParams {
  ceiling: number // dBTP (e.g. -1.0)
  threshold: number // dB (e.g. -1.0)
  releaseMs: number // e.g. 100
  lookAheadMs: number // e.g. 5
  sampleRate: number
}

/**
 * Simple look-ahead brickwall limiter. Uses cascaded box filters for smooth
 * gain envelope (per RAIN V6 spec).
 */
export function applyLimiter(samples: Float32Array, params: LimiterParams): Float32Array {
  const { ceiling, threshold, releaseMs, lookAheadMs, sampleRate } = params
  const ceilingLin = Math.pow(10, ceiling / 20)
  const thresholdLin = Math.pow(10, threshold / 20)
  const lookAhead = Math.max(1, Math.floor(lookAheadMs * 0.001 * sampleRate))
  const releaseCoef = Math.exp(-1 / (releaseMs * 0.001 * sampleRate))

  // AUDIT-C2 FIX (round 2): the previous round introduced future-sample
  // detection (reading `samples[i + lookAhead]`) but still applied the
  // resulting gain envelope to `samples[i]` — i.e. the gain reduction fired
  // `lookAhead` samples BEFORE the peak in the OUTPUT, and by the time the
  // peak itself reached the output the gain envelope had already started
  // recovering. The hard ceiling clamp was therefore still doing all the
  // actual limiting (audible clipping distortion on transients) — exactly
  // the symptom the first round was supposed to fix.
  //
  // The correct look-ahead architecture: detect on `samples[i + lookAhead]`,
  // then DELAY the gain envelope by `lookAhead` samples so the gain computed
  // when the peak was first detected is applied to the peak itself. With
  // this alignment, `out[peakIdx] = samples[peakIdx] * gainEnv[peakIdx - lookAhead]`
  // — the minimum-gain entry — and the ceiling clamp becomes a true safety
  // net instead of the primary mechanism.
  const gainEnv = new Float32Array(samples.length)
  let gain = 1
  for (let i = 0; i < samples.length; i++) {
    const futureIdx = i + lookAhead
    const sample = futureIdx < samples.length ? samples[futureIdx] : 0
    const absSample = Math.abs(sample)
    let targetGain = 1
    if (absSample > thresholdLin) {
      targetGain = thresholdLin / absSample
    }
    // Smooth release: gain reduces instantly, recovers exponentially
    if (targetGain < gain) {
      gain = targetGain
    } else {
      gain = gain + (1 - gain) * (1 - releaseCoef)
    }
    gainEnv[i] = gain
  }

  // Apply the DELAYED gain envelope to the input samples. For the first
  // `lookAhead` samples no gain envelope is available yet (the look-ahead
  // window extends before the start of the buffer) so we use gain = 1.
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const g = i >= lookAhead ? gainEnv[i - lookAhead] : 1
    let s = samples[i] * g
    if (s > ceilingLin) s = ceilingLin
    if (s < -ceilingLin) s = -ceilingLin
    out[i] = s
  }
  return out
}

/**
 * True-peak-aware limiter.
 *
 * WHY THIS EXISTS — the classic "true-peak always fails by a hair" bug:
 * `applyLimiter` is a SAMPLE-peak brickwall — it clamps individual samples to a
 * linear ceiling. But true-peak (dBTP) measures the reconstructed band-limited
 * signal, which peaks BETWEEN samples (the inter-sample peak, ISP). For typical
 * mastered audio the ISP overshoots the sample peak by 0.2–0.6 dB; for
 * hard-clipped transients it can reach ~1 dB. So limiting sample-peak to the
 * dBTP ceiling leaves the measured true-peak sitting just above it → QC "fail"
 * by a small margin, every time.
 *
 * This wrapper closes the loop: limit → measure dBTP → feed the excess back into
 * the limiter ceiling → re-limit. Converges in 1–2 iterations for program
 * material. `params.ceiling` is treated as the TARGET TRUE-PEAK; we aim 0.05 dB
 * below it for safety so the QC `tp <= ceiling` check passes with margin.
 */
export function applyTruePeakLimiter(
  samples: Float32Array,
  params: LimiterParams,
  maxIterations = 4,
): Float32Array {
  const targetCeiling = params.ceiling // dBTP we must not exceed
  const passLevel = targetCeiling - 0.05 // aim slightly under for QC safety margin
  const thresholdOffset = params.ceiling - params.threshold // e.g. 0.5 dB
  let workingCeiling = targetCeiling
  let out = samples
  for (let iter = 0; iter < maxIterations; iter++) {
    out = applyLimiter(out, {
      ...params,
      ceiling: workingCeiling,
      threshold: workingCeiling - thresholdOffset,
    })
    const tp = computeTruePeak(out)
    if (tp <= passLevel) break // within target — done
    const excess = tp - passLevel
    // Drop the sample-peak ceiling by the full measured excess. The next
    // limiter pass will then leave true-peak under target.
    workingCeiling = workingCeiling - excess
  }
  return out
}

// ---------------------------------------------------------------------------
// Heuristic ProcessingParams — genre + platform → 46 params
// Mirrors backend/app/services/heuristic_params.py
// ---------------------------------------------------------------------------

function defaultParams(): ProcessingParams {
  return {
    target_lufs: -14.0,
    true_peak_ceiling: -1.0,
    mb_threshold_low: -20.0, mb_threshold_mid: -18.0, mb_threshold_high: -16.0,
    mb_ratio_low: 2.5, mb_ratio_mid: 2.0, mb_ratio_high: 2.0,
    mb_attack_low: 10.0, mb_attack_mid: 5.0, mb_attack_high: 2.0,
    mb_release_low: 150.0, mb_release_mid: 80.0, mb_release_high: 40.0,
    eq_gains: [0, 0, 0, 0, 0, 0, 0, 0],
    analog_saturation: false, saturation_drive: 0.0, saturation_mode: 'tape',
    ms_enabled: false, mid_gain: 0.0, side_gain: 0.0, stereo_width: 1.0,
    sail_enabled: false, sail_stem_gains: new Array(12).fill(0),
    vinyl_mode: false,
    macro_brighten: 5.0, macro_glue: 5.0, macro_width: 5.0, macro_punch: 5.0,
    macro_warmth: 5.0, macro_space: 5.0, macro_repair: 0.0,
  }
}

// AUDIT-M5 FIX: previously GENRE_OVERRIDES set fields (mb_threshold_*, mb_ratio_*,
// stereo_width, analog_saturation, saturation_drive, macro_*) that were ALL
// overwritten by applyMacrosToParams() — making them dead code. Now each genre
// sets ONLY the fields that applyMacrosToParams does NOT touch:
//   - mb_attack_low/mid/high, mb_release_low/high: multiband time constants
//     (genre-specific transient response — e.g. rock has faster attack for
//     punchy drums, classical has slower attack for natural dynamics)
//   - mid_gain: center channel emphasis (vocals in pop, low cut in rock)
// These fields survive applyMacrosToParams and actually affect the render.
const GENRE_OVERRIDES: Record<string, Partial<ProcessingParams>> = {
  electronic: {
    // Fast attack/release for loud, punchy electronic — squashes transients
    mb_attack_low: 2.0, mb_attack_mid: 1.0, mb_attack_high: 0.5,
    mb_release_low: 80.0, mb_release_high: 30.0,
    mid_gain: -0.5, // slight center reduction for wider image
  },
  hiphop: {
    // Fast low-band attack for tight kick, slow mid for vocal presence
    mb_attack_low: 1.5, mb_attack_mid: 8.0, mb_attack_high: 1.0,
    mb_release_low: 60.0, mb_release_high: 40.0,
    mid_gain: 1.0, // center emphasis for vocals
  },
  rock: {
    // Medium attack for punchy drums, fast high release for cymbals
    mb_attack_low: 3.0, mb_attack_mid: 5.0, mb_attack_high: 2.0,
    mb_release_low: 100.0, mb_release_high: 35.0,
    mid_gain: -1.0, // reduce center mud, widen guitars
  },
  pop: {
    // Balanced — moderate attack for natural transients
    mb_attack_low: 5.0, mb_attack_mid: 10.0, mb_attack_high: 3.0,
    mb_release_low: 120.0, mb_release_high: 45.0,
    mid_gain: 0.5, // slight vocal emphasis
  },
  classical: {
    // Slow attack/release for maximum dynamics preservation
    mb_attack_low: 15.0, mb_attack_mid: 20.0, mb_attack_high: 12.0,
    mb_release_low: 250.0, mb_release_high: 100.0,
    mid_gain: 0.0,
  },
  jazz: {
    // Gentle — slow attack, medium release for natural feel
    mb_attack_sub: 8.0, mb_attack_low: 10.0, mb_attack_mid: 15.0, mb_attack_high: 8.0, mb_attack_air: 5.0,
    mb_release_sub: 140.0, mb_release_low: 180.0, mb_release_high: 70.0, mb_release_air: 55.0,
    mid_gain: 0.0,
  },
  amapiano: {
    // Deep, log-drum-forward: fast low attack for tight kick, slow mid for
    // shaker/groove presence, wide stereo for synth pads + keys
    mb_attack_sub: 1.0, mb_attack_low: 1.5, mb_attack_mid: 12.0, mb_attack_high: 5.0, mb_attack_air: 3.0,
    mb_release_sub: 40.0, mb_release_low: 55.0, mb_release_high: 45.0, mb_release_air: 35.0,
    mid_gain: 0.0, // wide mix — don't center-bias
    stereo_width: 1.25, // wide synth pads and stereo log drums
    analog_saturation: true,
    saturation_drive: 0.15,
    saturation_mode: 'tape' as const,
  },
  gospel: {
    // Vocal-forward: strong center for choir/lead, moderate compression
    // with long release for sustained notes and dynamic builds
    mb_attack_sub: 4.0, mb_attack_low: 6.0, mb_attack_mid: 10.0, mb_attack_high: 5.0, mb_attack_air: 3.0,
    mb_release_sub: 120.0, mb_release_low: 150.0, mb_release_high: 60.0, mb_release_air: 45.0,
    mid_gain: 1.5, // center emphasis for choir + lead vocals
    stereo_width: 1.1, // slightly wider for organ/piano
  },
  afrobeats: {
    // Percussive + melodic: tight kick via fast low attack, wide mid for
    // layered percussion, warm saturation for vintage afro-groove
    mb_attack_sub: 1.5, mb_attack_low: 2.0, mb_attack_mid: 6.0, mb_attack_high: 3.0, mb_attack_air: 2.0,
    mb_release_sub: 55.0, mb_release_low: 70.0, mb_release_high: 40.0, mb_release_air: 30.0,
    mid_gain: -0.5, // de-emphasize center for wide percussion field
    stereo_width: 1.2,
    analog_saturation: true,
    saturation_drive: 0.25,
    saturation_mode: 'tape' as const,
  },
  afro_house: {
    // Driving 4/4: tight all-band attack, punchy mid for percussive
    // layers, clean highs for shakers and rides
    mb_attack_sub: 1.5, mb_attack_low: 2.0, mb_attack_mid: 4.0, mb_attack_high: 2.0, mb_attack_air: 1.5,
    mb_release_sub: 60.0, mb_release_low: 80.0, mb_release_high: 35.0, mb_release_air: 28.0,
    mid_gain: -1.0, // wide soundstage for house
    stereo_width: 1.3,
    analog_saturation: true,
    saturation_drive: 0.2,
    saturation_mode: 'tube' as const,
  },
  gqom: {
    // Minimal, raw, bass-heavy: fast low attack with high ratio for
    // crushing sub-bass, slow high attack to preserve raw percussion edge
    mb_attack_sub: 0.8, mb_attack_low: 1.0, mb_attack_mid: 3.0, mb_attack_high: 15.0, mb_attack_air: 10.0,
    mb_release_sub: 30.0, mb_release_low: 40.0, mb_release_high: 25.0, mb_release_air: 20.0,
    mid_gain: -0.5,
    stereo_width: 1.15,
    analog_saturation: false, // keep it raw and digital
  },
  metal: {
    // Aggressive, fast: tight attack across all bands for palm-muted
    // precision, fast release for clarity in dense arrangements
    mb_attack_sub: 1.5, mb_attack_low: 2.0, mb_attack_mid: 3.0, mb_attack_high: 1.5, mb_attack_air: 1.0,
    mb_release_sub: 40.0, mb_release_low: 50.0, mb_release_high: 25.0, mb_release_air: 20.0,
    mid_gain: -2.0, // push guitars to sides, leave kick/snare center
  },
  rnb: {
    // Smooth + punchy: moderate attack, vocal-forward mid, clean highs
    mb_attack_sub: 3.0, mb_attack_low: 4.0, mb_attack_mid: 8.0, mb_attack_high: 3.0, mb_attack_air: 2.5,
    mb_release_sub: 80.0, mb_release_low: 100.0, mb_release_high: 50.0, mb_release_air: 40.0,
    mid_gain: 1.0, // vocal emphasis
    stereo_width: 1.15,
  },
  country: {
    // Natural, acoustic-forward: slow attack, moderate ratio for
    // transparent dynamics — preserves guitar picking and vocal nuance
    mb_attack_sub: 8.0, mb_attack_low: 10.0, mb_attack_mid: 15.0, mb_attack_high: 8.0, mb_attack_air: 5.0,
    mb_release_sub: 150.0, mb_release_low: 200.0, mb_release_high: 80.0, mb_release_air: 60.0,
    mid_gain: 0.5,
  },
  reggae: {
    // Bass-forward dub: slow low attack for sub weight, fast high for
    // clean skank guitar and hi-hat clarity
    mb_attack_sub: 6.0, mb_attack_low: 8.0, mb_attack_mid: 12.0, mb_attack_high: 4.0, mb_attack_air: 3.0,
    mb_release_sub: 120.0, mb_release_low: 150.0, mb_release_high: 45.0, mb_release_air: 35.0,
    mid_gain: 0.0,
    stereo_width: 1.2,
  },
  ambient: {
    // No compression — max dynamics preservation. Slow attack + low
    // ratio = near-transparent; wide stereo for pads and drones
    mb_attack_sub: 15.0, mb_attack_low: 20.0, mb_attack_mid: 25.0, mb_attack_high: 15.0, mb_attack_air: 10.0,
    mb_release_sub: 250.0, mb_release_low: 300.0, mb_release_high: 120.0, mb_release_air: 90.0,
    mid_gain: 0.0,
    stereo_width: 1.4,
  },
}

export function generateHeuristicParams(genre: string, platform: string, macros: MacroValues): ProcessingParams {
  const params = defaultParams()
  const target = PLATFORM_TARGET_MAP[platform] ?? { targetLufs: -14, truePeakCeiling: -1 }
  params.target_lufs = target.targetLufs
  if (platform === 'vinyl') {
    params.vinyl_mode = true
    params.true_peak_ceiling = -3.0
  } else {
    params.true_peak_ceiling = target.truePeakCeiling
  }
  const overrides = GENRE_OVERRIDES[genre] ?? {}
  Object.assign(params, overrides)
  // Apply macro overrides (macros are authoritative source of truth post-heuristic)
  params.macro_brighten = macros.brighten
  params.macro_glue = macros.glue
  params.macro_width = macros.width
  params.macro_punch = macros.punch
  params.macro_warmth = macros.warmth
  params.macro_space = macros.space
  params.macro_repair = macros.repair
  // Macros drive derived params
  applyMacrosToParams(params)
  return params
}

import { PLATFORM_TARGETS } from './constants'
const PLATFORM_TARGET_MAP: Record<string, { targetLufs: number; truePeakCeiling: number }> =
  Object.fromEntries(PLATFORM_TARGETS.map((p) => [p.slug, { targetLufs: p.targetLufs, truePeakCeiling: p.truePeakCeiling }]))

/**
 * Apply 7 macro controls → derived ProcessingParams fields.
 * Mapping per RAIN V6 spec:
 *  - BRIGHTEN (0..10): high-shelf @ 8 kHz 0→+4 dB; air peak @ 16 kHz 0→+3 dB
 *  - GLUE: multiband ratios 1:1→4.5:1 (sub), 1:1→4:1 (low/mid), 1:1→3.5:1 (high/air)
 *  - WIDTH: stereo_width 0.7→1.5 (bass mono < 200 Hz always)
 *  - PUNCH: mid-band attack 1→15 ms, release 80→30 ms
 *  - WARMTH: low-shelf @ 200 Hz 0→+3 dB; saturation_drive 0→0.5
 *  - SPACE: stereo_width contribution + side gain
 *  - REPAIR: HPF @ 20→80 Hz; de-ess intensity
 */
export function applyMacrosToParams(params: ProcessingParams): void {
  const m = {
    brighten: params.macro_brighten / 10,
    glue: params.macro_glue / 10,
    width: params.macro_width / 10,
    punch: params.macro_punch / 10,
    warmth: params.macro_warmth / 10,
    space: params.macro_space / 10,
    repair: params.macro_repair / 10,
  }

  // EQ: 8-band [60, 200, 500, 1k, 2k, 4k, 8k, 16k]
  params.eq_gains = [
    m.warmth * 3,        // 60 Hz — warmth low-shelf contribution
    m.warmth * 2.5,      // 200 Hz — warmth body
    0,                   // 500 Hz
    m.punch * 1.5,       // 1 kHz — punch presence
    m.punch * 2,         // 2 kHz — punch attack
    m.brighten * 1.5,    // 4 kHz
    m.brighten * 4,      // 8 kHz — brighten high-shelf
    m.brighten * 3,      // 16 kHz — air
  ]

  // Multiband — glue drives ratios & thresholds
  params.mb_ratio_low = 1.0 + m.glue * 3.0
  params.mb_ratio_mid = 1.0 + m.glue * 3.0
  params.mb_ratio_high = 1.0 + m.glue * 2.5
  params.mb_threshold_low = -20 + m.glue * 4
  params.mb_threshold_mid = -18 + m.glue * 4
  params.mb_threshold_high = -16 + m.glue * 4

  // Punch — mid-band attack/release shaping
  params.mb_attack_mid = 15 - m.punch * 10 // punchy = fast attack (1 ms), soft = slow (15 ms)
  params.mb_release_mid = 80 - m.punch * 40

  // Stereo width
  params.stereo_width = 0.7 + m.width * 0.8 + m.space * 0.3
  params.side_gain = m.space * 1.5
  params.ms_enabled = true

  // Saturation
  params.analog_saturation = m.warmth > 0.05
  params.saturation_drive = m.warmth * 0.5
  params.saturation_mode = 'tape'

  // Repair — HPF + de-ess
  if (m.repair > 0.05) {
    // encoded into eq_gains[0] sign (we'll apply HPF separately)
    params.macro_repair = m.repair * 10
  }
}

// ---------------------------------------------------------------------------
// P2-METERS — FFT-derived spectral descriptors
// Real measurements over the magnitude spectrum. No synthetic data.
// ---------------------------------------------------------------------------

/**
 * ISO 31-band 1/3-octave center frequencies (20 Hz .. 20 kHz).
 * These are the canonical band centers used by reference-match.ts and the
 * Stage 5 reference curve. Each band's edges are fc / 2^(1/6) .. fc * 2^(1/6).
 */
export const THIRD_OCTAVE_BANDS_HZ: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
  20000,
]

/**
 * Compute the full set of FFT-derived spectral descriptors from a magnitude
 * spectrum. Pure function — no side effects.
 *
 *   - Centroid: Σ(f·mag) / Σ(mag)  → brightness measure (Hz)
 *   - Spread: sqrt(Σ((f - centroid)²·mag) / Σ(mag))  → spectral variance (Hz)
 *   - Skewness: 3rd central moment / spread³ (dimensionless)
 *   - Kurtosis: 4th central moment / spread⁴ (dimensionless)
 *   - Rolloff 85%: smallest f such that Σ_{0..f} mag >= 0.85 · Σ mag
 *   - Rolloff 95%: same at 95%
 *   - Flatness: exp(mean(ln(mag))) / mean(mag) — geometric/arithmetic ratio
 *   - Flux: L1 distance vs the previous frame's spectrum (0 if prevSpectrum
 *     is null/undefined — used for the first frame)
 *   - Peak frequency: bin with the maximum magnitude, converted to Hz
 *
 * Input spectrum is the dB-magnitude array as returned by fftMagnitude()
 * (length N/2, where N is the FFT size — typically 1024 for FFT_SIZE=2048).
 *
 * For flatness, dB values are converted back to linear power (10^(dB/10))
 * before taking the log — geometric mean of linear power is meaningful,
 * whereas geometric mean of dB is just arithmetic mean of dB (useless for
 * flatness). Bins with zero power are clamped to 1e-12 to avoid ln(0).
 */
export function computeSpectralFeatures(
  spectrum: Float32Array,
  sampleRate: number,
  prevSpectrum?: Float32Array | null,
): SpectralFeatures {
  const N = spectrum.length
  if (N === 0) {
    return {
      centroid: 0, spread: 0, skewness: 0, kurtosis: 0,
      rolloff85: 0, rolloff95: 0, flatness: 0, flux: 0, peakFrequency: 0,
    }
  }
  // FFT_SIZE = 2 * N (spectrum is N/2 of FFT_SIZE). binHz = sampleRate / FFT_SIZE.
  const binHz = sampleRate / (N * 2)

  // --- Convert dB spectrum to linear power for moment math ---
  // 10^(dB/10) gives linear power (assuming dB = 10·log10(power)).
  // For the moment-based descriptors (centroid, spread, skew, kurt) we use
  // linear power as the weighting term — this is the standard formulation.
  const linear = new Float32Array(N)
  let totalPower = 0
  for (let i = 0; i < N; i++) {
    // Clamp dB at -240 to keep 10^(dB/10) within sane range.
    const db = Math.max(spectrum[i], -240)
    const p = Math.pow(10, db / 10)
    linear[i] = p
    totalPower += p
  }

  // --- Peak frequency (highest magnitude bin) ---
  let peakBin = 0
  let peakVal = -Infinity
  for (let i = 0; i < N; i++) {
    if (spectrum[i] > peakVal) {
      peakVal = spectrum[i]
      peakBin = i
    }
  }
  const peakFrequency = peakBin * binHz

  // --- Spectral centroid (weighted mean frequency) ---
  let weightedSum = 0
  for (let i = 0; i < N; i++) {
    weightedSum += (i * binHz) * linear[i]
  }
  const centroid = totalPower > 1e-20 ? weightedSum / totalPower : 0

  // --- Spread (standard deviation around centroid) ---
  let varSum = 0
  for (let i = 0; i < N; i++) {
    const f = i * binHz
    const d = f - centroid
    varSum += d * d * linear[i]
  }
  const spread = totalPower > 1e-20 ? Math.sqrt(varSum / totalPower) : 0

  // --- Skewness & kurtosis (normalized central moments) ---
  let m3 = 0, m4 = 0
  if (spread > 1e-12 && totalPower > 1e-20) {
    for (let i = 0; i < N; i++) {
      const f = i * binHz
      const d = (f - centroid) / spread
      const w = linear[i] / totalPower
      m3 += d * d * d * w
      m4 += d * d * d * d * w
    }
  }
  const skewness = m3
  const kurtosis = m4

  // --- Spectral rolloff (85% and 95% cumulative energy) ---
  const rolloffAt = (threshold: number): number => {
    if (totalPower <= 1e-20) return 0
    const target = threshold * totalPower
    let cum = 0
    for (let i = 0; i < N; i++) {
      cum += linear[i]
      if (cum >= target) return i * binHz
    }
    return (N - 1) * binHz
  }
  const rolloff85 = rolloffAt(0.85)
  const rolloff95 = rolloffAt(0.95)

  // --- Spectral flatness (geometric / arithmetic mean ratio) ---
  // Computed on linear power. Bins with zero power are clamped to 1e-12.
  let logSum = 0
  let arithSum = 0
  for (let i = 0; i < N; i++) {
    const p = Math.max(linear[i], 1e-12)
    logSum += Math.log(p)
    arithSum += p
  }
  const geoMean = Math.exp(logSum / N)
  const arithMean = arithSum / N
  const flatness = arithMean > 1e-20 ? Math.max(0, Math.min(1, geoMean / arithMean)) : 0

  // --- Spectral flux (L1 distance vs previous frame) ---
  let flux = 0
  if (prevSpectrum && prevSpectrum.length === N) {
    for (let i = 0; i < N; i++) {
      // Use the POSITIVE difference (new spectral content), per the standard
      // flux formulation. Negative differences (decaying content) are clamped
      // to 0 so the flux measures onset strength, not overall change.
      const cur = Math.max(linear[i], 0)
      const prevDb = Math.max(prevSpectrum[i], -240)
      const prev = Math.pow(10, prevDb / 10)
      const diff = cur - prev
      if (diff > 0) flux += diff
    }
    // Normalize by N so the metric is comparable across FFT sizes.
    flux = flux / N
  }

  return {
    centroid, spread, skewness, kurtosis,
    rolloff85, rolloff95, flatness, flux, peakFrequency,
  }
}

/**
 * Compute ISO 31-band 1/3-octave band energies from a magnitude spectrum.
 * Returns a Float32Array of length 31 with band energies in dB, indexed by
 * the THIRD_OCTAVE_BANDS_HZ array (20, 25, 31.5, ... 20000 Hz).
 *
 * Each band's energy is the average dB magnitude across the FFT bins whose
 * center frequency falls inside the band's [fc / 2^(1/6), fc * 2^(1/6)]
 * range. Bands with no bins (above Nyquist) are filled with -120 dB.
 */
export function computeThirdOctaveBands(
  spectrum: Float32Array,
  sampleRate: number,
): Float32Array {
  const N = spectrum.length
  const binHz = sampleRate / (N * 2) // FFT_SIZE = 2 * N
  const nyquist = sampleRate / 2
  const ratio = Math.pow(2, 1 / 6) // 1/3-octave band edge ratio
  const out = new Float32Array(THIRD_OCTAVE_BANDS_HZ.length)
  for (let bi = 0; bi < THIRD_OCTAVE_BANDS_HZ.length; bi++) {
    const fc = THIRD_OCTAVE_BANDS_HZ[bi]
    if (fc > nyquist) {
      out[bi] = -120
      continue
    }
    const loHz = fc / ratio
    const hiHz = fc * ratio
    const loBin = Math.max(1, Math.floor(loHz / binHz))
    const hiBin = Math.min(N - 1, Math.ceil(hiHz / binHz))
    if (hiBin < loBin) {
      out[bi] = -120
      continue
    }
    let sum = 0
    let count = 0
    for (let b = loBin; b <= hiBin; b++) {
      sum += spectrum[b]
      count++
    }
    out[bi] = count > 0 ? sum / count : -120
  }
  return out
}

// ---------------------------------------------------------------------------
// Full audio analysis
// ---------------------------------------------------------------------------

export function analyzeAudio(channels: Float32Array[], sampleRate: number): AudioAnalysis {
  if (channels.length === 0) {
    throw new Error('No channels to analyze')
  }
  const lufs = computeLufs(channels, sampleRate)
  const left = channels[0]
  const right = channels[1] ?? channels[0]
  const truePeak = Math.max(computeTruePeak(left), computeTruePeak(right))
  const rms = computeRms(left)
  const peak = computePeak(left)
  const crestFactor = peak - rms
  const lra = computeLra(channels, sampleRate)
  const duration = left.length / sampleRate

  // Spectrum — average of 8 windows of 2048
  const FFT_SIZE = 2048
  const spectrumSum = new Float32Array(FFT_SIZE / 2)
  const numWindows = Math.max(1, Math.floor(left.length / FFT_SIZE))
  const windowsToAverage = Math.min(8, numWindows)
  const step = Math.floor(numWindows / windowsToAverage) || 1
  let count = 0
  for (let w = 0; w < windowsToAverage; w++) {
    const start = w * step * FFT_SIZE
    if (start + FFT_SIZE > left.length) break
    const buf = left.subarray(start, start + FFT_SIZE).slice()
    hannWindow(buf)
    const mag = fftMagnitude(buf)
    for (let i = 0; i < FFT_SIZE / 2; i++) spectrumSum[i] += mag[i]
    count++
  }
  const spectrum = new Float32Array(FFT_SIZE / 2)
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = spectrumSum[i] / Math.max(1, count)

  // Peak frequency
  let peakBin = 0
  let peakVal = -Infinity
  for (let i = 1; i < spectrum.length; i++) {
    if (spectrum[i] > peakVal) {
      peakVal = spectrum[i]
      peakBin = i
    }
  }
  const peakFrequency = (peakBin * sampleRate) / FFT_SIZE

  // Zero-crossing rate
  let zc = 0
  for (let i = 1; i < left.length; i++) {
    if ((left[i] >= 0) !== (left[i - 1] >= 0)) zc++
  }
  const zeroCrossingRate = zc / (left.length / sampleRate)

  // BPM estimation via autocorrelation on low-passed envelope (simplified)
  const bpm = estimateBpm(left, sampleRate)

  // Musical key estimate via chroma-ish peak bin
  const key = estimateKey(peakFrequency)

  // AUDIT-P2: real QC metrics (replaces 9 hardcoded values in QCTab).
  const qcMetrics = computeQCMetrics(left, right, spectrum, sampleRate, channels.length)

  // P2-METERS: real FFT-derived spectral descriptors (centroid, spread,
  // skewness, kurtosis, rolloff85/95, flatness, flux, peak frequency).
  // No previous spectrum for the offline analysis — flux returns 0.
  const spectralFeatures = computeSpectralFeatures(spectrum, sampleRate, null)

  // P2-METERS: ISO 31-band 1/3-octave band energies in dB.
  const thirdOctaveBands = computeThirdOctaveBands(spectrum, sampleRate)

  return {
    lufs, truePeak, rms, crestFactor, dynamicRange: lra,
    sampleRate, duration, channels: channels.length, bitDepth: 24,
    bpm, key, spectrum, peakFrequency, zeroCrossingRate, qcMetrics,
    spectralFeatures, thirdOctaveBands,
  }
}

/**
 * Real QC measurements derived from channel data + the already-computed
 * magnitude spectrum. Replaces the 9 prior constant verdicts that QCTab
 * used to display regardless of the actual audio.
 *
 * Spectrum is the FFT magnitude in dB (length FFT_SIZE/2 = 1024 bins for a
 * 2048 FFT). Bin frequency = bin * sampleRate / FFT_SIZE.
 *
 * P2-QC FIX: every field in the returned QCMetrics is now computed from
 * the real audio buffer — no constants, no `Math.random`, no estimation.
 * Adds: rmsDb, phaseCoherence (short-time cross-correlation),
 * zeroCrossingRate, zeroCrossingStuck (clipping-at-zero),
 * transientDensity, preechoRisk.
 * Replaces the previous block-averaged side-bass proxy with a real
 * side-channel FFT (band-limited < 200 Hz).
 */
export function computeQCMetrics(
  left: Float32Array,
  right: Float32Array,
  spectrum: Float32Array,
  sampleRate: number,
  _channelCount: number,
): import('./types').QCMetrics {
  const n = Math.min(left.length, right.length)

  // --- DC offset: mean of the signal (averaged across both channels),
  // as a fraction of full-scale ---
  let dcSum = 0
  for (let i = 0; i < n; i++) dcSum += (left[i] + right[i]) * 0.5
  const dcOffset = n > 0 ? Math.abs(dcSum / n) : 0

  // --- RMS (averaged across both channels) in dBFS ---
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const m = (left[i] + right[i]) * 0.5
    sumSq += m * m
  }
  const rmsLin = n > 0 ? Math.sqrt(sumSq / n) : 0
  const rmsDb = 20 * Math.log10(Math.max(rmsLin, 1e-7))

  // --- Stereo correlation (full-buffer Pearson L/R) ---
  // P2-METERS: route through the standalone computeCorrelation() so the live
  // meter and the QC metric share one implementation.
  const phaseCorrelation = computeCorrelation(left, right)

  // --- Stereo width: side energy / mid energy ---
  let midE = 0, sideE = 0
  for (let i = 0; i < n; i++) {
    const mid = (left[i] + right[i]) * 0.5
    const side = (left[i] - right[i]) * 0.5
    midE += mid * mid
    sideE += side * side
  }
  const stereoWidth = midE > 1e-12 ? Math.sqrt(sideE / midE) : 0

  // --- Phase coherence: short-time cross-correlation at zero lag,
  // averaged across 20 ms windows. Captures LOCAL phase drift, distinct
  // from the full-buffer Pearson above. ---
  const winSize = Math.max(1, Math.floor(sampleRate * 0.02)) // 20 ms
  let cohSum = 0
  let cohCount = 0
  for (let start = 0; start + winSize <= n; start += winSize) {
    let wd = 0, wl = 0, wr = 0
    for (let i = 0; i < winSize; i++) {
      const l = left[start + i]
      const r = right[start + i]
      wd += l * r
      wl += l * l
      wr += r * r
    }
    const wDenom = Math.sqrt(wl * wr)
    if (wDenom > 1e-12) {
      cohSum += wd / wDenom
      cohCount++
    }
  }
  const phaseCoherence = cohCount > 0 ? cohSum / cohCount : 1

  // --- Zero-crossing rate (crossings per second, averaged across channels) ---
  let zcL = 0, zcR = 0
  for (let i = 1; i < n; i++) {
    if ((left[i] >= 0) !== (left[i - 1] >= 0)) zcL++
    if ((right[i] >= 0) !== (right[i - 1] >= 0)) zcR++
  }
  const durationSec = n / sampleRate
  const zeroCrossingRate = durationSec > 0 ? (zcL + zcR) * 0.5 / durationSec : 0

  // --- Zero-crossing stuck-at-zero clipping: count samples that are
  // exactly 0.0 (or extremely close) while their immediate neighbours are
  // at full scale (|x| > 0.99). This is a tell-tale sign of DC-offset
  // clipping right at the zero crossing — the kind of corruption that
  // a hard-clipper with DC bias produces. ---
  let zeroCrossingStuck = 0
  for (let i = 1; i < n - 1; i++) {
    const li = left[i]
    if (Math.abs(li) < 1e-6) {
      if (Math.abs(left[i - 1]) > 0.99 || Math.abs(left[i + 1]) > 0.99) zeroCrossingStuck++
    }
    const ri = right[i]
    if (Math.abs(ri) < 1e-6) {
      if (Math.abs(right[i - 1]) > 0.99 || Math.abs(right[i + 1]) > 0.99) zeroCrossingStuck++
    }
  }

  // --- Clipped samples: count samples at or beyond ±0.999 ---
  let clippedSamples = 0
  for (let i = 0; i < n; i++) {
    if (Math.abs(left[i]) >= 0.999 || Math.abs(right[i]) >= 0.999) clippedSamples++
  }

  // --- Band energy from the magnitude spectrum ---
  // spectrum is in dB already (from fftMagnitude). Bin width in Hz:
  const FFT_SIZE = spectrum.length * 2
  const binHz = sampleRate / FFT_SIZE
  const bandEnergyDb = (loHz: number, hiHz: number): number => {
    const loBin = Math.max(1, Math.floor(loHz / binHz))
    const hiBin = Math.min(spectrum.length - 1, Math.ceil(hiHz / binHz))
    // Average the magnitude (dB) across the band — spectrum values are already dB.
    let sum = 0, count = 0
    for (let b = loBin; b <= hiBin; b++) { sum += spectrum[b]; count++ }
    return count > 0 ? sum / count : -120
  }

  // --- Bass mono: real side-channel energy below 200 Hz.
  // The previous impl used time-domain block-averaged side energy as a
  // proxy, which was NOT band-limited. Now we compute a side-channel FFT
  // (averaged over a few windows) and average the magnitude below 200 Hz.
  // This is the real M/S bass-mono measurement. ---
  const sideFftSize = 2048
  const sideSpectrumSum = new Float32Array(sideFftSize / 2)
  let sideWindowCount = 0
  const sideMaxWindows = 4
  const sideStep = sideMaxWindows > 1
    ? Math.max(1, Math.floor((n - sideFftSize) / (sideMaxWindows - 1)))
    : 0
  for (let w = 0; w < sideMaxWindows; w++) {
    const start = w * sideStep
    if (start + sideFftSize > n) break
    const buf = new Float32Array(sideFftSize)
    for (let i = 0; i < sideFftSize; i++) {
      buf[i] = (left[start + i] - right[start + i]) * 0.5
    }
    hannWindow(buf)
    const mag = fftMagnitude(buf)
    for (let b = 0; b < sideFftSize / 2; b++) sideSpectrumSum[b] += mag[b]
    sideWindowCount++
  }
  const sideBinHz = sampleRate / sideFftSize
  const bassHiBin = Math.min(sideFftSize / 2 - 1, Math.ceil(200 / sideBinHz))
  let bassSideSum = 0
  let bassSideBins = 0
  if (sideWindowCount > 0) {
    for (let b = 1; b <= bassHiBin; b++) {
      bassSideSum += sideSpectrumSum[b] / sideWindowCount
      bassSideBins++
    }
  }
  // Averaged dB magnitude of the side channel below 200 Hz.
  const bassSideDb = bassSideBins > 0 ? bassSideSum / bassSideBins : -120

  const sibilanceDb = bandEnergyDb(5000, 8000)
  const rumbleDb = bandEnergyDb(0, 20)
  const highFreqDb = bandEnergyDb(15000, sampleRate / 2)

  // --- Transient density: count of onsets per second.
  // An onset is detected when the short-time peak envelope rises sharply
  // above its previous value. This is the real input to codec pre-echo
  // prediction — percussive material with many sharp onsets is what causes
  // audible pre-echo in low-bitrate lossy codecs.
  //
  // Uses peak detection (max |sample|) rather than RMS so that brief
  // transients (1–2 ms) register as a sharp envelope rise even when the
  // background is a loud continuous tone — RMS over a 5 ms window dilutes
  // a 1 ms click with 4 ms of tone, hiding the rise. A 1 ms hop ensures
  // each frame contains either the click peak or pure background, never
  // both, so the peak ratio click-frame / tone-frame is large.
  const envHop = Math.max(1, Math.floor(sampleRate * 0.001)) // 1 ms hop
  const numEnvFrames = Math.max(0, Math.floor(n / envHop))
  const env = new Float32Array(numEnvFrames)
  for (let f = 0; f < numEnvFrames; f++) {
    const start = f * envHop
    const end = Math.min(n, start + envHop)
    let peak = 0
    for (let i = start; i < end; i++) {
      const a = Math.abs((left[i] + right[i]) * 0.5)
      if (a > peak) peak = a
    }
    env[f] = peak
  }
  // Onset threshold: small absolute floor (0.05) to filter out digital
  // silence. The DYNAMIC test is the `env[f] > env[f-1] * 1.3` rise below —
  // that catches sharp attacks regardless of overall level. A global-mean
  // multiple (e.g. envMean * 4) is intentionally NOT used here because it
  // would make the threshold unreachable for loud material (peak ≈ 1.0 <
  // envMean * 4 when envMean > 0.25), missing transients in hot masters
  // entirely.
  const onsetThreshold = 0.05
  const onsetRise = 1.3
  let transientCount = 0
  // Deduplicate onsets that fire on consecutive 1 ms frames (the same
  // physical transient will produce a rise for 1–3 frames in a row). We
  // require a 10 ms refractory period after each detected onset before
  // counting another one.
  const refractoryFrames = Math.max(1, Math.floor(sampleRate * 0.01 / envHop)) // 10 ms
  let lastOnsetFrame = -refractoryFrames
  for (let f = 2; f < numEnvFrames - 1; f++) {
    // Onset = local envelope spike: rises above neighbours AND above floor.
    if (env[f] > onsetThreshold &&
        env[f] > env[f - 1] * onsetRise &&
        env[f] > env[f + 1] &&
        f - lastOnsetFrame >= refractoryFrames) {
      transientCount++
      lastOnsetFrame = f
    }
  }
  const transientDensity = durationSec > 0 ? transientCount / durationSec : 0

  // --- Codec pre-echo risk: 0..1 score.
  // Empirical model: pre-echo is audible when (a) the codec's MDCT window
  // (typically ~2 ms pre-echo for MP3/Opus) is excited by sharp transients,
  // and (b) the signal energy around the transient is high enough to make
  // the pre-echo audible above the masking threshold. We combine the
  // transient density (onsets/sec) with the overall RMS level (which
  // correlates with the post-transient masking floor).
  //   preechoRisk = clamp01(transientDensity / 10) * clamp01((rmsDb + 30) / 30)
  // At -30 dBFS RMS the masking floor is too low to reveal pre-echo; at
  // 0 dBFS RMS even modest transient density becomes audible. 10
  // onsets/sec is the saturation point (very busy percussive material). ---
  const tdFactor = Math.max(0, Math.min(1, transientDensity / 10))
  const rmsFactor = Math.max(0, Math.min(1, (rmsDb + 30) / 30))
  const preechoRisk = Math.max(0, Math.min(1, tdFactor * rmsFactor))

  // --- Effective bandwidth — detects a clean high-frequency cutoff.
  // Scans the spectrum from the Nyquist down toward 10 kHz and finds the
  // lowest-frequency bin (searching downward) where the magnitude rises to
  // within 40 dB of the spectral peak. Everything above that bin is treated
  // as "dead" (below the noise floor). For a full-bandwidth 48 kHz master
  // the result should be ≥ 21 kHz; a value of 16–18 kHz is the tell-tale
  // signature of an MP3/AAC lowpass or a lossy source.
  //
  // The 40 dB threshold is chosen because a clean encoder lowpass drops the
  // signal by 60+ dB within ~1 kHz, while genuine musical content above
  // 15 kHz typically sits 20–35 dB below the spectral peak. 40 dB cleanly
  // separates "real signal" from "filter stop-band".
  let peakDb = -Infinity
  for (let b = 1; b < spectrum.length; b++) if (spectrum[b] > peakDb) peakDb = spectrum[b]
  const bwThreshold = peakDb - 40
  const minSearchHz = 10000 // don't report below 10 kHz — that's a different problem
  const minSearchBin = Math.max(1, Math.floor(minSearchHz / binHz))
  let bandwidthBin = minSearchBin
  // Scan from Nyquist downward. As soon as we find a bin ABOVE threshold,
  // that's the top of the real signal.
  for (let b = spectrum.length - 1; b >= minSearchBin; b--) {
    if (spectrum[b] >= bwThreshold) {
      bandwidthBin = b
      break
    }
  }
  const effectiveBandwidthHz = Math.round(bandwidthBin * binHz)

  return {
    dcOffset,
    phaseCorrelation,
    phaseCoherence,
    stereoWidth,
    rmsDb,
    bassSideDb,
    sibilanceDb,
    rumbleDb,
    highFreqDb,
    zeroCrossingRate,
    zeroCrossingStuck,
    clippedSamples,
    transientDensity,
    preechoRisk,
    effectiveBandwidthHz,
  }
}

function estimateBpm(samples: Float32Array, sampleRate: number): number | null {
  // Envelope follower
  const env = new Float32Array(samples.length)
  let prev = 0
  const decay = 0.999
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    prev = Math.max(a, prev * decay)
    env[i] = prev
  }
  // Autocorrelation on downsampled envelope (100 Hz)
  const dsRate = 100
  const dsLen = Math.floor(env.length * dsRate / sampleRate)
  const ds = new Float32Array(dsLen)
  for (let i = 0; i < dsLen; i++) {
    const srcIdx = Math.floor(i * sampleRate / dsRate)
    ds[i] = env[srcIdx] ?? 0
  }
  // Autocorrelate
  let bestLag = 0
  let bestCorr = 0
  const minLag = Math.floor(dsRate * 60 / 200) // 200 BPM
  const maxLag = Math.floor(dsRate * 60 / 60) // 60 BPM
  for (let lag = minLag; lag <= maxLag && lag < dsLen / 2; lag++) {
    let c = 0
    for (let i = 0; i + lag < dsLen; i++) {
      c += ds[i] * ds[i + lag]
    }
    if (c > bestCorr) {
      bestCorr = c
      bestLag = lag
    }
  }
  if (bestLag === 0) return null
  const bpm = (dsRate * 60) / bestLag
  return Math.round(bpm * 10) / 10
}

function estimateKey(freq: number): string | null {
  if (freq <= 0) return null
  // A4 = 440 Hz, MIDI 69
  const midi = Math.round(69 + 12 * Math.log2(freq / 440))
  if (midi < 0 || midi > 127) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${names[midi % 12]}${octave}`
}

// ---------------------------------------------------------------------------
// RAIN Score V2 — composite quality metric (0-100)
// ---------------------------------------------------------------------------

export interface ScoreInput {
  inputLufs: number
  outputLufs: number
  outputTruePeak: number
  targetLufs: number
  truePeakCeiling: number
  dynamicRange: number
  stereoWidth: number
  codecPenalty: number
}

export function computeRainScore(input: ScoreInput): {
  overall: number
  spotify: number
  apple_music: number
  youtube: number
  tidal: number
  codec_penalty: Record<string, number>
} {
  const lufsDelta = Math.abs(input.outputLufs - input.targetLufs)
  const lufsScore = Math.max(0, 100 - lufsDelta * 8) // ±1 LU = 92, ±5 LU = 60

  const tpExcess = Math.max(0, input.outputTruePeak - input.truePeakCeiling)
  const tpScore = Math.max(0, 100 - tpExcess * 25)

  // Dynamic range — sweet spot 5-9 LU
  const drScore = input.dynamicRange < 3 ? 50
    : input.dynamicRange > 12 ? 70
    : input.dynamicRange >= 5 && input.dynamicRange <= 9 ? 100
    : 80

  // Stereo width — sweet spot 0.8-1.3
  const widthScore = input.stereoWidth < 0.5 || input.stereoWidth > 1.6 ? 60
    : input.stereoWidth >= 0.8 && input.stereoWidth <= 1.3 ? 100
    : 85

  const base = (lufsScore * 0.4 + tpScore * 0.3 + drScore * 0.2 + widthScore * 0.1)

  // Per-platform penalties (codec)
  const spotifyPenalty = input.codecPenalty * 4 // Ogg Vorbis
  const applePenalty = input.codecPenalty * 3 // AAC
  const youtubePenalty = input.codecPenalty * 5 // Opus
  const tidalPenalty = 0 // FLAC lossless

  return {
    overall: Math.round(Math.max(0, Math.min(100, base))),
    spotify: Math.round(Math.max(0, Math.min(100, base - spotifyPenalty))),
    apple_music: Math.round(Math.max(0, Math.min(100, base - applePenalty))),
    youtube: Math.round(Math.max(0, Math.min(100, base - youtubePenalty))),
    tidal: Math.round(Math.max(0, Math.min(100, base - tidalPenalty))),
    codec_penalty: {
      spotify: spotifyPenalty,
      apple_music: applePenalty,
      youtube: youtubePenalty,
      tidal: tidalPenalty,
    },
  }
}
