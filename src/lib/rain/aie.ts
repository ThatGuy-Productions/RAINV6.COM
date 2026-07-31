'use client'

/**
 * RAIN V6 — Artist Identity Engine (AIE)
 *
 * Real 64-dimensional voice vector extracted from the loaded AudioBuffer.
 *
 *   64 dims = 32 Mel-spaced bands × 2 channels (L, R)
 *
 * Pipeline:
 *   1. STFT per channel (1024-pt periodic Hann window, 75% overlap = 256-sample hop)
 *   2. Bin magnitude (|real|² + |imag|²) → sqrt → per-band aggregation across
 *      32 Mel-spaced frequency bands (0 Hz → Nyquist).
 *   3. Per-band energy averaged across all STFT frames in the LOG domain
 *      (this matches human loudness perception and stabilizes against transient
 *      level variation).
 *   4. Concatenate L-band-vector (32) + R-band-vector (32) = 64.
 *   5. Normalize the full 64-vector to unit L2 norm so cosine similarity / EMA
 *      updates are scale-invariant.
 *
 * EMA across sessions:
 *   out[i] = α · prev[i] + (1-α) · current[i]
 *   α = 0.90 once personalized (≥5 sessions); α = 0.60 in cold-start phase.
 *
 * Persistence: the current VoiceVector + last 50 sessions are stored in
 * IndexedDB under the `rain:aie` object store (keys: `current`, `history`).
 *
 * Signed export: an HMAC-SHA256 over the canonical vector bytes (packed
 * Float32, channel-interleaved) is computed via WebCrypto and embedded in the
 * downloaded JSON so a downstream verifier can confirm the vector originated
 * from this RAIN V6 instance.
 *
 * Determinism: same input audio + same persisted prev-vector → same output,
 * bit-for-bit. No Math.random in the DSP path. The export timestamp is the
 * only non-deterministic field (and it lives outside the signed payload).
 */

import { fftInPlace } from './dsp'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VoiceVector {
  /** 64-dim L2-normalized voice vector (32 Mel bands × 2 channels). */
  vector: Float32Array
  /** Hex representation of the vector bytes (channel-interleaved Float32). */
  vectorHex: string
  /** Number of sessions observed (cold-start phase ends at 5). */
  sessions: number
  /** EMA alpha actually used (0.60 cold-start, 0.90 personalized). */
  emaAlpha: number
  /** 1 − cosineDistance(prev, current), clamped to [0, 1]. 1.0 on first run. */
  stability: number
  /** HMAC-SHA256 hex signature over the vector bytes (only set on export). */
  signedExport?: string
  /** ISO timestamp of the last update (only set on export). */
  timestamp?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FFT_SIZE = 1024
const HOP_SIZE = 256 // 75% overlap
const NUM_BINS = FFT_SIZE / 2 + 1 // 513 positive-frequency bins
const NUM_MEL_BANDS = 32
const COLD_START_SESSIONS = 5
const ALPHA_PERSONALIZED = 0.90
const ALPHA_COLD_START = 0.60
const MAX_HISTORY = 50

const DB_NAME = 'rain-aie'
const DB_VERSION = 1
const STORE_NAME = 'vectors'
const KEY_CURRENT = 'rain:aie:current'
const KEY_HISTORY = 'rain:aie:history'

// ---------------------------------------------------------------------------
// Mel scale (duplicated from stems.ts to keep this module self-contained —
// stems.ts keeps its hzToMel/melToHz file-private by design).
// ---------------------------------------------------------------------------

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1)
}

// ---------------------------------------------------------------------------
// Periodic Hann window (COLA-correct for 75% overlap).
// ---------------------------------------------------------------------------

const HANN = (() => {
  const w = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE))
  }
  return w
})()

// ---------------------------------------------------------------------------
// Mel-band aggregation
// ---------------------------------------------------------------------------

interface BinRange { start: number; end: number }

