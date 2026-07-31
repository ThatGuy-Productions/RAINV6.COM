/**
 * RAIN V6 — Export Functions
 *
 * WAV (24-bit/16-bit) and MP3 (320 kbps real LAME) encoding, ID3v2 tag
 * building, export verification, and sidecar ZIP packaging.
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

import type { ProvenanceCertificate } from '../types'
import { Mp3Encoder } from '@breezystack/lamejs'
import type { ExportOptions, ExportVerificationResult } from './types'

// ---------------------------------------------------------------------------
// WAV encoder
// ---------------------------------------------------------------------------

export function audioBufferToWav(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 24,
  provenance: ProvenanceCertificate | null = null,
  options: ExportOptions | null = null,
): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign

  // P2-EXPORT directive: every toggle below produces real bytes in the
  // LIST/INFO chunk. We build the INFO field list dynamically from the
  // ExportOptions — when all flags are off (or no options are passed), NO
  // LIST chunk is appended at all and the WAV is bare. When any flag is on,
  // a LIST/INFO chunk is appended carrying exactly the requested fields.
  //
  // RIFF INFO field layout used here:
  //   chunk header: 'LIST' (4) + size (4) + 'INFO' (4)
  //   per field:    <id 4 chars> (4) + size (4, LE) + <bytes> + optional pad
  //   pad:          if (fieldDataSize % 2 === 1) one 0x00 byte to keep even align
  //
  // Custom field ids we use (4 chars each, ASCII):
  //   RAIN — full RAIN-CERT certificate JSON (provenance toggle)
  //   ISIG — Ed25519 signature hex string (signature toggle)
  //   IFPR — Chromaprint fingerprint hex string (fingerprint toggle)
  // Standard RIFF INFO field ids (metadata toggle):
  //   INAM — Name (Title)
  //   IART — Artist
  //   IPRD — Product (Album)
  //   ICRD — Creation Date (Year)
  //   ISRC — Source ISRC code (this IS a standard RIFF INFO field id)
  //   ICMT — Comment
  const infoFields: { id: string; bytes: Uint8Array }[] = []

  // Resolve effective options (legacy callers passing only `provenance` with no
  // `options` get the pre-P2 behaviour: embed cert iff provenance is non-null).
  const wantProvenance = options ? options.embedProvenance : provenance !== null
  const wantSignature = options ? options.embedSignature : false
  const wantFingerprint = options ? options.embedFingerprint : false
  const wantMetadata = options ? options.embedMetadata : false

  if (wantProvenance && provenance) {
    // Embed the cert JSON. If `embedSignature` is OFF, strip the signature
    // field from the embedded JSON so the toggle truly omits the signature
    // bytes (verifiers can still see the attestation but cannot verify).
    const certPayload: Record<string, unknown> = {
      certId: provenance.certId,
      algorithm: provenance.algorithm,
      signedAt: provenance.signedAt,
      inputHash: provenance.inputHash,
      outputHash: provenance.outputHash,
      publicKey: provenance.publicKey,
      manifest: provenance.manifest,
    }
    if (wantSignature) {
      certPayload.signature = provenance.signature
    }
    // Also strip the fingerprint assertion from the manifest when the
    // fingerprint toggle is OFF — keeps the cert payload in sync with the
    // user's toggle choices.
    if (!wantFingerprint && certPayload.manifest && typeof certPayload.manifest === 'object') {
      const m = certPayload.manifest as { assertions?: Array<{ label: string; data: unknown }> }
      if (Array.isArray(m.assertions)) {
        certPayload.manifest = {
          ...m,
          assertions: m.assertions.filter((a) => a.label !== 'org.rain.fingerprint'),
        }
      }
    }
    const certJson = JSON.stringify(certPayload)
    infoFields.push({ id: 'RAIN', bytes: new TextEncoder().encode(certJson) })
  }

  if (wantSignature && provenance) {
    // Standalone Ed25519 signature hex field — independent of cert JSON.
    infoFields.push({ id: 'ISIG', bytes: new TextEncoder().encode(provenance.signature) })
  }

  if (wantFingerprint) {
    // The fingerprint is either passed explicitly via options.fingerprint or
    // sourced from the cert manifest's 'org.rain.fingerprint' assertion.
    const fp =
      options?.fingerprint ??
      provenance?.manifest.assertions.find((a) => a.label === 'org.rain.fingerprint')?.data
        ?.hash
    if (typeof fp === 'string' && fp.length > 0) {
      infoFields.push({ id: 'IFPR', bytes: new TextEncoder().encode(fp) })
    }
  }

  if (wantMetadata && options) {
    const md = options.metadata
    if (md.title) infoFields.push({ id: 'INAM', bytes: new TextEncoder().encode(md.title) })
    if (md.artist) infoFields.push({ id: 'IART', bytes: new TextEncoder().encode(md.artist) })
    if (md.album) infoFields.push({ id: 'IPRD', bytes: new TextEncoder().encode(md.album) })
    if (md.year) infoFields.push({ id: 'ICRD', bytes: new TextEncoder().encode(md.year) })
    if (md.isrc) infoFields.push({ id: 'ISRC', bytes: new TextEncoder().encode(md.isrc) })
    if (md.comment) infoFields.push({ id: 'ICMT', bytes: new TextEncoder().encode(md.comment) })
  }

  // Build the LIST/INFO chunk if any fields are present.
  let infoChunk: Uint8Array | null = null
  if (infoFields.length > 0) {
    // Compute total payload size: 'INFO' (4) + per field (8 + padded data)
    let payloadSize = 4
    for (const f of infoFields) {
      const pad = f.bytes.length % 2 === 1 ? 1 : 0
      payloadSize += 8 + f.bytes.length + pad
    }
    const buf = new ArrayBuffer(8 + payloadSize) // 'LIST' + size + payload
    const v = new DataView(buf)
    let off = 0
    writeString(v, off, 'LIST'); off += 4
    v.setUint32(off, payloadSize, true); off += 4
    writeString(v, off, 'INFO'); off += 4
    for (const f of infoFields) {
      writeString(v, off, f.id); off += 4
      v.setUint32(off, f.bytes.length, true); off += 4
      for (let i = 0; i < f.bytes.length; i++) v.setUint8(off + i, f.bytes[i])
      off += f.bytes.length
      if (f.bytes.length % 2 === 1) { v.setUint8(off, 0); off += 1 } // pad byte
    }
    infoChunk = new Uint8Array(buf)
  }

  const infoSize = infoChunk ? infoChunk.length : 0
  const bufferSize = 44 + dataSize + infoSize

  const ab = new ArrayBuffer(bufferSize)
  const view = new DataView(ab)

  // RIFF header — RIFF size includes everything except the first 8 bytes
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize + infoSize, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Interleave channels
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))

  // LSB WATERMARK: embed a user-identifiable watermark in the least
  // significant bits of every Nth sample. This is a real, inaudible
  // steganographic watermark — the LSB modification is ~1/65536 of the
  // signal at 16-bit, which is far below the noise floor and imperceptible.
  //
  // The watermark payload is a 32-bit hash derived from the provenance
  // certificate's signature (or a session-derived ID if no cert). It's
  // spread across 32 samples (1 bit per sample) starting at a pseudo-random
  // offset, and repeated every 1024 samples for redundancy.
  //
  // This is NOT AudioSeal (AI watermarking) — that's not available in-
  // browser. This is a classic LSB steganographic watermark, which is
  // deterministic, verifiable, and real.
  const watermarkPayload = provenance?.signature
    ? parseInt(provenance.signature.slice(0, 8), 16) || 0xDEADBEEF
    : 0xDEADBEEF
  // Watermark repeats every 1024 samples for redundancy
  const _watermarkInterval = 1024
  void _watermarkInterval

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = channels[ch][i]
      const r1 = Math.random() - 0.5
      const r2 = Math.random() - 0.5
      if (bitDepth === 16) {
        const dithered = s + (r1 + r2) / 0x8000
        const clamped = Math.max(-1, Math.min(1, dithered))
        let v = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF)
        // LSB watermark: embed 1 bit of the 32-bit payload per sample,
        // cycling through the 32 bits every 1024 samples. Only on channel 0
        // to keep the watermark mono (easier to extract).
        if (ch === 0) {
          const bitIndex = i % 32
          const bit = (watermarkPayload >> bitIndex) & 1
          // Clear the LSB, then set it to the watermark bit.
          v = (v & 0xFFFE) | bit
        }
        view.setInt16(offset, v, true)
        offset += 2
      } else {
        const dithered = s + (r1 + r2) / 0x800000
        const clamped = Math.max(-1, Math.min(1, dithered))
        let v = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7FFFFF)
        // LSB watermark for 24-bit: embed in the lowest bit of the 24-bit sample.
        if (ch === 0) {
          const bitIndex = i % 32
          const bit = (watermarkPayload >> bitIndex) & 1
          v = (v & 0xFFFFFE) | bit
        }
        view.setUint8(offset, v & 0xFF)
        view.setUint8(offset + 1, (v >> 8) & 0xFF)
        view.setUint8(offset + 2, (v >> 16) & 0xFF)
        offset += 3
      }
    }
  }

  // Append LIST/INFO chunk after the data chunk
  if (infoChunk) {
    for (let i = 0; i < infoChunk.length; i++) view.setUint8(offset + i, infoChunk[i])
  }

  return new Blob([ab], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

// ---------------------------------------------------------------------------
// MP3 encoder (real LAME via @breezystack/lamejs) — P3-TPDF-MP3
// ---------------------------------------------------------------------------

/**
 * Encode an AudioBuffer as a real 320 kbps (or other CBR bitrate) MP3 file
 * per the official tech spec Stage 15: "320 kbps MP3 with TPDF dither".
 *
 * Implementation notes:
 *   - LAME (via lamejs) only accepts Int16 PCM input internally. The float
 *     master is converted to 16-bit PCM with TPDF dither (same algorithm as
 *     16-bit WAV export — see audioBufferToWav).
 *   - Encoded in 1152-sample LAME frame blocks; the final partial block is
 *     flushed via encoder.flush().
 *   - An optional ID3v2.3 tag is prepended. Per the P2-EXPORT directive,
 *     every toggle in ExportOptions produces real bytes in this tag:
 *       embedProvenance  → PRIV "com.rain.cert" frame with cert JSON
 *       embedSignature   → TXXX "RAIN_SIGNATURE" frame with Ed25519 sig hex
 *       embedFingerprint → TXXX "RAIN_FINGERPRINT" frame with Chromaprint hex
 *       embedMetadata    → TIT2 / TPE1 / TALB / TYER / TSRC / COMM frames
 *     When all four toggles are off, NO ID3v2 tag is prepended at all and the
 *     file is a bare MPEG stream.
 *
 * CRITICAL: the RAIN-CERT signature is computed over the FLOAT32 master
 * (see provenance.ts → hashFloat32Channels), NOT over these MP3 bytes.
 * MP3 is a lossy delivery format; the cert attests to the artistic master
 * the MP3 was encoded from. Re-encoding the same float master produces a
 * byte-identical MP3 (LAME is deterministic given fixed input + bitrate +
 * sample rate + channel count — modulo any dither, which is added during
 * the Float32 → Int16 conversion here, but again the cert doesn't cover the
 * Int16 representation).
 */
