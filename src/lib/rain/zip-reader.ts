'use client'

/**
 * RAIN V6 — Minimal PKZIP Reader (parse + extract)
 *
 * Parses a client-side .zip ArrayBuffer and extracts each file's raw bytes.
 * Supports:
 *   • End of Central Directory Record (EOCD) — including optional ZIP comment
 *   • Central Directory File Header(s)
 *   • Local File Header(s)
 *   • Compression method 0 (STORED) — pass-through
 *   • Compression method 8 (DEFLATE) — via native `DecompressionStream('deflate-raw')`
 *
 * Throws clear errors for unsupported methods (Deflate64/bzip2/etc.) and for
 * multi-disk archives (the project assumes single-disk zips — this is true for
 * every zip produced by DAWs, OS zip, 7-Zip default, WinRAR default, fflate,
 * JSZip, etc.).
 *
 * ─── PKZIP format references ───
 *   Local File Header signature       0x04034b50   (PK\x03\x04)
 *   Central Directory Header sig      0x02014b50   (PK\x01\x02)
 *   End of Central Directory Record   0x06054b50   (PK\x05\x06)
 *   EOCD is 22 bytes + comment (comment length is the last 2 bytes of the EOCD).
 *
 * See APPNOTE.TXT (PKWARE, 6.3.x) §4.3.6 / §4.3.12 / §4.3.16 for the
 * authoritative field layouts. All multi-byte integers are little-endian.
 *
 * NOTE: This module does NOT depend on `fflate` / `jszip` / `pako`. The only
 * runtime requirement is the Web `DecompressionStream` API (Chrome 80+,
 * Firefox 113+, Safari 16.4+, all major browser engines as of 2024). We use
 * `deflate-raw` (no zlib/zlib-gzip wrapper) because that is what method 8
 * stores inside a zip entry.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ZipEntry {
  /** Filename as stored in the central directory (UTF-8 by default; the
   *  general-purpose bit 11 flag is honoured as the modern convention). */
  filename: string
  /** Decompressed file bytes. */
  data: Uint8Array
  /** Compressed (stored) size in bytes. */
  compressedSize: number
  /** Decompressed size in bytes (=== data.length). */
  uncompressedSize: number
  /** PKZIP compression method (0 = STORED, 8 = DEFLATE). */
  method: number
}

// ---------------------------------------------------------------------------
// PKZIP signatures + header constants
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50 // End of Central Directory Record
const SIG_CENTRAL = 0x02014b50 // Central Directory File Header
const SIG_LOCAL = 0x04034b50 // Local File Header

/** Search window for the EOCD signature — the spec places the EOCD at the very
 *  end of the file, but a ZIP comment (up to 65535 bytes) can push it earlier.
 *  We scan the last 65557 bytes (22 + 65535) backwards for the signature. */
const MAX_ZIP_COMMENT = 0xffff
const EOCD_MIN_LEN = 22

// ---------------------------------------------------------------------------
// Helpers — little-endian readers
// ---------------------------------------------------------------------------

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}
function readUint32(view: DataView, offset: number): number {
  // getUint32 returns an unsigned 32-bit number — fine for files < 4 GiB.
  // (We deliberately do not implement ZIP64 here; a clear error is thrown
  //  below if any 0xFFFFFFFF marker is encountered.)
  return view.getUint32(offset, true)
}

// ---------------------------------------------------------------------------
// EOCD location — scan backwards from the end of the buffer
// ---------------------------------------------------------------------------

/**
 * Locate the End of Central Directory Record. Returns the byte offset of the
 * EOCD signature within `view`, or throws if not found.
 */