function computeMelBandRanges(sampleRate: number): BinRange[] {
  const nyquist = Math.min(22000, sampleRate / 2)
  const melMin = hzToMel(0)
  const melMax = hzToMel(nyquist)
  const edges: number[] = []
  for (let i = 0; i <= NUM_MEL_BANDS; i++) {
    edges.push(melToHz(melMin + ((melMax - melMin) * i) / NUM_MEL_BANDS))
  }
  const ranges: BinRange[] = []
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
// Per-channel 32-dim Mel-band log-energy vector
// ---------------------------------------------------------------------------

function computeChannelMelVector(samples: Float32Array, _sampleRate: number, bandRanges: BinRange[]): Float32Array {
  const len = samples.length
  // Number of STFT frames (centered, zero-padded at boundaries)
  const numFrames = Math.max(1, Math.floor((len - 1) / HOP_SIZE) + 1)
  const vec = new Float32Array(NUM_MEL_BANDS)
  const real = new Float32Array(FFT_SIZE)
  const imag = new Float32Array(FFT_SIZE)
  const mag = new Float32Array(NUM_BINS)

  for (let band = 0; band < NUM_MEL_BANDS; band++) {
    let bandEnergySum = 0
    let framesWithEnergy = 0
    for (let f = 0; f < numFrames; f++) {
      const start = f * HOP_SIZE - Math.floor(FFT_SIZE / 2)
      // Window into real[], zero imag[]
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = start + i
        real[i] = (idx >= 0 && idx < len ? samples[idx] : 0) * HANN[i]
        imag[i] = 0
      }
      fftInPlace(real, imag)
      // Magnitude spectrum (positive frequencies only)
      for (let i = 0; i < NUM_BINS; i++) {
        mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
      }
      // Aggregate energy in this band's bin range
      const { start: bStart, end: bEnd } = bandRanges[band]
      let e = 0
      let n = 0
      for (let i = bStart; i < bEnd; i++) {
        e += mag[i] * mag[i]
        n++
      }
      if (n > 0) {
        // Per-frame band energy in dB (log domain) with floor to avoid -Inf
        const energy = e / n
        const db = 10 * Math.log10(energy + 1e-12)
        bandEnergySum += db
        framesWithEnergy++
      }
    }
    const meanDb = framesWithEnergy > 0 ? bandEnergySum / framesWithEnergy : -120
    vec[band] = meanDb
  }
  return vec
}

// ---------------------------------------------------------------------------
// L2 normalization (in-place)
// ---------------------------------------------------------------------------

function l2Normalize(v: Float32Array): void {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum)
  if (norm < 1e-12) return
  const inv = 1 / norm
  for (let i = 0; i < v.length; i++) v[i] *= inv
}

// ---------------------------------------------------------------------------
// Public: computeVoiceVector
// ---------------------------------------------------------------------------

/**
 * Compute the 64-dim voice vector from an AudioBuffer.
 *
 * The vector is the concatenation of:
 *   - L channel: 32 Mel-band log-energies (mean across STFT frames)
 *   - R channel: same, 32 dims
 * followed by global L2 normalization.
 *
 * For mono buffers, L and R are identical (the 32-band block repeats),
 * which is the correct behavior — a mono source has no stereo information.
 */
export function computeVoiceVector(audioBuffer: AudioBuffer): Float32Array {
  const sampleRate = audioBuffer.sampleRate
  const bandRanges = computeMelBandRanges(sampleRate)
  const numCh = audioBuffer.numberOfChannels
  const out = new Float32Array(64)

  // L channel (or mono)
  const lSamples = audioBuffer.getChannelData(0)
  const lVec = computeChannelMelVector(lSamples, sampleRate, bandRanges)
  out.set(lVec, 0)

  // R channel (mono → duplicate L)
  if (numCh >= 2) {
    const rSamples = audioBuffer.getChannelData(1)
    const rVec = computeChannelMelVector(rSamples, sampleRate, bandRanges)
    out.set(rVec, 32)
  } else {
    out.set(lVec, 32)
  }

  l2Normalize(out)
  return out
}

// ---------------------------------------------------------------------------
// Public: computeEmaVector
// ---------------------------------------------------------------------------

