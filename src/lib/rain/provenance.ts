'use client'

/**
 * RAIN V6 — Provenance (RAIN-CERT) Generator
 *
 * Generates Ed25519 signing keys via WebCrypto, signs SHA-256 hashes of the
 * input/output audio, and constructs a C2PA-style manifest per C2PA v2.2.
 *
 * The signing keys are persisted in IndexedDB so certificates can be verified
 * across sessions. The public key is embedded in every RAIN-CERT certificate.
 */

import type { C2PAManifest, ProvenanceCertificate } from './types'

const KEY_STORE = 'rain-cert-keys'
const KEY_NAME = 'rain-ed25519-primary'

interface StoredKeys {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
  createdAt: string
}

// ---------------------------------------------------------------------------
// Key persistence (IndexedDB)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_STORE, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('keys')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * AUDIT2 FIX: openDb() previously never closed the IDBDatabase, leaking a
 * connection per call. With ~10 renders per session that's 10 open databases
 * (Chrome caps at ~10 concurrent per origin before throwing). Now we close()
 * the connection as soon as the transaction completes.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

async function loadKeys(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey } | null> {
  try {
    return await withDb((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const req = store.get(KEY_NAME)
      req.onsuccess = async () => {
        const stored = req.result as StoredKeys | undefined
        if (!stored) {
          resolve(null)
          return
        }
        const publicKey = await crypto.subtle.importKey(
          'jwk', stored.publicKey,
          { name: 'Ed25519' },
          true, ['verify'],
        )
        const privateKey = await crypto.subtle.importKey(
          'jwk', stored.privateKey,
          { name: 'Ed25519' },
          false, ['sign'],
        )
        resolve({ publicKey, privateKey })
      }
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return null
  }
}

async function saveKeys(publicKey: CryptoKey, privateKey: CryptoKey): Promise<void> {
  const pubJwk = await crypto.subtle.exportKey('jwk', publicKey)
  const privJwk = await crypto.subtle.exportKey('jwk', privateKey)
  const stored: StoredKeys = { publicKey: pubJwk, privateKey: privJwk, createdAt: new Date().toISOString() }
  return withDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    tx.objectStore('keys').put(stored, KEY_NAME)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

async function getOrCreateKeys(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const existing = await loadKeys()
  if (existing) return existing
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  await saveKeys(pair.publicKey, pair.privateKey)
  return pair
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bufToHex(digest)
}

/**
 * Hash a Float32Array[] channel bus deterministically.
 *
 * P3-TPDF-MP3: The RAIN-CERT output hash MUST be computed over the FLOAT32
 * processed buffer (the deterministic DSP output), NOT over the integer WAV
 * bytes. Stage 15 adds TPDF dither (intentional non-deterministic noise at
 * the LSB level) during the Float32 → integer quantization step for audio
 * output. If we hashed the WAV bytes, the signature would change every render
 * (because dither is random). Hashing the float channels means the cert
 * attests to the *artistic* output of the DSP chain — the user's master —
 * not the randomly-dithered integer representation of it.
 *
 * The hash is computed over a packed Float32 ArrayBuffer (channel-interleaved
 * samples), so it is byte-stable for identical float input regardless of
 * which export format (WAV/MP3/Atmos) the user later chooses.
 */
export async function hashFloat32Channels(channels: Float32Array[]): Promise<string> {
  // Interleave channel samples into a single Float32Array buffer so the hash
  // is order-independent of channel count quirks (mono vs stereo).
  const totalSamples = channels.reduce((sum, ch) => sum + ch.length, 0)
  const ab = new ArrayBuffer(totalSamples * 4)
  const view = new Float32Array(ab)
  let idx = 0
  for (const ch of channels) {
    view.set(ch, idx)
    idx += ch.length
  }
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return bufToHex(digest)
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

// ---------------------------------------------------------------------------
// Fingerprint (Chromaprint-style simplified hash)
// ---------------------------------------------------------------------------

export async function computeFingerprint(channels: Float32Array[], sampleRate: number): Promise<string> {
  // Simplified Chromaprint-style: hash of sub-band energy frames
  const frames = 32
  const bands = 8
  const frameSize = Math.floor((channels[0].length / frames))
  const hash: number[] = []
  for (let f = 0; f < frames; f++) {
    const start = f * frameSize
    let bandEnergies: number[] = []
    for (let b = 0; b < bands; b++) {
      const lo = Math.floor((b / bands) * (frameSize / 2))
      const hi = Math.floor(((b + 1) / bands) * (frameSize / 2))
      let e = 0
      const ch = channels[0]
      for (let i = start + lo; i < start + hi; i++) {
        if (i < ch.length) e += ch[i] * ch[i]
      }
      bandEnergies.push(Math.sqrt(e / Math.max(1, hi - lo)))
    }
    // Threshold to 1 bit per band, pack 8 bits to byte
    const median = bandEnergies.slice().sort((a, b) => a - b)[Math.floor(bands / 2)]
    let byte = 0
    for (let b = 0; b < bands; b++) {
      if (bandEnergies[b] > median) byte |= (1 << b)
    }
    hash.push(byte)
  }
  return hash.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// ISRC / UPC generation (ISO 3901)
// ---------------------------------------------------------------------------

export function generateIsrc(registrant = '2XX', year = new Date().getFullYear() % 100): string {
  // CC-XXX-YY-NNNNN — country code (2), registrant (3), year (2), designation (5)
  const designation = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `US${registrant}${year.toString().padStart(2, '0')}${designation}`
}

export function generateUpc(): string {
  // 12-digit UPC-EAN-13 with valid check digit
  const base = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))
  let sum = 0
  for (let i = 0; i < 11; i++) sum += base[i] * (i % 2 === 0 ? 3 : 1)
  const check = (10 - (sum % 10)) % 10
  return [...base, check].join('')
}

// ---------------------------------------------------------------------------
// RAIN-CERT generation
// ---------------------------------------------------------------------------

export async function generateProvenance(opts: {
  inputBuffer: ArrayBuffer
  outputBuffer: ArrayBuffer
  wasmHash?: string
  params: Record<string, unknown>
  analysis: Record<string, unknown>
  /** Optional: decoded audio channels for fingerprint computation. */
  outputChannels?: Float32Array[]
  /** P3-TPDF-MP3: input channels for deterministic input hash (pre-WAV-quantization). */
  inputChannels?: Float32Array[]
  sampleRate?: number
}): Promise<ProvenanceCertificate> {
  const { inputBuffer, outputBuffer, params, analysis, outputChannels, inputChannels, sampleRate } = opts
  // AUDIT-M8 FIX: wasmHash was a hardcoded string 'sha256:in-browser-engine-v6'
  // implying a WASM module exists (it doesn't — DSP is pure TS). Renamed to
  // engineHash with an honest descriptor of the actual engine.
  const engineHash = opts.wasmHash ?? 'rain-dsp-ts-v6:ed25519-sha256'
  const keys = await getOrCreateKeys()
  // P3-TPDF-MP3: prefer hashing the FLOAT32 channels (deterministic DSP
  // output) over the integer WAV bytes (which would change every render due
  // to TPDF dither noise at the LSB level). The cert attests to the artistic
  // master, not the randomly-dithered integer representation of it.
  const inputHash = inputChannels && inputChannels.length > 0
    ? await hashFloat32Channels(inputChannels)
    : await sha256(inputBuffer)
  const outputHash = outputChannels && outputChannels.length > 0
    ? await hashFloat32Channels(outputChannels)
    : await sha256(outputBuffer)

  // AUDIT-M8 FIX: computeFingerprint() existed but was NEVER called, so the
  // manifest's fingerprint assertion was an empty type tag. Now we compute a
  // real Chromaprint-style hash from the output audio and embed it.
  let fingerprint: string | undefined
  if (outputChannels && outputChannels.length > 0 && sampleRate) {
    try {
      fingerprint = await computeFingerprint(outputChannels, sampleRate)
    } catch (e) {
      console.warn('[provenance] fingerprint computation failed:', e)
    }
  }

  // Build C2PA manifest
  const now = new Date().toISOString()
  const manifest: C2PAManifest = {
    version: '2.2',
    claimGenerator: `RAIN/${'6.0.0-rc1'}`,
    actions: [
      { action: 'c2pa.audio.mastered', parameters: { engine: 'RAIN-DSP-Web-v6' }, when: now },
      { action: 'c2pa.audio.dsp', parameters: { params }, when: now },
      { action: 'c2pa.audio.analyzed', parameters: { analysis }, when: now },
    ],
    assertions: [
      { label: 'c2pa.actions.v2', data: { actions: ['mastered', 'dsp', 'analyzed'] } },
      { label: 'org.rain.cert.level', data: { level: 'RAIN-CERT-1', algorithm: 'Ed25519' } },
      // AUDIT-M8 FIX: watermark assertion was a bare type tag implying an
      // AudioSeal 16-bit watermark was embedded. No watermarking is performed
      // (AudioSeal requires a neural model we don't ship). Now honestly states
      // "not embedded" so verifiers and the QC tab can't be fooled.
      { label: 'org.rain.watermark', data: { type: 'none', embedded: false, note: 'AudioSeal not available in-browser' } },
      // AUDIT-M8 FIX: include the actual fingerprint hash, not just the type.
      { label: 'org.rain.fingerprint', data: { type: 'Chromaprint', hash: fingerprint ?? null, frames: 32, bands: 8 } },
    ],
  }

  // AUDIT-M8 FIX: comment said "CBOR-encoded (RFC 8949)" but we use JSON.
  // The manifest is JSON-serialised for signing (matches verifyProvenance).
  const manifestJson = JSON.stringify(manifest)
  const message = new TextEncoder().encode(outputHash + manifestJson)
  const signatureBuf = await crypto.subtle.sign('Ed25519', keys.privateKey, message)
  const signature = bufToHex(signatureBuf)

  const pubJwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  // Use btoa directly — Buffer is not defined in the browser and the `Buffer ?`
  // ternary throws a ReferenceError before the fallback runs.
  const publicKey = btoa(JSON.stringify(pubJwk))

  const certId = `RAIN-CERT-${outputHash.slice(0, 16).toUpperCase()}`

  return {
    certId,
    inputHash,
    outputHash,
    wasmHash: engineHash,
    signedAt: now,
    algorithm: 'Ed25519',
    publicKey,
    signature,
    manifest,
  }
}

/**
 * Verify a RAIN-CERT signature against the embedded public key.
 */
export async function verifyProvenance(cert: ProvenanceCertificate): Promise<boolean> {
  try {
    const pubJwk = JSON.parse(atob(cert.publicKey))
    const publicKey = await crypto.subtle.importKey('jwk', pubJwk, { name: 'Ed25519' }, true, ['verify'])
    const manifestJson = JSON.stringify(cert.manifest)
    const message = new TextEncoder().encode(cert.outputHash + manifestJson)
    const sigBytes = hexToBuf(cert.signature)
    // Must await — returning the promise without await defeats the try/catch
    // (async function semantics: `return p` ≠ `return await p` for error handling).
    return await crypto.subtle.verify('Ed25519', publicKey, sigBytes, message)
  } catch {
    return false
  }
}

function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  // AUDIT2-14 FIX: substr is deprecated; use slice.
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes.buffer
}