function findEocdOffset(view: DataView): number {
  const len = view.byteLength
  if (len < EOCD_MIN_LEN) {
    throw new Error('Not a ZIP file: file is smaller than the EOCD record (22 bytes)')
  }
  // Scan backwards from the last possible EOCD start position.
  const maxStart = len - EOCD_MIN_LEN
  const minStart = Math.max(0, len - (EOCD_MIN_LEN + MAX_ZIP_COMMENT))
  for (let off = maxStart; off >= minStart; off--) {
    if (view.getUint32(off, true) === SIG_EOCD) {
      return off
    }
  }
  throw new Error('Not a ZIP file: End of Central Directory signature not found')
}

// ---------------------------------------------------------------------------
// Decompression — DEFLATE via native DecompressionStream
// ---------------------------------------------------------------------------

/**
 * Inflate a DEFLATE-compressed payload using the native Web
 * `DecompressionStream('deflate-raw')` API. Streams the chunks asynchronously
 * and concatenates into a single Uint8Array.
 */
async function inflateDeflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  // Slice the underlying buffer so we don't leak a larger ArrayBuffer into the
  // stream (entry.data may be a view onto a shared zip ArrayBuffer).
  // Cast to ArrayBuffer works around a known TS variance issue with
  // Uint8Array<ArrayBufferLike> vs BufferSource<ArrayBuffer> — same pattern
  // used in distribution.ts:938 and audio-engine.ts:2653.
  const input: ArrayBuffer = compressed.byteOffset === 0 && compressed.byteLength === compressed.buffer.byteLength
    ? compressed.buffer as ArrayBuffer
    : compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not available in this browser — cannot inflate DEFLATE entries')
  }

  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  void writer.write(input)
  void writer.close()

  const chunks: Uint8Array[] = []
  let totalLen = 0
  const reader = ds.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLen += value.byteLength
  }
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract every file from a ZIP archive.
 *
 * @param buffer Raw bytes of the .zip file (ArrayBuffer).
 * @returns Array of entries (directories are filtered out).
 * @throws On corrupt headers, multi-disk archives, ZIP64 markers, or
 *         unsupported compression methods.
 */
