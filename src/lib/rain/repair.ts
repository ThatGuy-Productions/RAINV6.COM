'use client'

/**
 * RAIN V6 — Real Repair DSP Engine (P3-REPAIR)
 *
 * 8 deterministic audio restoration modules implemented entirely in TypeScript
 * against Float32Array. Every processor performs REAL DSP — no setTimeout
 * theatre, no fabricated metrics. All measurements are computed from the actual
 * processed audio.
 *
 * Modules (honest DSP names — no fake ML model claims):
 *  - denoise       : Adaptive Spectral Subtraction (STFT, soft-knee, min-stat noise floor)
 *  - spectral_gate : Per-band Dynamic Gate (adaptive per-bin threshold, soft transition)
 *  - declick       : Cubic Spline Interpolation (MAD transient detection, autocorr periodic)
 *  - decrackle     : MAD Crackler Detector (HF-band detection + overlap-add interpolation)
 *  - dehum         : Harmonic Notch Cascade (40–70 Hz autocorr fundamental + 7 harmonics)
 *  - dereverb      : RT60 Envelope Subtraction (envelope-based RT60 + late-reverb suppress)
 *  - declip        : Hermite Spline Reconstruction (clip-region detect + cubic Hermite + LPF)
 *  - resonance     : Spectral Flux Peak Suppression (peak prominence detect + narrow notch)
 *
 * Architecture:
 *  - Reusable FFTContext (cos/sin/bitrev tables, real/imag scratch buffers).
 *  - STFT/ISTFT with Hann window at 75 % overlap (COLA-normalised).
 *  - Cooperative cancellation via AbortSignal — checked between every chunk.
 *  - Yields to UI thread between heavy chunks (no main-thread blocking).
 *  - Deterministic — no Math.random, no Date.now in DSP path.
 *  - Reuses buffers — no per-frame allocations inside loops.
 *
 * The exported `runRepair` is the public entry; `measureRepairMetrics` is
 * used both internally (before/after) and by the UI for live panel display.
 */

import { applyBiquad, designBiquad, type BiquadCoef } from './dsp'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RepairModuleId =
  | 'denoise'
  | 'spectral_gate'
  | 'declick'
  | 'decrackle'
  | 'dehum'
  | 'dereverb'
  | 'declip'
  | 'resonance'

export interface RepairResult {
  moduleId: RepairModuleId
  channels: Float32Array[] // processed stereo (always >= 2 channels)
  sampleRate: number
  metrics: {
    before: Record<string, number>
    after: Record<string, number>
    improvement: Record<string, number> // per-module specific metrics + standard deltas
  }
  duration: number // wall-clock processing time in ms
}

// ---------------------------------------------------------------------------
// FFT — reusable radix-2 Cooley–Tukey (complex, in-place)
// ---------------------------------------------------------------------------

class FFTContext {
  readonly N: number
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  private readonly bitRev: Uint32Array
  real: Float32Array
  imag: Float32Array

  constructor(N: number) {
    this.N = N
    this.cos = new Float32Array(N / 2)
    this.sin = new Float32Array(N / 2)
    for (let i = 0; i < N / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / N)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / N)
    }
    this.bitRev = new Uint32Array(N)
    for (let i = 0; i < N; i++) {
      let j = 0
      let v = i
      for (let bit = N >> 1; bit; bit >>= 1) {
        j = (j << 1) | (v & 1)
        v >>= 1
      }
      this.bitRev[i] = j
    }
    this.real = new Float32Array(N)
    this.imag = new Float32Array(N)
  }

  /** Forward FFT (in-place on real/imag). */
  forward(): void {
    const { N, bitRev, cos, sin, real, imag } = this
    // Bit-reverse permutation
    for (let i = 0; i < N; i++) {
      const j = bitRev[i]
      if (j > i) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
      }
    }
    // Butterflies
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1
      const step = N / len
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < half; k++) {
          const wReal = cos[k * step]
          const wImag = sin[k * step]
          const i1 = i + k
          const i2 = i + k + half
          const r2 = real[i2]
          const im2 = imag[i2]
          const tr = r2 * wReal - im2 * wImag
          const ti = r2 * wImag + im2 * wReal
          real[i2] = real[i1] - tr
          imag[i2] = imag[i1] - ti
          real[i1] = real[i1] + tr
          imag[i1] = imag[i1] + ti
        }
      }
    }
  }

  /** Inverse FFT (in-place on real/imag, normalised by 1/N). */
  inverse(): void {
    const { N, imag } = this
    for (let i = 0; i < N; i++) imag[i] = -imag[i]
    this.forward()
    for (let i = 0; i < N; i++) {
      this.real[i] /= N
      this.imag[i] = -this.imag[i] / N
    }
  }
}

// ---------------------------------------------------------------------------
// STFT — Hann window at 75 % overlap, COLA-normalised
// ---------------------------------------------------------------------------

const FFT_SIZE = 1024
const HOP = 256 // 75 % overlap
// For Hann analysis+synthesis at 75 % overlap, sum_k w[n-kHOP]^2 = 1.5
const COLA_NORM = 1.5

const HANN = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

// Yield every N frames so the UI thread can paint + react to abort signals.
const YIELD_INTERVAL = 64

// ---------------------------------------------------------------------------
// Yield + abort helpers
// ---------------------------------------------------------------------------

function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Repair cancelled by user')
    err.name = 'CancelledError'
    throw err
  }
}

// ---------------------------------------------------------------------------
// Metrics — measured from REAL audio, never hardcoded
// ---------------------------------------------------------------------------

/**
 * Measure repair-relevant metrics from real audio channels.
 * Returns: { noiseFloorDb, dcOffsetPct, clippedSamples, sibilanceDb, rumbleDb, phaseCorrelation }
 *
 * All values are computed deterministically from the channel data:
 *  - noiseFloorDb : 20·log10(mean RMS of quietest 10 % of 50 ms blocks)
 *  - dcOffsetPct   : |mean(left)| × 100 (percentage of full-scale)
 *  - clippedSamples: count of |s| ≥ 0.999 across both channels
 *  - sibilanceDb   : average magnitude in 5–8 kHz band (dB)
 *  - rumbleDb      : average magnitude in 0–30 Hz band (dB)
 *  - phaseCorrelation: normalised L·R cross-correlation in [-1, +1]
 */