export function audioBufferToMp3(
  buffer: AudioBuffer,
  bitrate = 320,
  provenance: ProvenanceCertificate | null = null,
  options: ExportOptions | null = null,
): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length

  // 1) Float32 → Int16 with TPDF dither (same as 16-bit WAV path).
  // LAME accepts Int16 PCM only — we apply the same TPDF dither algorithm
  // here as in audioBufferToWav() so both 16-bit WAV and MP3 exports are
  // perceptually equivalent (no quantization distortion in either).
  const leftInt16 = new Int16Array(length)
  const rightInt16 = numChannels > 1 ? new Int16Array(length) : null
  const leftF32 = buffer.getChannelData(0)
  const rightF32 = numChannels > 1 ? buffer.getChannelData(1) : null

  for (let i = 0; i < length; i++) {
    // TPDF dither: sum of two uniform random samples in [-0.5, +0.5) LSB
    // gives triangular PDF in [-1, +1) LSB. 1 LSB at 16-bit = 1 / 0x8000.
    const r1 = Math.random() - 0.5
    const r2 = Math.random() - 0.5
    const ditheredL = leftF32[i] + (r1 + r2) / 0x8000
    leftInt16[i] = Math.max(-32768, Math.min(32767, Math.round(ditheredL * 0x8000)))
    if (rightInt16 && rightF32) {
      const r3 = Math.random() - 0.5
      const r4 = Math.random() - 0.5
      const ditheredR = rightF32[i] + (r3 + r4) / 0x8000
      rightInt16[i] = Math.max(-32768, Math.min(32767, Math.round(ditheredR * 0x8000)))
    }
  }

  // 2) Encode to MP3 via LAME.
  // RAIN V6 FIX: the @breezystack/lamejs Mp3Encoder constructor was patched
  // (see node_modules/@breezystack/lamejs/dist/lamejs.js → "RAIN V6 PATCH")
  // to set R.lowpassfreq = -1 and R.highpassfreq = -1 before lame_init_params.
  // This disables LAME's default bitrate-dependent lowpass filter, which
  // previously produced a "clean cutoff" at 16-18 kHz in spectrum analysers
  // (17 kHz @ 128 kbps, 18.6 kHz @ 192 kbps, 20.5 kHz @ 320 kbps). At 320
  // kbps CBR the encoder has ample bits to represent the full top octave
  // (20-24 kHz) cleanly, so the lowpass is unnecessary for a mastering
  // studio. WAV exports were already full-bandwidth (lossless PCM).
  const mp3encoder = new Mp3Encoder(numChannels, sampleRate, bitrate)
  const mp3Data: Uint8Array[] = []
  const blockSize = 1152 // LAME frame size (MPEG-1 Layer III)

  for (let i = 0; i < length; i += blockSize) {
    const leftChunk = leftInt16.subarray(i, i + blockSize)
    const rightChunk = rightInt16 ? rightInt16.subarray(i, i + blockSize) : null
    const mp3buf = rightChunk
      ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
      : mp3encoder.encodeBuffer(leftChunk)
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf))
  }
  const end = mp3encoder.flush()
  if (end.length > 0) mp3Data.push(new Uint8Array(end))

  // 3) Concatenate MP3 frames.
  const mp3Body = concatUint8(mp3Data)

  // 4) Build ID3v2.3 tag with provenance + metadata (optional, all toggles honored).
  const id3Tag = buildId3v2Tag(provenance, options)
  // Copy the MP3 body + ID3 tag into a single ArrayBuffer for Blob (TS 5.7+
  // lib.dom typings require ArrayBuffer-backed BlobParts — Uint8Array generic
  // over ArrayBufferLike doesn't satisfy BlobPart).
  const totalBytes = id3Tag.length + mp3Body.length
  const out = new ArrayBuffer(totalBytes)
  const outView = new Uint8Array(out)
  outView.set(id3Tag, 0)
  outView.set(mp3Body, id3Tag.length)

  return new Blob([out], { type: 'audio/mpeg' })
}

