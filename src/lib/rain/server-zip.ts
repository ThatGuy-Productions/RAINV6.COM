/**
 * RAIN V6 — Minimal server-side ZIP writer (STORE / no-compression).
 *
 * Used by `GET /api/rain/source` to stream a real archive of the project
 * source code (src/, prisma/, config files) for the Enterprise "Download
 * Full Source ZIP" affordance in the Export tab.
 *
 * Why hand-rolled? No `archiver` / `jszip` dependency is allowed in this
 * stack, and the in-browser `buildSidecarZip` (audio-engine.ts) returns a
 * `Blob` so it can't run on the server. This is the same STORE-method ZIP
 * layout (local file headers + central directory + EOCD) adapted for
 * Node `Buffer` / `Uint8Array`.
 *
 * Conforms to APPNOTE.TXT 6.3.x: version-needed 20, method 0 (stored),
 * data-descriptor not used (sizes known up front), UTF-8 names via the
 * language-encoding flag (bit 11) when a name has non-ASCII bytes.
 */

export interface ZipFile {
  /** Path inside the archive, e.g. `src/app/page.tsx`. Use `/` separators. */
  name: string
  /** Raw file bytes. */
  data: Uint8Array
}

// CRC-32 (IEEE 802.3) lookup table — lazy-init on the module.
let CRC_TABLE: Uint32Array | null = null
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  CRC_TABLE = t
  return t
}

function crc32(data: Uint8Array): number {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = (table[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()

/** Build a ZIP archive (STORE method) from a list of files. Returns raw bytes. */
export function buildServerZip(files: ZipFile[]): Uint8Array {

  // Encode all names up front; detect UTF-8 flag.
  const meta = files.map((f) => {
    const nameBytes = enc.encode(f.name)
    const needsUtf8 = Array.from(nameBytes).some((b) => b >= 0x80)
    return {
      name: nameBytes,
      data: f.data,
      crc: crc32(f.data),
      utf8: needsUtf8 ? 1 : 0,
    }
  })

  // Pre-compute total size so we can allocate once.
  let totalSize = 0
  for (const m of meta) totalSize += 30 + m.name.length + m.data.length // local + data
  for (const m of meta) totalSize += 46 + m.name.length // central dir
  totalSize += 22 // EOCD

  const out = new Uint8Array(totalSize)
  const dv = new DataView(out.buffer)
  let off = 0

  // DOS date/time — 2025-01-01 00:00:00 is a safe fixed value.
  // (dosTime = 0, dosDate = 0x5421 = (2025-1980)<<9 | 1<<5 | 1)
  const DOS_TIME = 0x0000
  const DOS_DATE = 0x5421

  const central: { name: Uint8Array; dataLen: number; crc: number; utf8: number; lfhOffset: number }[] = []

  // 1) Local file headers + file data
  for (const m of meta) {
    const lfhOffset = off
    dv.setUint32(off, 0x04034b50, true); off += 4 // signature
    dv.setUint16(off, 20, true); off += 2 // version needed (2.0)
    dv.setUint16(off, 0x0800 & (m.utf8 ? 0x0800 : 0), true); off += 2 // flags (UTF-8 bit 11)
    dv.setUint16(off, 0, true); off += 2 // method = stored
    dv.setUint16(off, DOS_TIME, true); off += 2 // mod time
    dv.setUint16(off, DOS_DATE, true); off += 2 // mod date
    dv.setUint32(off, m.crc, true); off += 4 // crc-32
    dv.setUint32(off, m.data.length, true); off += 4 // compressed size
    dv.setUint32(off, m.data.length, true); off += 4 // uncompressed size
    dv.setUint16(off, m.name.length, true); off += 2 // name len
    dv.setUint16(off, 0, true); off += 2 // extra len
    out.set(m.name, off); off += m.name.length
    out.set(m.data, off); off += m.data.length
    central.push({
      name: m.name,
      dataLen: m.data.length,
      crc: m.crc,
      utf8: m.utf8,
      lfhOffset,
    })
  }

  // 2) Central directory records
  const cdStart = off
  for (const c of central) {
    dv.setUint32(off, 0x02014b50, true); off += 4 // central sig
    dv.setUint16(off, 20, true); off += 2 // version made by
    dv.setUint16(off, 20, true); off += 2 // version needed
    dv.setUint16(off, c.utf8 ? 0x0800 : 0, true); off += 2 // flags
    dv.setUint16(off, 0, true); off += 2 // method = stored
    dv.setUint16(off, DOS_TIME, true); off += 2 // mod time
    dv.setUint16(off, DOS_DATE, true); off += 2 // mod date
    dv.setUint32(off, c.crc, true); off += 4 // crc-32
    dv.setUint32(off, c.dataLen, true); off += 4 // compressed size
    dv.setUint32(off, c.dataLen, true); off += 4 // uncompressed size
    dv.setUint16(off, c.name.length, true); off += 2 // name len
    dv.setUint16(off, 0, true); off += 2 // extra len
    dv.setUint16(off, 0, true); off += 2 // comment len
    dv.setUint16(off, 0, true); off += 2 // disk number start
    dv.setUint16(off, 0, true); off += 2 // internal attrs
    dv.setUint32(off, 0, true); off += 4 // external attrs
    dv.setUint32(off, c.lfhOffset, true); off += 4 // local header offset
    out.set(c.name, off); off += c.name.length
  }
  const cdSize = off - cdStart

  // 3) End of central directory
  dv.setUint32(off, 0x06054b50, true); off += 4 // EOCD sig
  dv.setUint16(off, 0, true); off += 2 // disk number
  dv.setUint16(off, 0, true); off += 2 // disk with CD
  dv.setUint16(off, meta.length, true); off += 2 // entries on this disk
  dv.setUint16(off, meta.length, true); off += 2 // total entries
  dv.setUint32(off, cdSize, true); off += 4 // CD size
  dv.setUint32(off, cdStart, true); off += 4 // CD offset
  dv.setUint16(off, 0, true); off += 2 // comment len

  return out
}

// Reference the table so tree-shaking doesn't drop the lazy init side effect.
void crcTable