/**
 * EMA-update the voice vector.
 *   out[i] = α · prev[i] + (1-α) · current[i]
 * If prev is null (first session), the current vector is returned unchanged.
 * The result is NOT re-normalized — the caller may normalize if desired.
 * We do not re-normalize so the EMA weighting is preserved bit-for-bit (the
 * downstream stability computation operates on raw EMA output).
 */
export function computeEmaVector(
  prev: Float32Array | null,
  current: Float32Array,
  alpha: number,
): Float32Array {
  if (prev === null || prev.length !== current.length) {
    return current.slice()
  }
  const out = new Float32Array(current.length)
  const oneMinusAlpha = 1 - alpha
  for (let i = 0; i < current.length; i++) {
    out[i] = alpha * prev[i] + oneMinusAlpha * current[i]
  }
  return out
}

// ---------------------------------------------------------------------------
// Public: computeStability
// ---------------------------------------------------------------------------

/**
 * Stability = 1 − cosineDistance(prev, current), clamped to [0, 1].
 * cosineDistance = 1 − cosineSimilarity, so stability = cosineSimilarity.
 * Returns 1.0 when prev is null (no prior → trivially stable).
 */
export function computeStability(prev: Float32Array | null, current: Float32Array): number {
  if (prev === null || prev.length !== current.length) return 1
  let dot = 0
  let magP = 0
  let magC = 0
  for (let i = 0; i < current.length; i++) {
    dot += prev[i] * current[i]
    magP += prev[i] * prev[i]
    magC += current[i] * current[i]
  }
  const denom = Math.sqrt(magP) * Math.sqrt(magC)
  if (denom < 1e-12) return 1
  const cos = dot / denom
  // Clamp to [0, 1] — cosine similarity can be negative for opposite vectors
  return Math.max(0, Math.min(1, cos))
}

// ---------------------------------------------------------------------------
// Public: alpha selection (cold-start vs personalized)
// ---------------------------------------------------------------------------

export function pickEmaAlpha(sessions: number): number {
  return sessions >= COLD_START_SESSIONS ? ALPHA_PERSONALIZED : ALPHA_COLD_START
}

export function isPersonalized(sessions: number): boolean {
  return sessions >= COLD_START_SESSIONS
}

// ---------------------------------------------------------------------------
// Vector ↔ hex
// ---------------------------------------------------------------------------

function float32ArrayToHex(v: Float32Array): string {
  const ab = new ArrayBuffer(v.length * 4)
  const view = new DataView(ab)
  for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i], true)
  const bytes = new Uint8Array(ab)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

// ---------------------------------------------------------------------------
// Public: signVectorHmac — HMAC-SHA256 over the packed Float32 bytes
// ---------------------------------------------------------------------------

export async function signVectorHmac(vector: Float32Array, secret: string): Promise<string> {
  // Pack the vector as channel-interleaved Float32 (little-endian, matching
  // vectorHex) so the signature is verifiable against the hex payload.
  const ab = new ArrayBuffer(vector.length * 4)
  const view = new DataView(ab)
  for (let i = 0; i < vector.length; i++) view.setFloat32(i * 4, vector[i], true)

  const enc = new TextEncoder()
  const keyBytes = enc.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, ab)
  const sigBytes = new Uint8Array(sig)
  let hex = ''
  for (let i = 0; i < sigBytes.length; i++) hex += sigBytes[i].toString(16).padStart(2, '0')
  return hex
}

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