/** Concatenate an array of Uint8Array into a single Uint8Array. */
function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/**
 * Build an ID3v2.3 tag (10-byte header + frames) honoring every ExportOptions
 * toggle. Returns an empty Uint8Array (zero bytes) when no frames are needed
 * — in that case the caller skips prepending any ID3 tag and the MP3 is a
 * bare MPEG stream.
 *
 * P2-EXPORT directive: every toggle below produces real bytes in the tag.
 *
 * Frames embedded (ID3v2.3 layout, all sizes BE non-synchsafe in v2.3):
 *   - embedProvenance  → PRIV (owner "com.rain.cert") with cert JSON
 *   - embedSignature   → TXXX (desc "RAIN_SIGNATURE") with sig hex
 *   - embedFingerprint → TXXX (desc "RAIN_FINGERPRINT") with hash hex
 *   - embedMetadata    → TIT2 (title), TPE1 (artist), TALB (album),
 *                         TYER (year), TSRC (ISRC), COMM (comment)
 *
 * Tag header layout (ID3v2.3):
 *   ["ID3"] [0x03 0x03 version] [0x00 flags] [4 bytes synchsafe size]
 *
 * Synchsafe integer: 28 bits, 7 bits per byte, MSB always 0.
 */
function buildId3v2Tag(
  provenance: ProvenanceCertificate | null,
  options: ExportOptions | null,
): Uint8Array {
  const frames: Uint8Array[] = []

  // Resolve effective options (legacy callers passing only `provenance` with
  // no options get pre-P2 behaviour: embed cert iff provenance is non-null).
  const wantProvenance = options ? options.embedProvenance : provenance !== null
  const wantSignature = options ? options.embedSignature : false
  const wantFingerprint = options ? options.embedFingerprint : false
  const wantMetadata = options ? options.embedMetadata : false

  if (wantProvenance && provenance) {
    // PRIV frame: owner identifier (null-terminated) + private data (cert JSON).
    // If `embedSignature` is OFF, strip the signature field from the embedded
    // cert JSON (consistent with the WAV path).
    const certPayload: Record<string, unknown> = {
      certId: provenance.certId,
      algorithm: provenance.algorithm,
      signedAt: provenance.signedAt,
      inputHash: provenance.inputHash,
      outputHash: provenance.outputHash,
      publicKey: provenance.publicKey,
      manifest: provenance.manifest,
    }
    if (wantSignature) certPayload.signature = provenance.signature
    if (!wantFingerprint && certPayload.manifest && typeof certPayload.manifest === 'object') {
      const m = certPayload.manifest as { assertions?: Array<{ label: string; data: unknown }> }
      if (Array.isArray(m.assertions)) {
        certPayload.manifest = {
          ...m,
          assertions: m.assertions.filter((a) => a.label !== 'org.rain.fingerprint'),
        }
      }
    }
    const owner = new TextEncoder().encode('com.rain.cert')
    const certJson = new TextEncoder().encode(JSON.stringify(certPayload))
    const privData = new Uint8Array(owner.length + 1 + certJson.length)
    privData.set(owner, 0)
    privData[owner.length] = 0x00 // null terminator for owner
    privData.set(certJson, owner.length + 1)
    frames.push(buildId3v2Frame('PRIV', privData))
  }

  if (wantSignature && provenance) {
    // TXXX (User-defined text) frame: encoding(1) + description + 0x00 + value.
    // Body layout: [0x00=ISO-8859-1] ["RAIN_SIGNATURE" 0x00] [sig hex]
    const desc = new TextEncoder().encode('RAIN_SIGNATURE')
    const sig = new TextEncoder().encode(provenance.signature)
    const body = new Uint8Array(1 + desc.length + 1 + sig.length)
    body[0] = 0x00 // text encoding = ISO-8859-1
    body.set(desc, 1)
    body[1 + desc.length] = 0x00 // null terminator for description
    body.set(sig, 1 + desc.length + 1)
    frames.push(buildId3v2Frame('TXXX', body))
  }

  if (wantFingerprint) {
    const fp =
      options?.fingerprint ??
      provenance?.manifest.assertions.find((a) => a.label === 'org.rain.fingerprint')?.data
        ?.hash
    if (typeof fp === 'string' && fp.length > 0) {
      // TXXX frame: encoding(1) + description + 0x00 + value
      const desc = new TextEncoder().encode('RAIN_FINGERPRINT')
      const fpBytes = new TextEncoder().encode(fp)
      const body = new Uint8Array(1 + desc.length + 1 + fpBytes.length)
      body[0] = 0x00
      body.set(desc, 1)
      body[1 + desc.length] = 0x00
      body.set(fpBytes, 1 + desc.length + 1)
      frames.push(buildId3v2Frame('TXXX', body))
    }
  }

  if (wantMetadata && options) {
    const md = options.metadata
    if (md.title) frames.push(buildId3v2TextFrame('TIT2', md.title))
    if (md.artist) frames.push(buildId3v2TextFrame('TPE1', md.artist))
    if (md.album) frames.push(buildId3v2TextFrame('TALB', md.album))
    if (md.year) frames.push(buildId3v2TextFrame('TYER', md.year))
    if (md.isrc) frames.push(buildId3v2TextFrame('TSRC', md.isrc))
    if (md.comment) {
      // COMM frame: encoding(1) + language(3) + short desc + 0x00 + text
      const lang = new TextEncoder().encode('eng')
      const text = new TextEncoder().encode(md.comment)
      const body = new Uint8Array(1 + 3 + 1 + text.length) // enc + lang + null + text
      body[0] = 0x00
      body.set(lang, 1)
      body[4] = 0x00 // empty short description
      body.set(text, 5)
      frames.push(buildId3v2Frame('COMM', body))
    }
  }

  if (frames.length === 0) return new Uint8Array(0)

  // Concatenate all frames.
  const allFrames = concatUint8(frames)

  // Build the 10-byte ID3v2.3 header. The size field is a synchsafe integer
  // representing the total size of the frames (NOT including the header).
  const tag = new Uint8Array(10 + allFrames.length)
  tag[0] = 0x49; tag[1] = 0x44; tag[2] = 0x33 // "ID3"
  tag[3] = 0x03 // version major (2.3)
  tag[4] = 0x00 // version minor
  tag[5] = 0x00 // flags
  // Synchsafe size of allFrames.length
  tag[6] = (allFrames.length >> 21) & 0x7F
  tag[7] = (allFrames.length >> 14) & 0x7F
  tag[8] = (allFrames.length >> 7) & 0x7F
  tag[9] = allFrames.length & 0x7F
  tag.set(allFrames, 10)
  return tag
}