export function measureRepairMetrics(
  channels: Float32Array[],
  sampleRate: number,
): Record<string, number> {
  const empty: Record<string, number> = {
    noiseFloorDb: -120,
    dcOffsetPct: 0,
    clippedSamples: 0,
    sibilanceDb: -120,
    rumbleDb: -120,
    phaseCorrelation: 1,
  }
  if (channels.length === 0) return empty

  const left = channels[0]
  const right = channels[1] ?? channels[0]
  const n = Math.min(left.length, right.length)
  if (n === 0) return empty

  // --- DC offset (as % of full-scale) ---
  let dcSum = 0
  for (let i = 0; i < n; i++) dcSum += left[i]
  const dcOffsetPct = (Math.abs(dcSum / n)) * 100

  // --- Clipped samples (across both channels) ---
  let clippedSamples = 0
  for (let i = 0; i < n; i++) {
    if (Math.abs(left[i]) >= 0.999 || Math.abs(right[i]) >= 0.999) clippedSamples++
  }

  // --- Phase correlation (normalised dot product) ---
  let dot = 0, lE = 0, rE = 0
  for (let i = 0; i < n; i++) {
    dot += left[i] * right[i]
    lE += left[i] * left[i]
    rE += right[i] * right[i]
  }
  const denom = Math.sqrt(lE * rE)
  const phaseCorrelation = denom > 1e-12 ? dot / denom : 1

  // --- Noise floor: lowest 10 % of 50 ms RMS blocks ---
  const blockSize = Math.max(1, Math.floor(sampleRate * 0.05))
  const numBlocks = Math.floor(n / blockSize)
  if (numBlocks < 1) {
    // Very short input — compute single-block RMS
    let s = 0
    for (let i = 0; i < n; i++) s += left[i] * left[i]
    empty.noiseFloorDb = 20 * Math.log10(Math.max(Math.sqrt(s / n), 1e-7))
    empty.dcOffsetPct = dcOffsetPct
    empty.clippedSamples = clippedSamples
    empty.phaseCorrelation = phaseCorrelation
    return empty
  }
  const blockRms: number[] = new Array(numBlocks)
  for (let b = 0; b < numBlocks; b++) {
    let s = 0
    const off = b * blockSize
    for (let i = 0; i < blockSize; i++) {
      const v = left[off + i]
      s += v * v
    }
    blockRms[b] = Math.sqrt(s / blockSize)
  }
  blockRms.sort((a, b) => a - b)
  const lowestCount = Math.max(1, Math.floor(numBlocks * 0.1))
  let sum = 0
  for (let i = 0; i < lowestCount; i++) sum += blockRms[i]
  const noiseRms = sum / lowestCount
  const noiseFloorDb = 20 * Math.log10(Math.max(noiseRms, 1e-7))

  // --- Band energy via averaged FFT magnitude (8 windows, Hann-windowed) ---
  const fft = new FFTContext(FFT_SIZE)
  const spectrumMag = new Float32Array(FFT_SIZE / 2)
  const numWindows = Math.min(8, Math.max(1, Math.floor(n / FFT_SIZE)))
  for (let w = 0; w < numWindows; w++) {
    const start = Math.floor(((n - FFT_SIZE) * (w + 0.5)) / numWindows)
    for (let i = 0; i < FFT_SIZE; i++) {
      fft.real[i] = left[start + i] * HANN[i]
      fft.imag[i] = 0
    }
    fft.forward()
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const mag = Math.sqrt(fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i]) / FFT_SIZE
      spectrumMag[i] += mag
    }
  }
  for (let i = 0; i < FFT_SIZE / 2; i++) spectrumMag[i] /= numWindows

  const binHz = sampleRate / FFT_SIZE
  const bandDb = (loHz: number, hiHz: number): number => {
    const loBin = Math.max(1, Math.floor(loHz / binHz))
    const hiBin = Math.min(spectrumMag.length - 1, Math.ceil(hiHz / binHz))
    let sumB = 0, cnt = 0
    for (let b = loBin; b <= hiBin; b++) { sumB += spectrumMag[b]; cnt++ }
    const avg = cnt > 0 ? sumB / cnt : 1e-7
    return 20 * Math.log10(Math.max(avg, 1e-7))
  }

  const sibilanceDb = bandDb(5000, 8000)
  const rumbleDb = bandDb(0, 30)

  return {
    noiseFloorDb,
    dcOffsetPct,
    clippedSamples,
    sibilanceDb,
    rumbleDb,
    phaseCorrelation,
  }
}

// ---------------------------------------------------------------------------
// STFT process framework — applies analysis window, FFT, callback, IFFT, OLA
// ---------------------------------------------------------------------------

/**
 * Process a signal through STFT → modify spectrum → ISTFT with overlap-add.
 * `processFrame(real, imag, frameIdx, numFrames)` mutates the spectrum in-place.
 * Returns a new Float32Array of the same length as `input`.
 */
async function stftProcess(
  input: Float32Array,
  processFrame: (real: Float32Array, imag: Float32Array, frameIdx: number, numFrames: number) => void,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const n = input.length
  const output = new Float32Array(n)
  if (n < FFT_SIZE) {
    output.set(input)
    return output
  }

  const fft = new FFTContext(FFT_SIZE)
  const numFrames = Math.floor((n - FFT_SIZE) / HOP) + 1

  for (let f = 0; f < numFrames; f++) {
    if (f % YIELD_INTERVAL === 0) {
      checkAbort(signal)
      onProgress?.((f / numFrames) * 100)
      await yieldToUI()
    }
    const start = f * HOP
    // Window + load into FFT buffers
    for (let i = 0; i < FFT_SIZE; i++) {
      fft.real[i] = input[start + i] * HANN[i]
      fft.imag[i] = 0
    }
    fft.forward()
    processFrame(fft.real, fft.imag, f, numFrames)
    fft.inverse()
    // Synthesis window + overlap-add (COLA-normalised)
    for (let i = 0; i < FFT_SIZE; i++) {
      const outIdx = start + i
      if (outIdx < n) {
        output[outIdx] += (fft.real[i] * HANN[i]) / COLA_NORM
      }
    }
  }
  onProgress?.(100)
  return output
}

// ---------------------------------------------------------------------------
// Per-module DSP
// ---------------------------------------------------------------------------

interface ModuleOutput {
  output: Float32Array
  specific: Record<string, number> // module-specific measurements
}

// --- 1. Broadband Denoise (Adaptive Spectral Subtraction) ------------------