interface StoredVector {
  /** Plain number[] (Float32Array isn't structured-cloneable across all engines). */
  vector: number[]
  vectorHex: string
  sessions: number
  emaAlpha: number
  stability: number
  /** ISO timestamp of last update. */
  updatedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T> | T): Promise<T> {
  const db = await openDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

function toStored(v: VoiceVector): StoredVector {
  return {
    vector: Array.from(v.vector),
    vectorHex: v.vectorHex,
    sessions: v.sessions,
    emaAlpha: v.emaAlpha,
    stability: v.stability,
    updatedAt: new Date().toISOString(),
  }
}

function fromStored(s: StoredVector): VoiceVector {
  return {
    vector: Float32Array.from(s.vector),
    vectorHex: s.vectorHex,
    sessions: s.sessions,
    emaAlpha: s.emaAlpha,
    stability: s.stability,
  }
}

/**
 * Persist the current voice vector under `rain:aie:current` and append a
 * snapshot to the `rain:aie:history` array (capped at MAX_HISTORY entries).
 */
export async function persistVector(vector: VoiceVector): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const stored = toStored(vector)
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(stored, KEY_CURRENT)
    const histReq = store.get(KEY_HISTORY)
    histReq.onsuccess = () => {
      const history = (histReq.result as StoredVector[] | undefined) ?? []
      history.unshift(stored)
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
      store.put(history, KEY_HISTORY)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

/**
 * Load the persisted current voice vector, or null if none exists yet.
 */
export async function loadPersistedVector(): Promise<VoiceVector | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    return await withDb((db) => new Promise<VoiceVector | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(KEY_CURRENT)
      req.onsuccess = () => {
        const stored = req.result as StoredVector | undefined
        if (!stored) {
          resolve(null)
          return
        }
        resolve(fromStored(stored))
      }
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return null
  }
}

/**
 * Load the full session history (newest first), or empty array if none.
 */
export async function loadVectorHistory(): Promise<VoiceVector[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    return await withDb((db) => new Promise<VoiceVector[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(KEY_HISTORY)
      req.onsuccess = () => {
        const stored = (req.result as StoredVector[] | undefined) ?? []
        resolve(stored.map(fromStored))
      }
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return []
  }
}

/**
 * Reset the AIE state — wipes the current vector and history. Used for
 * testing and for the "Reset identity" admin action.
 */
export async function resetPersistedVector(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(KEY_CURRENT)
    store.delete(KEY_HISTORY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

// ---------------------------------------------------------------------------
// Convenience: build a VoiceVector from the loaded audio buffer + prior state
// ---------------------------------------------------------------------------

/**
 * High-level helper used by the AIETab. Runs the full pipeline:
 *   1. Load the persisted vector (if any) to get session count + prev vector.
 *   2. Compute the current buffer's voice vector.
 *   3. Pick α based on session count.
 *   4. EMA-update prev → current with α.
 *   5. Compute stability = cosineSimilarity(prev, ema-updated).
 *   6. Persist the updated VoiceVector.
 *
 * Returns the freshly-persisted VoiceVector. If no audio buffer is supplied,
 * returns null (caller should handle the "no input loaded" case).
 */
export async function updateVoiceVectorFromBuffer(audioBuffer: AudioBuffer | null): Promise<VoiceVector | null> {
  if (!audioBuffer) return null
  const persisted = await loadPersistedVector()
  const sessions = (persisted?.sessions ?? 0) + 1
  const alpha = pickEmaAlpha(sessions)

  const currentVec = computeVoiceVector(audioBuffer)
  const prevVec = persisted?.vector ?? null
  const emaVec = computeEmaVector(prevVec, currentVec, alpha)
  const stability = computeStability(prevVec, emaVec)
  const vectorHex = float32ArrayToHex(emaVec)

  const out: VoiceVector = {
    vector: emaVec,
    vectorHex,
    sessions,
    emaAlpha: alpha,
    stability,
  }
  await persistVector(out)
  return out
}

/**
 * Build the signed export payload (the JSON the user downloads when they
 * click "Export Vector"). The signature covers the packed Float32 bytes
 * exactly as encoded in `vectorHex`.
 */
export async function buildSignedExport(v: VoiceVector, secret: string): Promise<{
  vector: number[]
  vectorHex: string
  sessions: number
  emaAlpha: number
  stability: number
  signature: string
  timestamp: string
}> {
  const signature = await signVectorHmac(v.vector, secret)
  return {
    vector: Array.from(v.vector),
    vectorHex: v.vectorHex,
    sessions: v.sessions,
    emaAlpha: v.emaAlpha,
    stability: v.stability,
    signature,
    timestamp: new Date().toISOString(),
  }
}