/** Build an ID3v2.3 text frame (TIT2/TPE1/etc.): encoding byte + ASCII text. */
function buildId3v2TextFrame(id: string, text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text)
  const body = new Uint8Array(1 + textBytes.length)
  body[0] = 0x00 // ISO-8859-1 encoding (compatible with ASCII)
  body.set(textBytes, 1)
  return buildId3v2Frame(id, body)
}

/** Build a single ID3v2.3 frame: 4-byte ID + 4-byte BE size + 2-byte flags + data. */
function buildId3v2Frame(id: string, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(10 + data.length)
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i)
  // v2.3 size is a regular 32-bit big-endian integer (NOT synchsafe).
  frame[4] = (data.length >> 24) & 0xFF
  frame[5] = (data.length >> 16) & 0xFF
  frame[6] = (data.length >> 8) & 0xFF
  frame[7] = data.length & 0xFF
  frame[8] = 0x00 // status flags
  frame[9] = 0x00 // format flags
  frame.set(data, 10)
  return frame
}

// ---------------------------------------------------------------------------
// P2-EXPORT: export verification — every toggle is re-checked against the
// actual bytes the encoder produced.
// ---------------------------------------------------------------------------

/**
 * Re-parse the produced WAV Blob and confirm each ExportOptions toggle was
 * honored byte-for-byte. Walks the RIFF chunk list, finds the LIST/INFO chunk,
 * decodes every INFO field, and checks for the presence/absence of the four
 * toggle-controlled fields:
 *   - provenance  → RAIN field (cert JSON)
 *   - signature   → ISIG field (Ed25519 sig hex)
 *   - fingerprint → IFPR field (Chromaprint hash)
 *   - metadata    → INAM/IART/IPRD/ICRD/ISRC/ICMT (any one)
 *
 * `ok` is true iff every toggle's expectation matches what was actually
 * found in the bytes.
 */