async function repairDenoise(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  if (n < FFT_SIZE) return { output: input.slice(), specific: { noiseFloorDeltaDb: 0 } }

  const fft = new FFTContext(FFT_SIZE)
  const numFrames = Math.floor((n - FFT_SIZE) / HOP) + 1

  // Stage 1: compute per-frame energy + per-bin magnitude storage
  const halfBins = FFT_SIZE / 2
  const frameEnergy = new Float32Array(numFrames)
  // per-frame magnitude stored column-major: mag[f * halfBins + b]
  const allMag = new Float32Array(numFrames * halfBins)

  for (let f = 0; f < numFrames; f++) {
    if (f % YIELD_INTERVAL === 0) {
      checkAbort(signal)
      onProgress?.((f / numFrames) * 40) // 0–40 % analysis
      await yieldToUI()
    }
    const start = f * HOP
    let energy = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = input[start + i] * HANN[i]
      fft.real[i] = v
      fft.imag[i] = 0
      energy += v * v
    }
    frameEnergy[f] = energy
    fft.forward()
    const off = f * halfBins
    for (let b = 0; b < halfBins; b++) {
      allMag[off + b] = Math.sqrt(fft.real[b] * fft.real[b] + fft.imag[b] * fft.imag[b])
    }
  }

  // Stage 2: identify quietest 10 % frames, compute per-bin noise floor (mean)
  const frameOrder = Array.from({ length: numFrames }, (_, i) => i)
  frameOrder.sort((a, b) => frameEnergy[a] - frameEnergy[b])
  const quietCount = Math.max(1, Math.floor(numFrames * 0.1))
  const noiseMag = new Float32Array(halfBins)
  for (let b = 0; b < halfBins; b++) {
    let s = 0
    for (let q = 0; q < quietCount; q++) {
      s += allMag[frameOrder[q] * halfBins + b]
    }
    noiseMag[b] = s / quietCount
  }

  // Noise floor estimate (overall) — for reporting
  let noisePow = 0
  for (let b = 0; b < halfBins; b++) noisePow += noiseMag[b] * noiseMag[b]
  const noiseFloorBeforeDb = 10 * Math.log10(Math.max(1e-12, noisePow / (halfBins * FFT_SIZE * FFT_SIZE)))

  // Stage 3: spectral subtraction with soft knee
  // intensity 0..10 → alpha 1..4, oversub 1..5, floor 0.5..0.05
  const t = Math.max(0, Math.min(10, intensity)) / 10
  const alpha = 1.0 + t * 3.0
  const oversub = 1.0 + t * 4.0
  const floor = 0.5 - t * 0.45 // never below 0.05

  const output = await stftProcess(
    input,
    (real, imag) => {
      for (let b = 0; b < halfBins; b++) {
        const re = real[b]
        const im = imag[b]
        const mag = Math.sqrt(re * re + im * im)
        if (mag < 1e-10) {
          // Near-zero bin — attenuate to floor
          real[b] *= floor
          imag[b] *= floor
          const m = FFT_SIZE - b
          if (m < FFT_SIZE && m !== b) {
            real[m] *= floor
            imag[m] *= floor
          }
          continue
        }
        const noise = noiseMag[b] * oversub
        const ratio = noise / mag
        let gain: number
        if (ratio >= 1) {
          gain = floor
        } else {
          // Soft-knee spectral subtraction: 1 - ratio^alpha, floored
          gain = Math.max(floor, 1 - Math.pow(ratio, alpha))
        }
        real[b] = re * gain
        imag[b] = im * gain
        // Mirror bin (preserve Hermitian symmetry for real IFFT)
        const m = FFT_SIZE - b
        if (m < FFT_SIZE && m !== b) {
          real[m] = real[b]
          imag[m] = -imag[b]
        }
      }
    },
    (pct) => onProgress?.(40 + pct * 0.6), // 40–100 % processing
    signal,
  )

  // Measure post-denoise noise floor (quietest 10 % RMS)
  let postNoise = 0
  const blockSize = Math.max(1, Math.floor(sampleRate * 0.05))
  const numBlocks = Math.floor(n / blockSize)
  if (numBlocks > 0) {
    const blockRms: number[] = new Array(numBlocks)
    for (let b = 0; b < numBlocks; b++) {
      let s = 0
      const off = b * blockSize
      for (let i = 0; i < blockSize; i++) {
        const v = output[off + i]
        s += v * v
      }
      blockRms[b] = Math.sqrt(s / blockSize)
    }
    blockRms.sort((a, b) => a - b)
    const lowCt = Math.max(1, Math.floor(numBlocks * 0.1))
    let s = 0
    for (let i = 0; i < lowCt; i++) s += blockRms[i]
    postNoise = s / lowCt
  }
  const noiseFloorAfterDb = 20 * Math.log10(Math.max(postNoise, 1e-7))

  return {
    output,
    specific: {
      noiseFloorBeforeDb,
      noiseFloorAfterDb,
      noiseFloorDeltaDb: noiseFloorBeforeDb - noiseFloorAfterDb,
      quietFramesAnalyzed: quietCount,
      oversubtractionFactor: oversub,
    },
  }
}

// --- 2. Adaptive Spectral Gate (Per-band Dynamic Gate) ---------------------

async function repairSpectralGate(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  if (n < FFT_SIZE) return { output: input.slice(), specific: { avgGateAttenDb: 0 } }

  const fft = new FFTContext(FFT_SIZE)
  const halfBins = FFT_SIZE / 2
  const numFrames = Math.floor((n - FFT_SIZE) / HOP) + 1

  // Stage 1: per-bin noise floor = mean of quietest 25 % of frames per bin
  // (slightly more inclusive than denoise for a smoother gate threshold)
  const frameEnergy = new Float32Array(numFrames)
  const allMag = new Float32Array(numFrames * halfBins)

  for (let f = 0; f < numFrames; f++) {
    if (f % YIELD_INTERVAL === 0) {
      checkAbort(signal)
      onProgress?.((f / numFrames) * 40)
      await yieldToUI()
    }
    const start = f * HOP
    let energy = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = input[start + i] * HANN[i]
      fft.real[i] = v
      fft.imag[i] = 0
      energy += v * v
    }
    frameEnergy[f] = energy
    fft.forward()
    const off = f * halfBins
    for (let b = 0; b < halfBins; b++) {
      allMag[off + b] = Math.sqrt(fft.real[b] * fft.real[b] + fft.imag[b] * fft.imag[b])
    }
  }

  const frameOrder = Array.from({ length: numFrames }, (_, i) => i)
  frameOrder.sort((a, b) => frameEnergy[a] - frameEnergy[b])
  const quietCount = Math.max(1, Math.floor(numFrames * 0.25))
  const noiseMag = new Float32Array(halfBins)
  for (let b = 0; b < halfBins; b++) {
    let s = 0
    for (let q = 0; q < quietCount; q++) {
      s += allMag[frameOrder[q] * halfBins + b]
    }
    noiseMag[b] = s / quietCount
  }

  // Gate parameters from intensity
  const t = Math.max(0, Math.min(10, intensity)) / 10
  const margin = 6 + t * 18 // 6–24 dB above noise floor
  const slope = 2 + t * 4   // soft gate steepness
  const marginLin = Math.pow(10, margin / 20)

  // Track total attenuation applied (for reporting)
  let totalAttenDb = 0
  let attenCount = 0

  const output = await stftProcess(
    input,
    (real, imag) => {
      for (let b = 0; b < halfBins; b++) {
        const re = real[b]
        const im = imag[b]
        const mag = Math.sqrt(re * re + im * im)
        const threshold = noiseMag[b] * marginLin
        if (mag < 1e-10) {
          real[b] = 0
          imag[b] = 0
          const m = FFT_SIZE - b
          if (m < FFT_SIZE && m !== b) {
            real[m] = 0
            imag[m] = 0
          }
          totalAttenDb += 60
          attenCount++
          continue
        }
        // Soft gate: gain = mag^slope / (mag^slope + threshold^slope)
        // - mag >> threshold → gain ≈ 1
        // - mag << threshold → gain ≈ 0
        // - mag == threshold → gain = 0.5
        const mPow = Math.pow(mag, slope)
        const tPow = Math.pow(threshold, slope)
        const gain = mPow / (mPow + tPow)
        const attenDb = -20 * Math.log10(Math.max(gain, 1e-6))
        totalAttenDb += attenDb
        attenCount++
        real[b] = re * gain
        imag[b] = im * gain
        const m = FFT_SIZE - b
        if (m < FFT_SIZE && m !== b) {
          real[m] = real[b]
          imag[m] = -imag[b]
        }
      }
    },
    (pct) => onProgress?.(40 + pct * 0.6),
    signal,
  )

  const avgGateAttenDb = attenCount > 0 ? totalAttenDb / attenCount : 0

  return {
    output,
    specific: {
      avgGateAttenDb,
      thresholdMarginDb: margin,
      quietFramesAnalyzed: quietCount,
    },
  }
}

// --- 3. De-click (Cubic Spline Interpolation) ------------------------------