export async function extractZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Empty ZIP buffer')
  }
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // ─── 1. Locate + parse the EOCD ────────────────────────────────────────
  const eocdOff = findEocdOffset(view)
  const diskNumber = readUint16(view, eocdOff + 4)
  const cdDisk = readUint16(view, eocdOff + 6)
  const cdEntriesOnDisk = readUint16(view, eocdOff + 8)
  const cdEntriesTotal = readUint16(view, eocdOff + 10)
  // 4-byte size/offset fields — checked for ZIP64 markers below.
  const cdSize = readUint32(view, eocdOff + 12)
  const cdOffset = readUint32(view, eocdOff + 16)
  const commentLen = readUint16(view, eocdOff + 20)

  if (diskNumber !== 0 || cdDisk !== 0) {
    throw new Error('Multi-disk ZIP archives are not supported (use a single-disk archive)')
  }
  if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF || cdEntriesTotal === 0xFFFF) {
    throw new Error('ZIP64 archives are not supported (archive is too large — keep stem zips under 4 GiB)')
  }
  // Sanity: the comment must not extend past EOF.
  if (eocdOff + EOCD_MIN_LEN + commentLen !== view.byteLength) {
    // Not fatal — some malformed zips exist in the wild — but warn.
    console.warn('[zip-reader] EOCD comment length does not match file size; parsing may be unreliable')
  }

  const entryCount = cdEntriesOnDisk !== cdEntriesTotal ? cdEntriesTotal : cdEntriesOnDisk
  if (entryCount === 0) {
    return []
  }

  // ─── 2. Walk the Central Directory ─────────────────────────────────────
  const entries: ZipEntry[] = []
  let cursor = cdOffset
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > view.byteLength) {
      throw new Error(`Corrupt ZIP: central directory entry ${i} truncated`)
    }
    if (readUint32(view, cursor) !== SIG_CENTRAL) {
      throw new Error(`Corrupt ZIP: expected central directory signature at offset ${cursor}, got 0x${readUint32(view, cursor).toString(16)}`)
    }

    // Central directory file header layout (APPNOTE.TXT §4.3.12)
    const method = readUint16(view, cursor + 10)
    const flags = readUint16(view, cursor + 8)
    const crc32 = readUint32(view, cursor + 16) // (unused here — we don't verify CRC, but available)
    const compressedSize = readUint32(view, cursor + 20)
    const uncompressedSize = readUint32(view, cursor + 24)
    const nameLen = readUint16(view, cursor + 28)
    const extraLen = readUint16(view, cursor + 30)
    const commentLenCd = readUint16(view, cursor + 32)
    const localHeaderOffset = readUint32(view, cursor + 42)

    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
      throw new Error('ZIP64 archives are not supported (entry sizes exceed 4 GiB)')
    }

    const nameStart = cursor + 46
    if (nameStart + nameLen > view.byteLength) {
      throw new Error(`Corrupt ZIP: entry ${i} filename extends past end of file`)
    }
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen)
    // Honour UTF-8 bit when set; default to UTF-8 with fatal:false so CP437
    // filenames degrade gracefully (lossy but non-throwing).
    const filename = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes)

    // Skip directory entries (filename ends with '/').
    const isDirectory = filename.endsWith('/')

    // Advance cursor past this central directory entry.
    cursor = nameStart + nameLen + extraLen + commentLenCd

    if (isDirectory) {
      void flags
      void crc32
      continue
    }

    // ─── 3. Read the Local File Header to find the file data ─────────────
    if (localHeaderOffset + 30 > view.byteLength) {
      throw new Error(`Corrupt ZIP: local header for "${filename}" out of bounds`)
    }
    if (readUint32(view, localHeaderOffset) !== SIG_LOCAL) {
      throw new Error(`Corrupt ZIP: expected local file header signature for "${filename}" at offset ${localHeaderOffset}`)
    }
    const localNameLen = readUint16(view, localHeaderOffset + 26)
    const localExtraLen = readUint16(view, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
    if (dataStart + compressedSize > view.byteLength) {
      throw new Error(`Corrupt ZIP: file data for "${filename}" extends past end of file`)
    }

    // Slice the compressed bytes (subarray = zero-copy view onto the zip buffer).
    const compressedPayload = bytes.subarray(dataStart, dataStart + compressedSize)

    let data: Uint8Array
    if (method === 0) {
      // STORED — payload == uncompressed bytes.
      if (compressedSize !== uncompressedSize) {
        throw new Error(`Corrupt ZIP: STORED entry "${filename}" has mismatched sizes (${compressedSize} vs ${uncompressedSize})`)
      }
      // Make a standalone copy so the caller doesn't accidentally hold onto the
      // entire zip ArrayBuffer via the Uint8Array view.
      data = new Uint8Array(compressedPayload)
    } else if (method === 8) {
      // DEFLATE — inflate via native Web stream.
      data = await inflateDeflateRaw(compressedPayload)
      if (data.byteLength !== uncompressedSize) {
        // Some old zips store uncompressed size = 0 when a data descriptor was
        // used. Tolerate that case (don't throw) — the inflated length is the
        // source of truth.
        if (uncompressedSize !== 0) {
          throw new Error(`Corrupt ZIP: inflated "${filename}" is ${data.byteLength} bytes but central directory claims ${uncompressedSize}`)
        }
      }
    } else if (method === 9) {
      throw new Error(`Unsupported ZIP compression method 9 (Deflate64) for "${filename}" — re-save the zip with standard DEFLATE`)
    } else if (method === 12) {
      throw new Error(`Unsupported ZIP compression method 12 (bzip2) for "${filename}" — re-save the zip with standard DEFLATE`)
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for "${filename}"`)
    }

    entries.push({
      filename,
      data,
      compressedSize,
      uncompressedSize: data.byteLength,
      method,
    })
  }

  return entries
}