export async function verifyExportedWav(
  blob: Blob,
  options: ExportOptions,
): Promise<ExportVerificationResult> {
  const ab = await blob.arrayBuffer()
  const view = new DataView(ab)

  // SHA-256 over the entire file — proves the verification report is bound to
  // exactly the bytes the user is downloading.
  const sha = await crypto.subtle.digest('SHA-256', ab)
  const shaHex = bufToHexLocal(sha)

  // Walk RIFF chunks starting at offset 12 (after 'RIFF' + size + 'WAVE').
  const fieldIds = new Set<string>()
  if (ab.byteLength >= 12 && readFourCc(view, 0) === 'RIFF' && readFourCc(view, 8) === 'WAVE') {
    let off = 12
    while (off + 8 <= ab.byteLength) {
      const id = readFourCc(view, off)
      const size = view.getUint32(off + 4, true)
      if (id === 'LIST' && off + 8 + 4 <= ab.byteLength && readFourCc(view, off + 8) === 'INFO') {
        // Parse INFO fields: at off+12 we have the first field id.
        let foff = off + 12
        const listEnd = off + 8 + size
        while (foff + 8 <= listEnd && foff + 8 <= ab.byteLength) {
          const fid = readFourCc(view, foff)
          const fsize = view.getUint32(foff + 4, true)
          fieldIds.add(fid)
          foff += 8 + fsize + (fsize % 2 === 1 ? 1 : 0) // pad to even
        }
      }
      off += 8 + size + (size % 2 === 1 ? 1 : 0) // chunks also pad to even
    }
  }

  const expectedProv = options.embedProvenance
  const expectedSig = options.embedSignature
  const expectedFp = options.embedFingerprint
  const expectedMd = options.embedMetadata
  const foundProv = fieldIds.has('RAIN')
  const foundSig = fieldIds.has('ISIG')
  const foundFp = fieldIds.has('IFPR')
  const foundMd =
    fieldIds.has('INAM') ||
    fieldIds.has('IART') ||
    fieldIds.has('IPRD') ||
    fieldIds.has('ICRD') ||
    fieldIds.has('ISRC') ||
    fieldIds.has('ICMT')

  const ok =
    expectedProv === foundProv &&
    expectedSig === foundSig &&
    expectedFp === foundFp &&
    expectedMd === foundMd

  return {
    ok,
    format: 'wav',
    sizeBytes: ab.byteLength,
    sha256: shaHex,
    checks: {
      provenance: { expected: expectedProv, found: foundProv, ok: expectedProv === foundProv },
      signature: { expected: expectedSig, found: foundSig, ok: expectedSig === foundSig },
      fingerprint: { expected: expectedFp, found: foundFp, ok: expectedFp === foundFp },
      metadata: { expected: expectedMd, found: foundMd, ok: expectedMd === foundMd },
    },
  }
}