async function repairDeclick(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  const output = input.slice()
  if (n < 4) return { output, specific: { clicksDetected: 0, clicksRepaired: 0 } }

  // Stage 1: compute first differences and their MAD
  const diffs = new Float32Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    diffs[i] = Math.abs(input[i + 1] - input[i])
  }
  // Median of diffs (via sort — O(n log n), fine for typical repair sizes)
  const sortedDiffs = Array.from(diffs).sort((a, b) => a - b)
  const median = sortedDiffs[Math.floor(sortedDiffs.length / 2)]
  // MAD = median of |diff - median|
  let madSum = 0
  const absDevs = new Float32Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    absDevs[i] = Math.abs(diffs[i] - median)
  }
  const sortedAbs = Array.from(absDevs).sort((a, b) => a - b)
  const mad = sortedAbs[Math.floor(sortedAbs.length / 2)] || 1e-7

  // Detection threshold: median + k * MAD, k from intensity
  const t = Math.max(0, Math.min(10, intensity)) / 10
  const k = 8 - t * 4 // 8 (gentle) → 4 (aggressive)
  const threshold = median + k * mad * 8 // scale up — MAD of first-diffs is small

  // Stage 2: detect clicks (single-sample or short bursts)
  const isClick = new Uint8Array(n)
  let clicksDetected = 0
  for (let i = 1; i < n; i++) {
    if (diffs[i - 1] > threshold) {
      // Mark both endpoints of the large diff as potentially clicked
      // Determine which one is the outlier by comparing to local trend
      const prev = input[i - 1]
      const cur = input[i]
      // If the jump is large but the surrounding context is smooth, mark the
      // sample that deviates more from its other neighbor.
      if (i >= 2 && i < n - 1) {
        const trendPrev = input[i - 2]
        const trendNext = input[i + 1]
        const devPrev = Math.abs(prev - trendPrev)
        const devCur = Math.abs(cur - trendNext)
        if (devCur > devPrev) {
          isClick[i] = 1
        } else {
          isClick[i - 1] = 1
        }
      } else {
        isClick[i] = 1
      }
      clicksDetected++
    }
  }

  // Stage 3: periodic click detection (vinyl) via autocorrelation
  // Downsample to 1 kHz, scan lag range 100Hz..1kHz (1ms..10ms period)
  const dsRate = 1000
  const ratio = sampleRate / dsRate
  const dsLen = Math.floor(n / ratio)
  if (dsLen > 100) {
    const ds = new Float32Array(dsLen)
    for (let i = 0; i < dsLen; i++) ds[i] = input[Math.floor(i * ratio)]
    // Autocorr in lag range [10, 100] (100Hz..1kHz periodicity)
    let bestLag = 0
    let bestCorr = 0
    for (let lag = 10; lag <= 100 && lag < dsLen / 2; lag++) {
      let c = 0
      for (let i = 0; i + lag < dsLen; i++) c += ds[i] * ds[i + lag]
      if (c > bestCorr) {
        bestCorr = c
        bestLag = lag
      }
    }
    // If a strong periodicity is found, also flag samples matching that period
    // (light touch — only if correlation is significant relative to energy)
    let energy = 0
    for (let i = 0; i < dsLen; i++) energy += ds[i] * ds[i]
    if (bestLag > 0 && bestCorr > energy * 0.05) {
      const periodSamples = Math.floor(bestLag * ratio)
      // Find the phase with maximum click energy
      let bestPhase = 0
      let bestPhaseEnergy = 0
      for (let phase = 0; phase < periodSamples && phase < n; phase++) {
        let e = 0
        let count = 0
        for (let pos = phase; pos < n; pos += periodSamples) {
          if (pos > 0 && diffs[pos - 1] > threshold) { e += diffs[pos - 1]; count++ }
        }
        if (count > 0 && e / count > bestPhaseEnergy) {
          bestPhaseEnergy = e / count
          bestPhase = phase
        }
      }
      // Mark periodic clicks if they exceed threshold
      if (bestPhaseEnergy > 0) {
        for (let pos = bestPhase; pos < n; pos += periodSamples) {
          if (pos > 0 && diffs[pos - 1] > threshold * 0.7) {
            if (!isClick[pos]) {
              isClick[pos] = 1
              clicksDetected++
            }
          }
        }
      }
    }
  }

  // Stage 4: group consecutive clicks into regions and repair with cubic Hermite
  let clicksRepaired = 0
  let i = 0
  const chunkSize = Math.max(1, Math.floor(n / 50)) // yield ~50 times
  while (i < n) {
    if (i % chunkSize === 0) {
      checkAbort(signal)
      onProgress?.((i / n) * 100)
      await yieldToUI()
    }
    if (!isClick[i]) { i++; continue }
    // Find end of click region
    let j = i
    while (j < n && isClick[j]) j++
    // Region [i, j-1] needs repair
    const regionLen = j - i
    // Boundary samples (must be clean)
    const leftIdx = i - 1
    const rightIdx = j
    if (leftIdx >= 0 && rightIdx < n) {
      const x0 = output[leftIdx]
      const x1 = output[rightIdx]
      const xPrev = leftIdx >= 1 ? output[leftIdx - 1] : x0
      const xNext = rightIdx < n - 1 ? output[rightIdx + 1] : x1
      // Slope estimates (centered differences)
      const m0 = x0 - xPrev
      const m1 = xNext - x1
      // Cubic Hermite interpolation across [0, 1] spanning (regionLen + 1) intervals
      const span = regionLen + 1
      for (let k = 0; k < regionLen; k++) {
        const t = (k + 1) / span
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        output[i + k] = h00 * x0 + h10 * m0 + h01 * x1 + h11 * m1
      }
      clicksRepaired += regionLen
    }
    i = j
  }

  // Stage 5: gentle lowpass on repaired regions to suppress any spline ringing
  // (3-tap moving average applied only to repaired samples)
  const repairMask = isClick
  const smoothed = output.slice()
  for (let idx = 1; idx < n - 1; idx++) {
    if (repairMask[idx]) {
      smoothed[idx] = (output[idx - 1] + output[idx] * 2 + output[idx + 1]) / 4
    }
  }
  smoothed.forEach((v, idx) => { output[idx] = v })

  onProgress?.(100)
  return {
    output,
    specific: {
      clicksDetected,
      clicksRepaired,
      detectionThreshold: threshold,
      medianDiff: median,
      madDiff: mad,
    },
  }
}

// --- 4. De-crackle (MAD Crackler Detector) ---------------------------------

async function repairDecrackle(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  if (n < FFT_SIZE) return { output: input.slice(), specific: { cracklesRemoved: 0 } }

  const t = Math.max(0, Math.min(10, intensity)) / 10

  // Stage 1: isolate HF band via 5 kHz HPF
  const hpf: BiquadCoef = designBiquad('highpass', 5000, sampleRate, 0.7071)
  const hf = input.slice()
  applyBiquad(hf, hpf, { x1: 0, x2: 0, y1: 0, y2: 0 })

  // Stage 2: MAD-based crackle detection on HF signal
  // Compute |hf| and its MAD
  const absHf = new Float32Array(n)
  for (let i = 0; i < n; i++) absHf[i] = Math.abs(hf[i])
  const sortedAbs = Array.from(absHf).sort((a, b) => a - b)
  const median = sortedAbs[Math.floor(sortedAbs.length / 2)]
  const absDevs = new Float32Array(n)
  for (let i = 0; i < n; i++) absDevs[i] = Math.abs(absHf[i] - median)
  const sortedDevs = Array.from(absDevs).sort((a, b) => a - b)
  const mad = sortedDevs[Math.floor(sortedDevs.length / 2)] || 1e-7

  // Crackles: short (1-3 sample) bursts where |hf| > median + k * MAD
  // k from intensity (lower k = more sensitive)
  const k = 6 - t * 3 // 6 (gentle) → 3 (aggressive)
  const threshold = median + k * mad

  const isCrackle = new Uint8Array(n)
  let cracklesDetected = 0
  for (let i = 0; i < n; i++) {
    if (absHf[i] > threshold) {
      isCrackle[i] = 1
      cracklesDetected++
    }
  }

  // Stage 3: overlap-add interpolation — replace cracked samples with
  // cubic Hermite from neighboring clean samples.
  const output = input.slice()
  let cracklesRemoved = 0
  const chunkSize = Math.max(1, Math.floor(n / 50))
  let i = 0
  while (i < n) {
    if (i % chunkSize === 0) {
      checkAbort(signal)
      onProgress?.((i / n) * 100)
      await yieldToUI()
    }
    if (!isCrackle[i]) { i++; continue }
    let j = i
    while (j < n && isCrackle[j]) j++
    // Cap region length to 8 samples (longer = probably not crackle)
    const regionLen = j - i
    if (regionLen <= 8) {
      const leftIdx = i - 1
      const rightIdx = j
      if (leftIdx >= 0 && rightIdx < n) {
        const x0 = output[leftIdx]
        const x1 = output[rightIdx]
        const xPrev = leftIdx >= 1 ? output[leftIdx - 1] : x0
        const xNext = rightIdx < n - 1 ? output[rightIdx + 1] : x1
        const m0 = x0 - xPrev
        const m1 = xNext - x1
        const span = regionLen + 1
        for (let k = 0; k < regionLen; k++) {
          const tt = (k + 1) / span
          const t2 = tt * tt
          const t3 = t2 * tt
          const h00 = 2 * t3 - 3 * t2 + 1
          const h10 = t3 - 2 * t2 + tt
          const h01 = -2 * t3 + 3 * t2
          const h11 = t3 - t2
          output[i + k] = h00 * x0 + h10 * m0 + h01 * x1 + h11 * m1
        }
        cracklesRemoved += regionLen
      }
    }
    i = j
  }

  onProgress?.(100)
  return {
    output,
    specific: {
      cracklesDetected,
      cracklesRemoved,
      detectionThreshold: threshold,
      hfMad: mad,
    },
  }
}

// --- 5. De-hum (Harmonic Notch Cascade) ------------------------------------

async function repairDehum(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  const output = input.slice()
  if (n < sampleRate) {
    return { output, specific: { humFrequencyHz: 0, harmonicsNotched: 0 } }
  }

  const t = Math.max(0, Math.min(10, intensity)) / 10

  // Stage 1: detect fundamental via downsampled autocorrelation in 40–70 Hz
  const dsRate = 1000
  const ratio = sampleRate / dsRate
  const dsLen = Math.floor(n / ratio)
  const ds = new Float32Array(dsLen)
  for (let i = 0; i < dsLen; i++) ds[i] = input[Math.floor(i * ratio)]

  const minLag = Math.floor(dsRate / 70) // ~14
  const maxLag = Math.ceil(dsRate / 40)  // ~25
  let bestLag = 0
  let bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag && lag < dsLen / 2; lag++) {
    let c = 0
    for (let i = 0; i + lag < dsLen; i++) c += ds[i] * ds[i + lag]
    if (c > bestCorr) { bestCorr = c; bestLag = lag }
  }
  const humFrequencyHz = bestLag > 0 ? dsRate / bestLag : 0

  // If no clear hum found, fall back to scanning both 50 and 60 Hz candidates
  let fundamental = humFrequencyHz
  if (fundamental < 45 || fundamental > 65) {
    // Try 50 and 60 Hz directly via Goertzel
    const pow50 = goertzelPower(input, 50, sampleRate)
    const pow60 = goertzelPower(input, 60, sampleRate)
    fundamental = pow60 > pow50 * 1.2 ? 60 : 50
  }

  onProgress?.(30)
  await yieldToUI()
  checkAbort(signal)

  // Stage 2: apply peak-notches at fundamental + 7 harmonics
  // Each notch: peak biquad with gain=-12 dB, Q=30 (narrow dip).
  // Depth controlled by intensity (more intensity = deeper).
  const depthDb = -(6 + t * 9) // -6 to -15 dB
  const Q = 30
  const numHarmonics = 8
  let harmonicsNotched = 0
  for (let h = 1; h <= numHarmonics; h++) {
    const freq = fundamental * h
    if (freq >= sampleRate / 2 - 100) break
    const coef = designBiquad('peak', freq, sampleRate, Q, depthDb)
    applyBiquad(output, coef, { x1: 0, x2: 0, y1: 0, y2: 0 })
    harmonicsNotched++
    if (h % 2 === 0) {
      onProgress?.(30 + (h / numHarmonics) * 70)
      await yieldToUI()
      checkAbort(signal)
    }
  }

  // Measure fundamental attenuation: power at fundamental before vs after
  const powBefore = goertzelPower(input, fundamental, sampleRate)
  const powAfter = goertzelPower(output, fundamental, sampleRate)
  const fundamentalAttenDb = powAfter > 1e-12 && powBefore > 1e-12
    ? 10 * Math.log10(powBefore / Math.max(powAfter, 1e-12))
    : 0

  onProgress?.(100)
  return {
    output,
    specific: {
      humFrequencyHz: fundamental,
      harmonicsNotched,
      fundamentalAttenDb,
      notchDepthDb: depthDb,
    },
  }
}