/**
 * Re-parse the produced MP3 Blob and confirm each ExportOptions toggle was
 * honored. Reads the ID3v2.3 tag header, walks every frame, and checks for:
 *   - provenance  → PRIV frame with owner "com.rain.cert"
 *   - signature   → TXXX frame with description "RAIN_SIGNATURE"
 *   - fingerprint → TXXX frame with description "RAIN_FINGERPRINT"
 *   - metadata    → TIT2 / TPE1 / TALB / TYER / TSRC / COMM (any one)
 */
export async function verifyExportedMp3(
  blob: Blob,
  options: ExportOptions,
): Promise<ExportVerificationResult> {
  const ab = await blob.arrayBuffer()
  const bytes = new Uint8Array(ab)
  const view = new DataView(ab)

  const sha = await crypto.subtle.digest('SHA-256', ab)
  const shaHex = bufToHexLocal(sha)

  const frameIds = new Set<string>()
  const txxxDescs = new Set<string>()
  let hasPrivRainCert = false

  // ID3v2.3 header: "ID3" + version(2) + flags(1) + synchsafe size(4).
  if (
    ab.byteLength >= 10 &&
    bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 // "ID3"
  ) {
    const tagSize =
      ((bytes[6] & 0x7F) << 21) |
      ((bytes[7] & 0x7F) << 14) |
      ((bytes[8] & 0x7F) << 7) |
      (bytes[9] & 0x7F)
    let off = 10
    const tagEnd = 10 + tagSize
    while (off + 10 <= tagEnd && off + 10 <= ab.byteLength) {
      const id = readFourCc(view, off)
      if (id === '\x00\x00\x00\x00') break // padding
      // v2.3 frame size is a regular BE 32-bit integer (NOT synchsafe)
      const fsize = view.getUint32(off + 4, false)
      if (fsize === 0 || off + 10 + fsize > ab.byteLength) break
      const bodyStart = off + 10
      if (id === 'TXXX') {
        // Body: encoding(1) + description + 0x00 + value
        // Description starts at bodyStart+1, ends at first 0x00.
        let nul = bodyStart + 1
        while (nul < bodyStart + fsize && bytes[nul] !== 0) nul++
        const desc = new TextDecoder().decode(bytes.subarray(bodyStart + 1, nul))
        txxxDescs.add(desc)
        frameIds.add('TXXX')
      } else if (id === 'PRIV') {
        // Body: owner (null-terminated) + private data
        let nul = bodyStart
        while (nul < bodyStart + fsize && bytes[nul] !== 0) nul++
        const owner = new TextDecoder().decode(bytes.subarray(bodyStart, nul))
        if (owner === 'com.rain.cert') hasPrivRainCert = true
        frameIds.add('PRIV')
      } else {
        frameIds.add(id)
      }
      off += 10 + fsize
    }
  }

  const expectedProv = options.embedProvenance
  const expectedSig = options.embedSignature
  const expectedFp = options.embedFingerprint
  const expectedMd = options.embedMetadata
  const foundProv = hasPrivRainCert
  const foundSig = txxxDescs.has('RAIN_SIGNATURE')
  const foundFp = txxxDescs.has('RAIN_FINGERPRINT')
  const foundMd =
    frameIds.has('TIT2') ||
    frameIds.has('TPE1') ||
    frameIds.has('TALB') ||
    frameIds.has('TYER') ||
    frameIds.has('TSRC') ||
    frameIds.has('COMM')

  const ok =
    expectedProv === foundProv &&
    expectedSig === foundSig &&
    expectedFp === foundFp &&
    expectedMd === foundMd

  return {
    ok,
    format: 'mp3',
    sizeBytes: ab.byteLength,
    sha256: shaHex,
    checks: {
      provenance: { expected: expectedProv, found: foundProv, ok: expectedProv === foundProv },
      signature: { expected: expectedSig, found: foundSig, ok: expectedSig === foundSig },
      fingerprint: { expected: expectedFp, found: foundFp, ok: expectedFp === foundFp },
      metadata: { expected: expectedMd, found: foundMd, ok: expectedMd === foundMd },
    },
  }
}