// Goertzel single-bin power
function goertzelPower(samples: Float32Array, freq: number, sampleRate: number): number {
  const k = (2 * Math.PI * freq) / sampleRate
  const cosK = Math.cos(k)
  const coeff = 2 * cosK
  let s1 = 0, s2 = 0
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

// --- 6. De-reverb (RT60 Envelope Subtraction) ------------------------------

async function repairDereverb(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  if (n < sampleRate) {
    return { output: input.slice(), specific: { rt60BeforeMs: 0, rt60AfterMs: 0 } }
  }

  const t = Math.max(0, Math.min(10, intensity)) / 10

  // Stage 1: estimate RT60 from reverse-integrated energy decay
  // Compute energy envelope in 50 ms blocks, then reverse-cumsum the energy.
  const blockSize = Math.max(1, Math.floor(sampleRate * 0.05))
  const numBlocks = Math.floor(n / blockSize)
  const blockEnergy = new Float32Array(numBlocks)
  for (let b = 0; b < numBlocks; b++) {
    let s = 0
    const off = b * blockSize
    for (let i = 0; i < blockSize; i++) {
      const v = input[off + i]
      s += v * v
    }
    blockEnergy[b] = s / blockSize
  }

  // Reverse-integrated energy: R[b] = sum_{k>=b} blockEnergy[k]
  // Decay curve in dB: 10*log10(R[b] / R[0])
  // RT60 = time for decay to drop 60 dB (linear fit in dB domain)
  const reverseInteg = new Float32Array(numBlocks)
  reverseInteg[numBlocks - 1] = blockEnergy[numBlocks - 1]
  for (let b = numBlocks - 2; b >= 0; b--) {
    reverseInteg[b] = reverseInteg[b + 1] + blockEnergy[b]
  }
  // Convert to dB and linear-fit the decay slope
  // Find the range where decay is monotonic (from peak to -60 dB)
  const peakEnergy = reverseInteg[0]
  const targetEnergy = peakEnergy * 1e-6 // -60 dB
  let decayEndBlock = numBlocks - 1
  for (let b = 0; b < numBlocks; b++) {
    if (reverseInteg[b] <= targetEnergy) {
      decayEndBlock = b
      break
    }
  }
  // Linear fit: dB vs block index, slope = dB per block
  // RT60 = -60 / slope (in blocks), then × blockDuration
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, count = 0
  for (let b = 0; b <= decayEndBlock && b < numBlocks; b++) {
    if (reverseInteg[b] <= 0) continue
    const x = b
    const y = 10 * Math.log10(reverseInteg[b])
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; count++
  }
  let rt60BeforeMs = 0
  if (count > 2) {
    const denom = (count * sumX2 - sumX * sumX)
    if (Math.abs(denom) > 1e-12) {
      const slope = (count * sumXY - sumX * sumY) / denom // dB per block
      if (slope < -0.01) {
        const rt60Blocks = -60 / slope
        const rt60MsUncapped = rt60Blocks * (blockSize / sampleRate) * 1000
        // Cap at 10 s — anything beyond means the signal has no real decay
        // tail (steady-state tone, sustained noise, etc.) so RT60 is
        // effectively undefined. Reporting 0 is more honest than reporting
        // a 140-second extrapolation.
        rt60BeforeMs = Math.min(10_000, Math.max(0, rt60MsUncapped))
      }
    }
  }

  onProgress?.(30)
  await yieldToUI()
  checkAbort(signal)

  // Stage 2: time-varying late-reverb suppression
  // Compute envelope, normalize by peak, apply gain = (env/peak)^k where k
  // controls suppression strength. Higher k = more aggressive.
  // Late reverb (low env relative to peak) gets attenuated more.
  // Compute envelope per-sample via block RMS interpolation.
  const envGain = new Float32Array(n)
  const kPow = 1 + t * 4 // 1..5
  // Find peak envelope (95th percentile to be robust to transients)
  const sortedEnv = Array.from(blockEnergy).sort((a, b) => a - b)
  const peakEnv = sortedEnv[Math.floor(sortedEnv.length * 0.95)] || 1e-7

  // Per-sample envelope (linearly interpolated block RMS)
  // Then gain = max(floor, (env / peakEnv)^k)
  const floor = 0.05 - t * 0.04 // 0.05 to 0.01
  for (let b = 0; b < numBlocks; b++) {
    const normEnv = Math.min(1, blockEnergy[b] / peakEnv)
    const gain = Math.max(floor, Math.pow(normEnv, kPow))
    const off = b * blockSize
    for (let i = 0; i < blockSize && off + i < n; i++) {
      envGain[off + i] = gain
    }
  }
  // Tail beyond numBlocks*blockSize gets floor gain
  for (let i = numBlocks * blockSize; i < n; i++) envGain[i] = floor

  // Apply gain (smoothed to avoid clicks)
  const output = new Float32Array(n)
  let smoothedGain = 1
  const smoothCoef = Math.exp(-1 / (0.02 * sampleRate)) // 20 ms time constant
  const chunkSize = Math.max(1, Math.floor(n / 50))
  for (let i = 0; i < n; i++) {
    if (i % chunkSize === 0) {
      checkAbort(signal)
      onProgress?.(30 + (i / n) * 70)
      await yieldToUI()
    }
    const target = envGain[i]
    smoothedGain = smoothedGain * smoothCoef + target * (1 - smoothCoef)
    output[i] = input[i] * smoothedGain
  }

  // Measure RT60 after
  let rt60AfterMs = 0
  {
    const be2 = new Float32Array(numBlocks)
    for (let b = 0; b < numBlocks; b++) {
      let s = 0
      const off = b * blockSize
      for (let i = 0; i < blockSize; i++) {
        const v = output[off + i]
        s += v * v
      }
      be2[b] = s / blockSize
    }
    const ri2 = new Float32Array(numBlocks)
    ri2[numBlocks - 1] = be2[numBlocks - 1]
    for (let b = numBlocks - 2; b >= 0; b--) ri2[b] = ri2[b + 1] + be2[b]
    const peak2 = ri2[0]
    const tgt2 = peak2 * 1e-6
    let de2 = numBlocks - 1
    for (let b = 0; b < numBlocks; b++) {
      if (ri2[b] <= tgt2) { de2 = b; break }
    }
    let sx = 0, sy = 0, sxy = 0, sx2 = 0, ct = 0
    for (let b = 0; b <= de2 && b < numBlocks; b++) {
      if (ri2[b] <= 0) continue
      const x = b
      const y = 10 * Math.log10(ri2[b])
      sx += x; sy += y; sxy += x * y; sx2 += x * x; ct++
    }
    if (ct > 2) {
      const dn = (ct * sx2 - sx * sx)
      if (Math.abs(dn) > 1e-12) {
        const slope = (ct * sxy - sx * sy) / dn
        if (slope < -0.01) {
          const rt60MsUncapped = (-60 / slope) * (blockSize / sampleRate) * 1000
          rt60AfterMs = Math.min(10_000, Math.max(0, rt60MsUncapped))
        }
      }
    }
  }

  // Late-reverb energy reduction: measure the RMS of the quietest 30 % of
  // 50 ms blocks before vs after. Late reverb lives in these quiet regions
  // (between transients), so the RMS reduction there directly measures how
  // much late-reverb energy the suppressor removed. This is meaningful even
  // for steady-state signals where RT60 is undefined.
  const computeQuietRms = (buf: Float32Array): number => {
    const bs = Math.max(1, Math.floor(sampleRate * 0.05))
    const nb = Math.floor(buf.length / bs)
    if (nb < 1) return 0
    const rmsArr: number[] = new Array(nb)
    for (let b = 0; b < nb; b++) {
      let s = 0
      const off = b * bs
      for (let i = 0; i < bs; i++) {
        const v = buf[off + i]
        s += v * v
      }
      rmsArr[b] = Math.sqrt(s / bs)
    }
    rmsArr.sort((a, b) => a - b)
    const low = Math.max(1, Math.floor(nb * 0.3))
    let s = 0
    for (let i = 0; i < low; i++) s += rmsArr[i]
    return s / low
  }
  const quietRmsBefore = computeQuietRms(input)
  const quietRmsAfter = computeQuietRms(output)
  const lateReverbReductionDb = quietRmsBefore > 1e-7 && quietRmsAfter > 1e-7
    ? 20 * Math.log10(quietRmsBefore / Math.max(quietRmsAfter, 1e-7))
    : 0

  onProgress?.(100)
  return {
    output,
    specific: {
      rt60BeforeMs,
      rt60AfterMs,
      rt60DeltaMs: rt60BeforeMs - rt60AfterMs,
      lateReverbReductionDb,
      suppressionStrength: kPow,
    },
  }
}

// --- 7. Clipping Reconstruction (Hermite Spline) ---------------------------

async function repairDeclip(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  const output = input.slice()
  if (n < 4) return { output, specific: { clippedSamplesDetected: 0, clippedSamplesRepaired: 0 } }

  const t = Math.max(0, Math.min(10, intensity)) / 10
  // Detection threshold: 0.999 default, lower with intensity (more aggressive)
  const clipThreshold = 0.999 - t * 0.05 // 0.999 → 0.949

  // Stage 1: detect clipped samples (|s| >= threshold)
  const isClipped = new Uint8Array(n)
  let clippedSamplesDetected = 0
  for (let i = 0; i < n; i++) {
    if (Math.abs(input[i]) >= clipThreshold) {
      isClipped[i] = 1
      clippedSamplesDetected++
    }
  }

  // Stage 2: group into regions and reconstruct with cubic Hermite spline
  let clippedSamplesRepaired = 0
  const chunkSize = Math.max(1, Math.floor(n / 50))
  let i = 0
  while (i < n) {
    if (i % chunkSize === 0) {
      checkAbort(signal)
      onProgress?.((i / n) * 80)
      await yieldToUI()
    }
    if (!isClipped[i]) { i++; continue }
    let j = i
    while (j < n && isClipped[j]) j++
    // Region [i, j-1]
    const regionLen = j - i
    // Need clean boundaries — expand left/right to find non-clipped samples
    let leftIdx = i - 1
    while (leftIdx > 0 && isClipped[leftIdx]) leftIdx--
    let rightIdx = j
    while (rightIdx < n - 1 && isClipped[rightIdx]) rightIdx++
    if (leftIdx >= 0 && rightIdx < n && regionLen <= sampleRate * 0.05) {
      // Cap to 50 ms regions (longer = probably not clipping)
      const x0 = output[leftIdx]
      const x1 = output[rightIdx]
      const xPrev = leftIdx >= 1 ? output[leftIdx - 1] : x0
      const xNext = rightIdx < n - 1 ? output[rightIdx + 1] : x1
      const m0 = x0 - xPrev
      const m1 = xNext - x1
      // Interpolate from leftIdx (t=0) to rightIdx (t=1)
      const span = rightIdx - leftIdx
      for (let k = 1; k < span; k++) {
        const tt = k / span
        const t2 = tt * tt
        const t3 = t2 * tt
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + tt
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        output[leftIdx + k] = h00 * x0 + h10 * m0 + h01 * x1 + h11 * m1
      }
      clippedSamplesRepaired += regionLen
    }
    i = j
  }

  // Stage 3: gentle lowpass on reconstructed regions (5-tap moving average)
  // to suppress any spline ringing
  const tmp = output.slice()
  for (let idx = 2; idx < n - 2; idx++) {
    if (isClipped[idx]) {
      output[idx] =
        (tmp[idx - 2] * 0.1 +
         tmp[idx - 1] * 0.2 +
         tmp[idx] * 0.4 +
         tmp[idx + 1] * 0.2 +
         tmp[idx + 2] * 0.1)
    }
  }

  // Measure peak before/after
  let peakBefore = 0, peakAfter = 0
  for (let idx = 0; idx < n; idx++) {
    const a = Math.abs(input[idx]); if (a > peakBefore) peakBefore = a
    const b = Math.abs(output[idx]); if (b > peakAfter) peakAfter = b
  }

  onProgress?.(100)
  return {
    output,
    specific: {
      clippedSamplesDetected,
      clippedSamplesRepaired,
      clipThreshold,
      peakBeforeDb: 20 * Math.log10(Math.max(peakBefore, 1e-7)),
      peakAfterDb: 20 * Math.log10(Math.max(peakAfter, 1e-7)),
    },
  }
}

// --- 8. Resonance Suppression (Spectral Flux Peak Suppression) -------------

async function repairResonance(
  input: Float32Array,
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ModuleOutput> {
  const n = input.length
  const output = input.slice()
  if (n < FFT_SIZE) return { output, specific: { resonancePeaksDetected: 0, resonancePeaksSuppressed: 0 } }

  const t = Math.max(0, Math.min(10, intensity)) / 10
  const halfBins = FFT_SIZE / 2

  // Stage 1: compute averaged magnitude spectrum (8 windows)
  const fft = new FFTContext(FFT_SIZE)
  const avgMag = new Float32Array(halfBins)
  const numWindows = Math.min(8, Math.max(1, Math.floor(n / FFT_SIZE)))
  for (let w = 0; w < numWindows; w++) {
    const start = Math.floor(((n - FFT_SIZE) * (w + 0.5)) / numWindows)
    for (let i = 0; i < FFT_SIZE; i++) {
      fft.real[i] = input[start + i] * HANN[i]
      fft.imag[i] = 0
    }
    fft.forward()
    for (let b = 0; b < halfBins; b++) {
      avgMag[b] += Math.sqrt(fft.real[b] * fft.real[b] + fft.imag[b] * fft.imag[b]) / FFT_SIZE
    }
  }
  for (let b = 0; b < halfBins; b++) avgMag[b] /= numWindows

  onProgress?.(30)
  await yieldToUI()
  checkAbort(signal)

  // Stage 2: detect peaks via dB-relative local prominence.
  //
  // FFT main-lobe width for a Hann window is ~4 bins, so a tone that falls
  // on a non-integer bin leaks into its ±2 neighbors. To detect resonance
  // peaks robustly we use a two-zone test:
  //
  //   INNER zone (±2 bins): the candidate must be the strict local max —
  //   i.e., greater than every bin in [b-2 .. b+2] except itself. This
  //   ensures the candidate sits at the apex of the main lobe, not on
  //   its shoulder.
  //
  //   OUTER zone (±3..±5 bins): outside the main lobe, so the bins here
  //   reflect the SPECTRAL FLOOR near the peak. The candidate's prominence
  //   over the maximum of the outer-zone bins must be ≥ prominenceDb.
  //
  // This is robust to overall signal amplitude AND to FFT bin alignment —
  // a 0.05-amplitude 2 kHz tone at bin 42.67 is detected just as reliably
  // as a 0.5-amplitude tone at an integer bin.
  const peaks: Array<{ bin: number; freq: number; prominence: number; prominenceDb: number }> = []
  const prominenceDb = 6 + t * 6 // 6 dB (gentle) → 12 dB (aggressive)
  const floorRatioDb = 3 + t * 3 // peak must also be ≥ floorRatioDb above local floor
  const innerHalf = 2
  const outerHalf = 5
  for (let b = outerHalf + 1; b < halfBins - outerHalf - 1; b++) {
    // (1) strict local max in ±innerHalf window (apex of main lobe)
    let isApex = true
    for (let k = -innerHalf; k <= innerHalf; k++) {
      if (k === 0) continue
      if (avgMag[b + k] >= avgMag[b]) { isApex = false; break }
    }
    if (!isApex) continue
    // (2) prominence over the outer zone (outside main lobe)
    let outerMax = 0
    for (let k = -outerHalf; k <= outerHalf; k++) {
      if (k >= -innerHalf && k <= innerHalf) continue // skip inner zone
      if (avgMag[b + k] > outerMax) outerMax = avgMag[b + k]
    }
    const promDb = outerMax > 1e-12
      ? 20 * Math.log10(avgMag[b] / outerMax)
      : 240
    if (promDb < prominenceDb) continue
    // (3) peak must be ≥ floorRatioDb above the outer-zone floor (min)
    let outerMin = Infinity
    for (let k = -outerHalf; k <= outerHalf; k++) {
      if (k >= -innerHalf && k <= innerHalf) continue
      if (avgMag[b + k] < outerMin) outerMin = avgMag[b + k]
    }
    const floorDb = outerMin > 1e-12
      ? 20 * Math.log10(avgMag[b] / outerMin)
      : 240
    if (floorDb < floorRatioDb) continue
    const binHz = sampleRate / FFT_SIZE
    peaks.push({
      bin: b,
      freq: b * binHz,
      prominence: avgMag[b] - outerMax, // linear (kept for backwards-compat)
      prominenceDb: promDb,
    })
  }
  // Sort by dB prominence descending, take top 8
  peaks.sort((a, b) => b.prominenceDb - a.prominenceDb)
  const topPeaks = peaks.slice(0, 8)

  onProgress?.(50)
  await yieldToUI()
  checkAbort(signal)

  // Stage 3: apply narrow notches at detected resonance frequencies
  // Use peak biquad with negative gain, Q=10 (narrow dip).
  // Depth controlled by intensity — but no deeper than the measured peak
  // prominence above the floor (so we never dig below the spectral floor
  // and create a notch artifact).
  const notchQ = 10
  const maxDepthDb = 6 + t * 9 // 6 to 15 dB
  let resonancePeaksSuppressed = 0
  let totalDepthAppliedDb = 0
  for (const peak of topPeaks) {
    if (peak.freq >= sampleRate / 2 - 100 || peak.freq < 20) continue
    // Don't notch deeper than the peak's own prominence (would create a hole)
    const depthDb = -Math.min(maxDepthDb, Math.max(1, peak.prominenceDb - 1))
    const coef = designBiquad('peak', peak.freq, sampleRate, notchQ, depthDb)
    applyBiquad(output, coef, { x1: 0, x2: 0, y1: 0, y2: 0 })
    resonancePeaksSuppressed++
    totalDepthAppliedDb += -depthDb
  }

  // Measure resonance reduction: sum of |avgMag| at the peak bins before vs after.
  // Re-compute averaged spectrum on the processed output (8 windows).
  const afterAvgMag = new Float32Array(halfBins)
  for (let w = 0; w < numWindows; w++) {
    const start = Math.floor(((n - FFT_SIZE) * (w + 0.5)) / numWindows)
    for (let i = 0; i < FFT_SIZE; i++) {
      fft.real[i] = output[start + i] * HANN[i]
      fft.imag[i] = 0
    }
    fft.forward()
    for (let b = 0; b < halfBins; b++) {
      afterAvgMag[b] += Math.sqrt(fft.real[b] * fft.real[b] + fft.imag[b] * fft.imag[b]) / FFT_SIZE
    }
  }
  for (let b = 0; b < halfBins; b++) afterAvgMag[b] /= numWindows

  let peakEnergyBefore = 0, peakEnergyAfter = 0
  for (const peak of topPeaks) {
    peakEnergyBefore += avgMag[peak.bin] * avgMag[peak.bin]
    peakEnergyAfter += afterAvgMag[peak.bin] * afterAvgMag[peak.bin]
  }
  const resonanceReductionDb = peakEnergyBefore > 1e-18 && peakEnergyAfter > 1e-18
    ? 10 * Math.log10(peakEnergyBefore / Math.max(peakEnergyAfter, 1e-18))
    : 0

  onProgress?.(100)
  return {
    output,
    specific: {
      resonancePeaksDetected: peaks.length,
      resonancePeaksSuppressed,
      notchDepthDb: resonancePeaksSuppressed > 0
        ? -(totalDepthAppliedDb / resonancePeaksSuppressed)
        : 0,
      peaksList: topPeaks.length,
      resonanceReductionDb,
      avgPeakProminenceDb: topPeaks.length > 0
        ? topPeaks.reduce((s, p) => s + p.prominenceDb, 0) / topPeaks.length
        : 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Public entry — runRepair
// ---------------------------------------------------------------------------

/**
 * Run a single repair module on the input channels.
 * - Measures before metrics, runs the module DSP, measures after metrics.
 * - Yields to UI thread between heavy chunks.
 * - Checks AbortSignal between every chunk; throws CancelledError if aborted.
 * - Deterministic — no Math.random, no Date.now in DSP path.
 */
export async function runRepair(
  moduleId: RepairModuleId,
  input: Float32Array[],
  sampleRate: number,
  intensity: number,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<RepairResult> {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())

  // Measure before
  const before = measureRepairMetrics(input, sampleRate)

  // Copy input channels (so we never mutate the caller's buffers)
  const inputCopy: Float32Array[] = input.map((c) => c.slice())
  // Force stereo — repair modules operate per-channel but result is always stereo
  if (inputCopy.length === 1) inputCopy.push(inputCopy[0].slice())

  const numChannels = inputCopy.length
  const outputChannels: Float32Array[] = new Array(numChannels)
  let specific: Record<string, number> = {}

  // Per-channel progress aggregator
  const runModule = async (
    ch: number,
    mod: RepairModuleId,
    samples: Float32Array,
  ): Promise<ModuleOutput> => {
    const chProgress = (pct: number) =>
      onProgress?.(((ch + pct / 100) / numChannels) * 100)
    switch (mod) {
      case 'denoise':
        return repairDenoise(samples, sampleRate, intensity, chProgress, signal)
      case 'spectral_gate':
        return repairSpectralGate(samples, sampleRate, intensity, chProgress, signal)
      case 'declick':
        return repairDeclick(samples, sampleRate, intensity, chProgress, signal)
      case 'decrackle':
        return repairDecrackle(samples, sampleRate, intensity, chProgress, signal)
      case 'dehum':
        return repairDehum(samples, sampleRate, intensity, chProgress, signal)
      case 'dereverb':
        return repairDereverb(samples, sampleRate, intensity, chProgress, signal)
      case 'declip':
        return repairDeclip(samples, sampleRate, intensity, chProgress, signal)
      case 'resonance':
        return repairResonance(samples, sampleRate, intensity, chProgress, signal)
    }
  }

  // Channel 0
  const out0 = await runModule(0, moduleId, inputCopy[0])
  outputChannels[0] = out0.output
  specific = out0.specific
  // Channel 1 (if stereo) — use the same noise floor estimate / settings
  // derived from channel 0 for consistency? For simplicity we re-derive per
  // channel (deterministic, since each channel's statistics are deterministic).
  if (numChannels > 1) {
    const out1 = await runModule(1, moduleId, inputCopy[1])
    outputChannels[1] = out1.output
    // Merge specific metrics: keep channel 0's, but average where it makes sense
    // For now, channel 0's specific metrics are the "reported" ones.
  }

  // Measure after
  const after = measureRepairMetrics(outputChannels, sampleRate)

  // Improvement: standard metric deltas + module-specific measurements
  const improvement: Record<string, number> = { ...specific }
  for (const k of Object.keys(before)) {
    const delta = (after[k] ?? 0) - (before[k] ?? 0)
    improvement[`${k}_delta`] = delta
  }

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now())

  return {
    moduleId,
    channels: outputChannels,
    sampleRate,
    metrics: { before, after, improvement },
    duration: t1 - t0,
  }
}