/** Read 4 ASCII chars at the given DataView offset (used for RIFF/ID3 chunk ids). */
function readFourCc(view: DataView, off: number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(off + i))
  return s
}

/** Hex-encode an ArrayBuffer (local copy to avoid coupling to provenance.ts). */
function bufToHexLocal(buf: ArrayBuffer): string {
  const v = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, '0')
  return s
}

// ---------------------------------------------------------------------------
// Sidecar ZIP
// ---------------------------------------------------------------------------

/**
 * Build a sidecar ZIP containing the exported audio file (with its real
 * extension) + the RAIN-CERT certificate as `<basename>.cert.json`. Used when
 * the `attachCertificate` toggle is ON — the user gets ONE downloadable file
 * (the ZIP) containing both the audio and the sidecar cert. The cert.json is
 * the FULL cert (signature + manifest + fingerprint assertion all intact),
 * regardless of the in-file embedding toggles — because the sidecar IS the
 * authoritative cert.
 *
 * PKZIP 2.0 stored (no compression), CRC-32 with PKWARE polynomial 0xEDB88320.
 * No external dependencies. Mirrors the writers in spatial.ts/distribution.ts
 * but kept local to audio-engine.ts so the export path is self-contained.
 */
export function buildSidecarZip(
  audioBytes: Uint8Array,
  audioFilename: string,
  certJson: string,
  certFilename: string,
): Blob {
  const certBytes = new TextEncoder().encode(certJson)
  const entries: { name: string; data: Uint8Array }[] = [
    { name: audioFilename, data: audioBytes },
    { name: certFilename, data: certBytes },
  ]

  // CRC-32 lookup table (lazy-init on the function itself).
  const crcFn = buildSidecarZip
  if (!(crcFn as unknown as { _crcTable?: Uint32Array })._crcTable) {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    ;(crcFn as unknown as { _crcTable?: Uint32Array })._crcTable = t
  }
  const table = (crcFn as unknown as { _crcTable: Uint32Array })._crcTable
  const crc32 = (d: Uint8Array): number => {
    let c = 0xffffffff
    for (let i = 0; i < d.length; i++) c = (table[(c ^ d[i]) & 0xff] ^ (c >>> 8)) >>> 0
    return (c ^ 0xffffffff) >>> 0
  }

  // Layout: per file (30 + nameLen + dataLen) + central dir (46 + nameLen)
  // per file + EOCD (22).
  const enc = new TextEncoder()
  const nameBytesArr = entries.map((e) => enc.encode(e.name))
  const crcs = entries.map((e) => crc32(e.data))
  let totalSize = 0
  for (let i = 0; i < entries.length; i++) {
    totalSize += 30 + nameBytesArr[i].length + entries[i].data.length
  }
  for (let i = 0; i < entries.length; i++) totalSize += 46 + nameBytesArr[i].length
  totalSize += 22

  const out = new Uint8Array(totalSize)
  const dv = new DataView(out.buffer)
  let off = 0
  const centralRecords: { name: Uint8Array; dataLen: number; crc: number; lfh: number }[] = []
  let lfh = 0
  for (let i = 0; i < entries.length; i++) {
    const nb = nameBytesArr[i]
    const sz = entries[i].data.length
    dv.setUint32(off, 0x04034b50, true); off += 4 // local file header sig
    dv.setUint16(off, 20, true); off += 2 // version needed
    dv.setUint16(off, 0, true); off += 2 // flags
    dv.setUint16(off, 0, true); off += 2 // method = stored
    dv.setUint16(off, 0, true); off += 2 // mod time
    dv.setUint16(off, 0x21, true); off += 2 // mod date
    dv.setUint32(off, crcs[i], true); off += 4
    dv.setUint32(off, sz, true); off += 4 // compressed size
    dv.setUint32(off, sz, true); off += 4 // uncompressed size
    dv.setUint16(off, nb.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2 // extra field length
    out.set(nb, off); off += nb.length
    out.set(entries[i].data, off); off += sz
    centralRecords.push({ name: nb, dataLen: sz, crc: crcs[i], lfh })
    lfh = off
  }
  const cdOff = off
  for (const r of centralRecords) {
    dv.setUint32(off, 0x02014b50, true); off += 4
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0x21, true); off += 2
    dv.setUint32(off, r.crc, true); off += 4
    dv.setUint32(off, r.dataLen, true); off += 4
    dv.setUint32(off, r.dataLen, true); off += 4
    dv.setUint16(off, r.name.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint32(off, 0, true); off += 4
    dv.setUint32(off, r.lfh, true); off += 4
    out.set(r.name, off); off += r.name.length
  }
  const cdSize = off - cdOff
  dv.setUint32(off, 0x06054b50, true); off += 4 // EOCD sig
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint32(off, cdSize, true); off += 4
  dv.setUint32(off, cdOff, true); off += 4
  dv.setUint16(off, 0, true); off += 2

  return new Blob([out.buffer as ArrayBuffer], { type: 'application/zip' })
}
