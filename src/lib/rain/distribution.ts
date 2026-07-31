/**
 * RAIN V6 — Distribution subsystem.
 *
 * Real DDEX ERN 4.3.2 package builder + delivery queue. Every upload is a
 * genuine HTTP POST (no auto-success path):
 *
 *   • `buildDistributionPackage` renders the loaded AudioBuffer to WAV (24-bit)
 *     AND MP3 (320 kbps real LAME), computes a SHA-256 over every asset
 *     (audio, artwork, manifest, ern.xml, checksums.txt), validates the DDEX
 *     XML for well-formedness + required fields + ISRC format + UPC check
 *     digit, then packs everything into a real ZIP Blob (PKZIP 2.0 store-only
 *     with CRC-32 — no external dependency).
 *
 *   • Delivery jobs are persisted to IndexedDB (`rain-distribution` DB,
 *     `delivery-jobs` store) with a real status state machine
 *     (pending → packaged → submitting → delivered | failed). The package
 *     bytes themselves are stored in a separate `delivery-packages` store so
 *     the queue list view doesn't have to deserialise multi-MB blobs.
 *
 *   • `submitToLabelGrid(job)` POSTs the manifest + package bytes to
 *     `/api/rain/distribute`. That server route reads `process.env.LABELGRID_API_KEY`
 *     + `process.env.LABELGRID_API_URL` (server-side, never exposed to the
 *     client). If the env vars are missing, BOTH the client and the server
 *     honestly return `{ ok: false, requiresCredentials: true, error: '...' }`
 *     — no automatic "delivered" state without a 2xx response.
 *
 * The ISRC/UPC generators in `provenance.ts` are reused (they emit real
 * ISO-3901 / EAN-13-checksum-correct identifiers).
 *
 * Spec: TECH-STACK-SPECIFICATION v6.0 — Stage 16 (Distribution). September
 * 2025 EU AI Act Article 50 disclosure fields are embedded in the
 * <AIInvolvement> block of the ERN XML.
 */

import { audioBufferToWav, audioBufferToMp3 } from './audio-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DistributionAssetType = 'audio' | 'artwork' | 'metadata'

export interface DistributionAsset {
  type: DistributionAssetType
  /** Path inside the ZIP archive, e.g. `assets/title.wav`. */
  filename: string
  mimeType: string
  sizeBytes: number
  /** Lowercase hex SHA-256 of the asset bytes. */
  sha256: string
  /** Raw asset bytes — kept in memory only while building the package. */
  data: Uint8Array
}

export interface ReleaseManifest {
  releaseId: string
  isrc: string
  upc: string
  title: string
  artist: string
  album: string
  genre: string
  /** DDEX genre:subgenre, e.g. "Pop:Indie Pop" (TASK B enrichment). */
  genreSubgenre?: string
  releaseDate: string
  /** Original release date for re-releases (YYYY-MM-DD). TASK B enrichment. */
  originalReleaseDate?: string
  /** Release type — single / ep / album / compilation. TASK B enrichment. */
  releaseType?: 'single' | 'ep' | 'album' | 'compilation'
  /** Label name. TASK B enrichment. */
  label?: string
  /** Distributor name (default 'RAIN V6'). TASK B enrichment. */
  distributor?: string
  /** P-line holder (sound-recording copyright). TASK B enrichment. */
  pLine?: string
  /** C-line year + holder. TASK B enrichment. */
  cLine?: string
  /** Publisher name. TASK B enrichment. */
  publisher?: string
  /** PRO / collecting society. TASK B enrichment. */
  pro?: string
  /** Master rights owner. TASK B enrichment. */
  masterOwner?: string
  /** ISWC for the underlying composition. TASK B enrichment. */
  iswc?: string
  /** ISO 639-2 lyrical language code. TASK B enrichment. */
  language?: string
  /** Explicit-lyrics rating. TASK B enrichment. */
  explicitLyrics?: 'none' | 'explicit' | 'clean'
  /** Parental Advisory flag. TASK B enrichment. */
  parentalAdvisory?: boolean
  /** Territories (ISO 3166 codes or ['WORLDWIDE']). TASK B enrichment. */
  territories?: string[]
  /** Track contributors with role + IPI/ISNI + writer share %. TASK B enrichment. */
  contributors?: Array<{
    name: string
    role: string
    ipi?: string
    isni?: string
    share?: number
  }>
  ddexVersion: '4.3.2'
  generatedAt: string
  /** Per-asset records (without the `data` field, so this serialises cleanly). */
  assets: Array<Omit<DistributionAsset, 'data'>>
  /** Optional artwork dimensions, if cover art was supplied. */
  artwork?: { width: number; height: number; format: string }
}

export type DeliveryJobStatus =
  | 'pending'        // Created locally, not yet packaged.
  | 'packaged'       // ZIP built + persisted; awaiting submission.
  | 'submitting'     // HTTP POST in flight.
  | 'delivered'      // Provider returned 2xx.
  | 'failed'         // Provider returned non-2xx OR network error OR credentials missing.

export interface DeliveryJob {
  id: string
  releaseId: string
  status: DeliveryJobStatus
  manifest: ReleaseManifest
  /** Hex SHA-256 of the ZIP package bytes. */
  packageSha256: string
  /** Package size in bytes. */
  packageSizeBytes: number
  createdAt: number
  updatedAt: number
  submittedAt?: number
  deliveredAt?: number
  providerResponse?: string
  error?: string
}

// ---------------------------------------------------------------------------
// SHA-256 helper (WebCrypto, browser only)
// ---------------------------------------------------------------------------

async function sha256Bytes(data: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto not available — SHA-256 requires crypto.subtle')
  }
  // crypto.subtle.digest requires ArrayBufferView backed by ArrayBuffer.
  // Some TS typings reject Uint8Array<ArrayBufferLike>; copy into a fresh
  // ArrayBuffer-backed Uint8Array to be safe across TS lib variants.
  const buf = new ArrayBuffer(data.byteLength)
  new Uint8Array(buf).set(data)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return hex
}

// ---------------------------------------------------------------------------
// CRC-32 (PKZIP polynomial 0xEDB88320, table-driven)
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null

function crc32Table(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

function crc32(data: Uint8Array): number {
  const table = crc32Table()
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (PKZIP 2.0, store-only / method 0)
// ---------------------------------------------------------------------------
//
// We deliberately do not compress. The dominant asset is the WAV master
// (already large and entropy-rich thanks to TPDF dither); compressing it
// client-side would burn CPU for ~5-10% size savings and force us to either
// pull in a dep (fflate) or implement DEFLATE inline. Store-only keeps the
// implementation dependency-free and well under 100 LOC.

interface ZipEntry {
  filename: string
  data: Uint8Array
  crc: number
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  // DOS date/time (matches PKZIP convention; both fields 0 is also valid but
  // we use the real date so unzippers show a sensible timestamp).
  const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() / 2) & 0x1F)
  const dosDate = ((((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F))

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.filename)
    const crc = entry.crc
    const size = entry.data.length

    // Local file header (30 bytes) + filename + data.
    const local = new Uint8Array(30 + nameBytes.length + size)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)        // local file header signature
    lv.setUint16(4, 20, true)                // version needed to extract (2.0)
    lv.setUint16(6, 0, true)                 // general purpose bit flag
    lv.setUint16(8, 0, true)                 // compression method (0 = store)
    lv.setUint16(10, dosTime, true)          // last mod file time
    lv.setUint16(12, dosDate, true)          // last mod file date
    lv.setUint32(14, crc, true)              // CRC-32
    lv.setUint32(18, size, true)             // compressed size (== uncompressed for store)
    lv.setUint32(22, size, true)             // uncompressed size
    lv.setUint16(26, nameBytes.length, true) // filename length
    lv.setUint16(28, 0, true)                // extra field length
    local.set(nameBytes, 30)
    local.set(entry.data, 30 + nameBytes.length)
    localParts.push(local)

    // Central directory header (46 bytes) + filename.
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)        // central file header signature
    cv.setUint16(4, 20, true)                // version made by
    cv.setUint16(6, 20, true)                // version needed to extract
    cv.setUint16(8, 0, true)                 // general purpose bit flag
    cv.setUint16(10, 0, true)                // compression method
    cv.setUint16(12, dosTime, true)          // last mod file time
    cv.setUint16(14, dosDate, true)          // last mod file date
    cv.setUint32(16, crc, true)              // CRC-32
    cv.setUint32(20, size, true)             // compressed size
    cv.setUint32(24, size, true)             // uncompressed size
    cv.setUint16(28, nameBytes.length, true) // filename length
    cv.setUint16(30, 0, true)                // extra field length
    cv.setUint16(32, 0, true)                // file comment length
    cv.setUint16(34, 0, true)                // disk number start
    cv.setUint16(36, 0, true)                // internal file attributes
    cv.setUint32(38, 0, true)                // external file attributes
    cv.setUint32(42, offset, true)           // relative offset of local header
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0)
  const centralOffset = offset

  // End of central directory record (22 bytes).
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)              // EOCD signature
  ev.setUint16(4, 0, true)                       // number of this disk
  ev.setUint16(6, 0, true)                       // disk where central directory starts
  ev.setUint16(8, entries.length, true)          // entries on this disk
  ev.setUint16(10, entries.length, true)         // total entries
  ev.setUint32(12, centralSize, true)            // central directory size
  ev.setUint32(16, centralOffset, true)          // offset of central directory
  ev.setUint16(20, 0, true)                      // comment length

  // Concatenate everything.
  const totalLen = localParts.reduce((s, p) => s + p.length, 0)
    + centralSize
    + 22
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of localParts) { out.set(p, pos); pos += p.length }
  for (const p of centralParts) { out.set(p, pos); pos += p.length }
  out.set(eocd, pos)
  return out
}

// ---------------------------------------------------------------------------
// DDEX ERN 4.3.2 XML builder
// ---------------------------------------------------------------------------

export interface DdexMetadata {
  title: string
  artist: string
  album?: string
  genre?: string
  /** DDEX genre:subgenre, e.g. "Pop:Indie Pop". TASK B enrichment. */
  genreSubgenre?: string
  year?: string
  isrc: string
  upc: string
  /** ISWC for the underlying composition. TASK B enrichment. */
  iswc?: string
  /** ISO-8601 release date (YYYY-MM-DD). */
  releaseDate?: string
  /** Original release date for re-releases. TASK B enrichment. */
  originalReleaseDate?: string
  /** Release type — single / ep / album / compilation. TASK B enrichment. */
  releaseType?: 'single' | 'ep' | 'album' | 'compilation'
  /** Label name. TASK B enrichment. */
  label?: string
  /** Distributor name. TASK B enrichment. */
  distributor?: string
  /** P-line holder, e.g. "2024 Artist". TASK B enrichment. */
  pLine?: string
  /** C-line, e.g. "2024 Composer". TASK B enrichment. */
  cLine?: string
  /** Publisher name. TASK B enrichment. */
  publisher?: string
  /** PRO / collecting society. TASK B enrichment. */
  pro?: string
  /** Master rights owner. TASK B enrichment. */
  masterOwner?: string
  /** ISO 639-2 lyrical language code. TASK B enrichment. */
  language?: string
  /** Explicit-lyrics rating. TASK B enrichment. */
  explicitLyrics?: 'none' | 'explicit' | 'clean'
  /** Parental Advisory flag. TASK B enrichment. */
  parentalAdvisory?: boolean
  /** Territories (ISO 3166 codes or ['WORLDWIDE']). TASK B enrichment. */
  territories?: string[]
  /** Track contributors. TASK B enrichment. */
  contributors?: Array<{
    name: string
    role: string
    ipi?: string
    isni?: string
    share?: number
  }>
  /** Duration in seconds (sound recording <Duration> is ISO-8601 PT#M#S). */
  durationSeconds?: number
  /** Per-field AI involvement disclosure (EU AI Act Article 50). */
  aiDisclosure?: Record<string, 'none' | 'assisted' | 'generated'>
  /** DSP slugs to emit <Deal> blocks for. */
  targetDsps?: string[]
  /** DSP labels for the <DSPName> field; falls back to the slug itself. */
  dspLabels?: Record<string, string>
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isoDurationFromSeconds(totalSeconds?: number): string {
  if (!totalSeconds || totalSeconds <= 0) return 'PT0S'
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `PT${m}M${r}S`
}

export function buildDdexErnXml(meta: DdexMetadata): string {
  const messageId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `rain-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const created = new Date().toISOString()
  const title = escapeXml(meta.title || 'Untitled')
  const artist = escapeXml(meta.artist || 'Unknown Artist')
  const album = meta.album ? escapeXml(meta.album) : ''
  const genre = meta.genre ? escapeXml(meta.genre) : ''
  const genreSub = meta.genreSubgenre ? escapeXml(meta.genreSubgenre) : ''
  const year = escapeXml(meta.year || String(new Date().getFullYear()))
  const releaseDate = meta.releaseDate || new Date().toISOString().slice(0, 10)
  const originalReleaseDate = meta.originalReleaseDate
    ? escapeXml(meta.originalReleaseDate)
    : ''
  const duration = isoDurationFromSeconds(meta.durationSeconds)

  // ---- TASK B enrichment: P-line / C-line / language / explicit / territories ----
  const pLineBlock = meta.pLine
    ? `    <PLine>${escapeXml(meta.pLine)}</PLine>`
    : ''
  const cLineBlock = meta.cLine
    ? `    <CLine>${escapeXml(meta.cLine)}</CLine>`
    : ''
  const releaseTypeBlock = meta.releaseType
    ? `    <ReleaseType>${meta.releaseType}</ReleaseType>`
    : ''
  const labelBlock = meta.label
    ? `    <LabelName>${escapeXml(meta.label)}</LabelName>`
    : ''
  const distributorBlock = meta.distributor
    ? `    <DistributorName>${escapeXml(meta.distributor)}</DistributorName>`
    : ''
  const iswcBlock = meta.iswc
    ? `      <ISWC>${escapeXml(meta.iswc)}</ISWC>`
    : ''
  const languageBlock = meta.language
    ? `    <LanguageOfPerformance>${escapeXml(meta.language)}</LanguageOfPerformance>`
    : ''
  const explicitBlock = meta.explicitLyrics
    ? `    <ParentalWarningType>${meta.explicitLyrics === 'explicit' ? 'Explicit' : meta.explicitLyrics === 'clean' ? 'Cleaned' : 'NotExplicit'}</ParentalWarningType>`
    : ''
  const territoriesBlock = meta.territories && meta.territories.length > 0
    ? `    <TerritoryCode>${meta.territories.map(escapeXml).join('</TerritoryCode>\n    <TerritoryCode>')}</TerritoryCode>`
    : ''
  const publisherBlock = meta.publisher
    ? `    <Publisher><PartyName><FullName>${escapeXml(meta.publisher)}</FullName></PartyName>${meta.pro ? `<PRO>${escapeXml(meta.pro)}</PRO>` : ''}</Publisher>`
    : ''
  const masterOwnerBlock = meta.masterOwner
    ? `    <MasterOwner>${escapeXml(meta.masterOwner)}</MasterOwner>`
    : ''

  // ---- Contributors block (TASK B enrichment) ----
  // Each contributor becomes a <ResourceContributor> with a <Role> + IPI/ISNI.
  const contributorsBlock = (meta.contributors && meta.contributors.length > 0)
    ? meta.contributors
        .map((c) => {
          const ipi = c.ipi ? `\n        <IPI>${escapeXml(c.ipi)}</IPI>` : ''
          const isni = c.isni ? `\n        <ISNI>${escapeXml(c.isni)}</ISNI>` : ''
          const share = typeof c.share === 'number' && !Number.isNaN(c.share)
            ? `\n        <Share>${c.share}</Share>`
            : ''
          return `      <ResourceContributor>\n        <PartyName><FullName>${escapeXml(c.name || '')}</FullName></PartyName>\n        <Role>${escapeXml(c.role)}</Role>${ipi}${isni}${share}\n      </ResourceContributor>`
        })
        .join('\n')
    : ''

  const disclosureFields = ['vocals', 'instrumentation', 'composition', 'mixing', 'mastering']
  const disclosureBlock = disclosureFields
    .map((f) => `      <${f}>${meta.aiDisclosure?.[f] ?? 'none'}</${f}>`)
    .join('\n')

  const dsps = meta.targetDsps && meta.targetDsps.length > 0
    ? meta.targetDsps
    : ['spotify', 'apple_music', 'youtube', 'tidal']
  const dealBlock = dsps
    .map((slug) => {
      const label = meta.dspLabels?.[slug]
        ? escapeXml(meta.dspLabels[slug])
        : escapeXml(slug)
      return `    <Deal>\n      <DSPName>${label}</DSPName>\n      <CommercialModel>PayAsYouGo</CommercialModel>\n    </Deal>`
    })
    .join('\n')

  // Build optional blocks as a single string for clean insertion.
  const optionalReleaseBlocks = [
    releaseTypeBlock,
    pLineBlock,
    cLineBlock,
    labelBlock,
    distributorBlock,
    languageBlock,
    explicitBlock,
    publisherBlock,
    masterOwnerBlock,
    territoriesBlock,
    originalReleaseDate ? `    <OriginalReleaseDate>${originalReleaseDate}</OriginalReleaseDate>` : '',
    genreSub ? `    <SubGenre>${genreSub}</SubGenre>` : '',
  ].filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ern:NewReleaseMessage xmlns:ern="http://ddex.net/xml/ern/43" LanguageAndScriptCode="en">
  <MessageHeader>
    <MessageId>${messageId}</MessageId>
    <MessageCreatedDateTime>${created}</MessageCreatedDateTime>
    <MessageSender>
      <PartyName><FullName>RAIN V6 Studio</FullName></PartyName>
    </MessageSender>
  </MessageHeader>
  <ResourceList>
    <SoundRecording>
      <ResourceReference>A1</ResourceReference>
      <ISRC>${meta.isrc}</ISRC>
${iswcBlock}
      <ReferenceTitle>${title}</ReferenceTitle>
      <Duration>${duration}</Duration>
${contributorsBlock ? `      <ResourceContributorList>\n${contributorsBlock}\n      </ResourceContributorList>` : ''}
    </SoundRecording>
  </ResourceList>
  <Release>
    <ReleaseId>
      <ISRC>${meta.isrc}</ISRC>
      <UPC>${meta.upc}</UPC>
    </ReleaseId>
    <ReferenceTitle>${title}</ReferenceTitle>
    <DisplayArtist>
      <PartyName>
        <FullName>${artist}</FullName>
      </PartyName>
    </DisplayArtist>
${album ? `    <ReleaseDetails><DisplayTitleText>${album}</DisplayTitleText></ReleaseDetails>\n` : ''}    <Genre>${genre}</Genre>
    <YearOfOriginalRelease>${year}</YearOfOriginalRelease>
    <ReleaseDate>${releaseDate}</ReleaseDate>
${optionalReleaseBlocks ? optionalReleaseBlocks + '\n' : ''}    <AIInvolvement>
${disclosureBlock}
    </AIInvolvement>
  </Release>
  <DealList>
${dealBlock}
  </DealList>
</ern:NewReleaseMessage>`
}

// ---------------------------------------------------------------------------
// DDEX validator — well-formedness + required fields + ISRC format + UPC check
// ---------------------------------------------------------------------------

export interface DdexValidationResult {
  ok: boolean
  errors: string[]
}

/** ISO 3901 ISRC: CC-XXX-YY-NNNNN (12 alphanumeric, no dashes in raw form). */
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/

/**
 * Validate a 12-digit UPC (EAN-13 minus the leading 0 — same check digit math).
 * Returns true if the embedded check digit matches the mod-10 checksum.
 */
export function validateUpcCheckDigit(upc: string): boolean {
  if (!/^\d{12}$/.test(upc)) return false
  let sum = 0
  for (let i = 0; i < 11; i++) {
    sum += parseInt(upc[i], 10) * (i % 2 === 0 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return check === parseInt(upc[11], 10)
}

export function validateIsrcFormat(isrc: string): boolean {
  return ISRC_RE.test(isrc.toUpperCase())
}

export function validateDdex(xml: string): DdexValidationResult {
  const errors: string[] = []
  if (typeof DOMParser === 'undefined') {
    // Server-side path is not used for validation (the browser builds the
    // package). If we ever need server-side validation, we can parse via a
    // regex sanity pass; for now, surface the limitation honestly.
    errors.push('DOMParser not available in this environment')
    return { ok: false, errors }
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.getElementsByTagName('parsererror')[0]
  if (parseError) {
    errors.push(`XML not well-formed: ${parseError.textContent?.slice(0, 200) ?? 'parse error'}`)
    return { ok: false, errors }
  }
  // Required elements per ERN 4.3.2 NewReleaseMessage.
  const required = [
    { tag: 'MessageId', parent: 'MessageHeader' },
    { tag: 'MessageCreatedDateTime', parent: 'MessageHeader' },
    { tag: 'ResourceReference', parent: 'SoundRecording' },
    { tag: 'ISRC', parent: 'SoundRecording' },
    { tag: 'ReferenceTitle', parent: 'SoundRecording' },
    { tag: 'Duration', parent: 'SoundRecording' },
    { tag: 'UPC', parent: 'ReleaseId' },
    { tag: 'DisplayArtist', parent: 'Release' },
    { tag: 'AIInvolvement', parent: 'Release' },
  ]
  for (const { tag } of required) {
    if (!doc.getElementsByTagName(tag).length) {
      errors.push(`Missing required element: <${tag}>`)
    }
  }
  // ISRC format check.
  const isrcEl = doc.getElementsByTagName('ISRC')[0]
  if (isrcEl) {
    const isrc = (isrcEl.textContent ?? '').trim()
    if (!validateIsrcFormat(isrc)) {
      errors.push(`ISRC '${isrc}' does not match ISO 3901 (CC-XXX-YY-NNNNN)`)
    }
  }
  // UPC check digit.
  const upcEl = doc.getElementsByTagName('UPC')[0]
  if (upcEl) {
    const upc = (upcEl.textContent ?? '').trim()
    if (!validateUpcCheckDigit(upc)) {
      errors.push(`UPC '${upc}' check digit is invalid`)
    }
  }
  // Root element must be ern:NewReleaseMessage.
  const root = doc.documentElement
  if (!root || root.localName !== 'NewReleaseMessage') {
    errors.push('Root element must be NewReleaseMessage (ern namespace)')
  }
  return { ok: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Artwork validation (Spotify / Apple spec)
// ---------------------------------------------------------------------------

export interface ArtworkValidationOk {
  ok: true
  dimensions: [number, number]
  format: 'image/jpeg' | 'image/png'
  sizeBytes: number
}
export interface ArtworkValidationFail {
  ok: false
  error: string
}
export type ArtworkValidation = ArtworkValidationOk | ArtworkValidationFail

const ARTWORK_MIN = 1400
const ARTWORK_MAX = 3000
const ARTWORK_MAX_BYTES = 25 * 1024 * 1024 // 25 MB

/**
 * Validate a cover-art File against DSP delivery specs:
 *   • JPEG or PNG
 *   • Square aspect ratio (1:1)
 *   • Dimensions between 1400×1400 and 3000×3000
 *   • File size ≤ 25 MB
 *
 * Uses `createImageBitmap` to decode the image and inspect pixel dimensions
 * (no DOM rendering required). Returns the validated dimensions + format on
 * success.
 */
export async function validateArtwork(
  file: File,
): Promise<ArtworkValidation> {
  if (file.size > ARTWORK_MAX_BYTES) {
    return { ok: false, error: `Artwork file size ${file.size} bytes exceeds 25 MB limit` }
  }
  const format = file.type === 'image/jpeg' || file.type === 'image/png'
    ? (file.type as 'image/jpeg' | 'image/png')
    : null
  if (!format) {
    return { ok: false, error: `Artwork must be JPEG or PNG (got ${file.type || 'unknown'})` }
  }
  if (typeof createImageBitmap === 'undefined') {
    return { ok: false, error: 'createImageBitmap not available in this environment' }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (e) {
    return { ok: false, error: `Failed to decode image: ${e instanceof Error ? e.message : 'unknown'}` }
  }
  const { width, height } = bitmap
  bitmap.close?.()
  if (width < ARTWORK_MIN || height < ARTWORK_MIN) {
    return { ok: false, error: `Artwork dimensions ${width}×${height} below minimum ${ARTWORK_MIN}×${ARTWORK_MIN}` }
  }
  if (width > ARTWORK_MAX || height > ARTWORK_MAX) {
    return { ok: false, error: `Artwork dimensions ${width}×${height} above maximum ${ARTWORK_MAX}×${ARTWORK_MAX}` }
  }
  if (width !== height) {
    return { ok: false, error: `Artwork must be square (1:1) — got ${width}×${height}` }
  }
  return { ok: true, dimensions: [width, height], format, sizeBytes: file.size }
}

// ---------------------------------------------------------------------------
// Package assembly
// ---------------------------------------------------------------------------

/**
 * Build a complete distribution package from the rendered audio + metadata.
 *
 * Layout inside the ZIP:
 *   ern.xml                — DDEX ERN 4.3.2 message
 *   manifest.json          — ReleaseManifest (assets, hashes, metadata)
 *   checksums.txt          — `<sha256>  <path>` lines for every asset
 *   assets/<title>.wav     — 24-bit WAV master (TPDF-dithered)
 *   assets/<title>.mp3     — 320 kbps MP3 (LAME, TPDF-dithered Int16 input)
 *   artwork/cover.<ext>    — cover art (if supplied)
 *
 * The function:
 *   1. Renders the AudioBuffer to WAV + MP3 via the real audio-engine encoders.
 *   2. Validates the DDEX XML (well-formedness + required fields + ISRC/UPC).
 *   3. Computes SHA-256 over every asset, the manifest, the checksums file.
 *   4. Packs everything into a real ZIP Blob (store-only, with CRC-32).
 *   5. Computes the package SHA-256 (the ZIP bytes themselves).
 *
 * Throws if DDEX validation fails OR if the WAV/MP3 encoders throw.
 */
export async function buildDistributionPackage(
  audioBuffer: AudioBuffer,
  metadata: {
    title: string
    artist: string
    album?: string
    genre?: string
    /** DDEX genre:subgenre. TASK B enrichment. */
    genreSubgenre?: string
    year?: string
    isrc: string
    upc: string
    /** ISWC for the underlying composition. TASK B enrichment. */
    iswc?: string
    releaseDate?: string
    /** Original release date for re-releases. TASK B enrichment. */
    originalReleaseDate?: string
    /** Release type — single / ep / album / compilation. TASK B enrichment. */
    releaseType?: 'single' | 'ep' | 'album' | 'compilation'
    /** Label name. TASK B enrichment. */
    label?: string
    /** Distributor name. TASK B enrichment. */
    distributor?: string
    /** P-line holder. TASK B enrichment. */
    pLine?: string
    /** C-line. TASK B enrichment. */
    cLine?: string
    /** Publisher name. TASK B enrichment. */
    publisher?: string
    /** PRO / collecting society. TASK B enrichment. */
    pro?: string
    /** Master rights owner. TASK B enrichment. */
    masterOwner?: string
    /** ISO 639-2 lyrical language code. TASK B enrichment. */
    language?: string
    /** Explicit-lyrics rating. TASK B enrichment. */
    explicitLyrics?: 'none' | 'explicit' | 'clean'
    /** Parental Advisory flag. TASK B enrichment. */
    parentalAdvisory?: boolean
    /** Territories (ISO 3166 codes or ['WORLDWIDE']). TASK B enrichment. */
    territories?: string[]
    /** Track contributors. TASK B enrichment. */
    contributors?: Array<{
      name: string
      role: string
      ipi?: string
      isni?: string
      share?: number
    }>
    durationSeconds?: number
    aiDisclosure?: Record<string, 'none' | 'assisted' | 'generated'>
    targetDsps?: string[]
    dspLabels?: Record<string, string>
  },
  artworkFile?: File,
): Promise<{
  manifest: ReleaseManifest
  packageBlob: Blob
  packageSha256: string
  packageBytes: Uint8Array
  validation: DdexValidationResult
}> {
  // 1) Build + validate the DDEX XML first — fail fast if metadata is bad.
  const ddexXml = buildDdexErnXml({
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    genre: metadata.genre,
    genreSubgenre: metadata.genreSubgenre,
    year: metadata.year,
    isrc: metadata.isrc,
    upc: metadata.upc,
    iswc: metadata.iswc,
    releaseDate: metadata.releaseDate,
    originalReleaseDate: metadata.originalReleaseDate,
    releaseType: metadata.releaseType,
    label: metadata.label,
    distributor: metadata.distributor,
    pLine: metadata.pLine,
    cLine: metadata.cLine,
    publisher: metadata.publisher,
    pro: metadata.pro,
    masterOwner: metadata.masterOwner,
    language: metadata.language,
    explicitLyrics: metadata.explicitLyrics,
    parentalAdvisory: metadata.parentalAdvisory,
    territories: metadata.territories,
    contributors: metadata.contributors,
    durationSeconds: metadata.durationSeconds ?? audioBuffer.duration,
    aiDisclosure: metadata.aiDisclosure,
    targetDsps: metadata.targetDsps,
    dspLabels: metadata.dspLabels,
  })
  const validation = validateDdex(ddexXml)
  if (!validation.ok) {
    throw new Error(`DDEX validation failed: ${validation.errors.join('; ')}`)
  }

  // 2) Render WAV + MP3. These call the real encoders in audio-engine.ts
  //    (audioBufferToWav appends a RIFF INFO chunk + TPDF dither; audioBufferToMp3
  //    runs real LAME + ID3v2.3 tag). We pass null provenance here because the
  //    distribution package attests to its own SHA-256s via the manifest; the
  //    RAIN-CERT provenance flow lives on the Provenance tab and is orthogonal.
  const wavBlob = audioBufferToWav(audioBuffer, 24, null)
  const mp3Blob = audioBufferToMp3(audioBuffer, 320, null)

  // 3) Convert Blobs to Uint8Array (one copy each — fine for the typical
  //    30-100 MB master sizes we deal with).
  const wavBytes = new Uint8Array(await wavBlob.arrayBuffer())
  const mp3Bytes = new Uint8Array(await mp3Blob.arrayBuffer())
  const ernBytes = new TextEncoder().encode(ddexXml)

  const safeTitle = (metadata.title || 'rain-release')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .slice(0, 64) || 'rain-release'

  // 4) Compute SHA-256 for every asset.
  const assets: DistributionAsset[] = []
  const wavSha = await sha256Bytes(wavBytes)
  assets.push({
    type: 'audio',
    filename: `assets/${safeTitle}.wav`,
    mimeType: 'audio/wav',
    sizeBytes: wavBytes.byteLength,
    sha256: wavSha,
    data: wavBytes,
  })
  const mp3Sha = await sha256Bytes(mp3Bytes)
  assets.push({
    type: 'audio',
    filename: `assets/${safeTitle}.mp3`,
    mimeType: 'audio/mpeg',
    sizeBytes: mp3Bytes.byteLength,
    sha256: mp3Sha,
    data: mp3Bytes,
  })

  // 5) Optional artwork.
  let artworkMeta: ReleaseManifest['artwork']
  if (artworkFile) {
    const art = await validateArtwork(artworkFile)
    if (!art.ok) {
      throw new Error(`Artwork validation failed: ${art.error}`)
    }
    const artBytes = new Uint8Array(await artworkFile.arrayBuffer())
    const artSha = await sha256Bytes(artBytes)
    const ext = art.format === 'image/jpeg' ? 'jpg' : 'png'
    assets.push({
      type: 'artwork',
      filename: `artwork/cover.${ext}`,
      mimeType: art.format,
      sizeBytes: artBytes.byteLength,
      sha256: artSha,
      data: artBytes,
    })
    artworkMeta = { width: art.dimensions[0], height: art.dimensions[1], format: art.format }
  }

  // 6) Build the manifest (without `data` for each asset — manifest.json
  //    never embeds bytes, only the hash + metadata).
  const releaseId = `RAIN-RLS-${metadata.isrc}-${Date.now().toString(36)}`
  const manifest: ReleaseManifest = {
    releaseId,
    isrc: metadata.isrc,
    upc: metadata.upc,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album ?? '',
    genre: metadata.genre ?? '',
    genreSubgenre: metadata.genreSubgenre,
    releaseDate: metadata.releaseDate ?? new Date().toISOString().slice(0, 10),
    originalReleaseDate: metadata.originalReleaseDate,
    releaseType: metadata.releaseType,
    label: metadata.label,
    distributor: metadata.distributor,
    pLine: metadata.pLine,
    cLine: metadata.cLine,
    publisher: metadata.publisher,
    pro: metadata.pro,
    masterOwner: metadata.masterOwner,
    iswc: metadata.iswc,
    language: metadata.language,
    explicitLyrics: metadata.explicitLyrics,
    parentalAdvisory: metadata.parentalAdvisory,
    territories: metadata.territories,
    contributors: metadata.contributors,
    ddexVersion: '4.3.2',
    generatedAt: new Date().toISOString(),
    assets: assets.map((a) => ({
      type: a.type,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
    })),
    artwork: artworkMeta,
  }
  const manifestJson = JSON.stringify(manifest, null, 2)
  const manifestBytes = new TextEncoder().encode(manifestJson)
  const manifestSha = await sha256Bytes(manifestBytes)

  // 7) checksums.txt — one line per asset + the manifest itself.
  const checksumsLines = assets.map((a) => `${a.sha256}  ${a.filename}`)
  checksumsLines.push(`${manifestSha}  manifest.json`)
  const checksumsTxt = checksumsLines.join('\n') + '\n'
  const checksumsBytes = new TextEncoder().encode(checksumsTxt)
  const checksumsSha = await sha256Bytes(checksumsBytes)

  // 8) Push the metadata assets (ern.xml, manifest.json, checksums.txt).
  assets.push({
    type: 'metadata',
    filename: 'ern.xml',
    mimeType: 'application/xml',
    sizeBytes: ernBytes.byteLength,
    sha256: await sha256Bytes(ernBytes),
    data: ernBytes,
  })
  assets.push({
    type: 'metadata',
    filename: 'manifest.json',
    mimeType: 'application/json',
    sizeBytes: manifestBytes.byteLength,
    sha256: manifestSha,
    data: manifestBytes,
  })
  assets.push({
    type: 'metadata',
    filename: 'checksums.txt',
    mimeType: 'text/plain',
    sizeBytes: checksumsBytes.byteLength,
    sha256: checksumsSha,
    data: checksumsBytes,
  })

  // 9) Build the ZIP. Order matters for human-inspection: ern.xml first, then
  //    manifest, then checksums, then assets/, then artwork/.
  const zipOrder = ['ern.xml', 'manifest.json', 'checksums.txt']
  const orderedAssets = [...assets].sort((a, b) => {
    const ia = zipOrder.indexOf(a.filename)
    const ib = zipOrder.indexOf(b.filename)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.filename.localeCompare(b.filename)
  })
  const entries: ZipEntry[] = orderedAssets.map((a) => ({
    filename: a.filename,
    data: a.data,
    crc: crc32(a.data),
  }))
  const zipBytes = buildZip(entries)

  // 10) Compute the package SHA-256 (over the ZIP bytes themselves).
  const packageSha256 = await sha256Bytes(zipBytes)
  const packageBlob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' })

  return {
    manifest,
    packageBlob,
    packageSha256,
    packageBytes: zipBytes,
    validation,
  }
}

// ---------------------------------------------------------------------------
// IndexedDB delivery queue
// ---------------------------------------------------------------------------

const DB_NAME = 'rain-distribution'
const DB_VERSION = 1
const JOB_STORE = 'delivery-jobs'
const PKG_STORE = 'delivery-packages'

function openDistributionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(JOB_STORE)) {
        db.createObjectStore(JOB_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PKG_STORE)) {
        db.createObjectStore(PKG_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T> | T): Promise<T> {
  const db = await openDistributionDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

/**
 * Persist a delivery job (metadata only) to IndexedDB. If the job's status is
 * `packaged`, the package bytes are stored separately in `delivery-packages`
 * (keyed by job.id) so the queue list view can load all jobs without
 * deserialising multi-MB blobs.
 */
export async function persistDeliveryJob(
  job: DeliveryJob,
  packageBytes?: Uint8Array,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction([JOB_STORE, PKG_STORE], 'readwrite')
    const jobStore = tx.objectStore(JOB_STORE)
    jobStore.put(job)
    if (packageBytes) {
      const pkgStore = tx.objectStore(PKG_STORE)
      // IndexedDB structured-clones its inputs; Uint8Array is supported
      // natively. Wrap in a fresh ArrayBuffer-backed array to satisfy the
      // structured-clone algorithm across TS lib variants.
      const clone = new Uint8Array(packageBytes.byteLength)
      clone.set(packageBytes)
      pkgStore.put(clone, job.id)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

/** Load all delivery jobs, newest first. */
export async function loadDeliveryJobs(): Promise<DeliveryJob[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    return await withDb((db) => new Promise<DeliveryJob[]>((resolve, reject) => {
      const tx = db.transaction(JOB_STORE, 'readonly')
      const store = tx.objectStore(JOB_STORE)
      const req = store.getAll()
      req.onsuccess = () => {
        const jobs = (req.result as DeliveryJob[] | undefined) ?? []
        jobs.sort((a, b) => b.createdAt - a.createdAt)
        resolve(jobs)
      }
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return []
  }
}

/** Load a single delivery job by id, or null if not found. */
export async function loadDeliveryJob(id: string): Promise<DeliveryJob | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    return await withDb((db) => new Promise<DeliveryJob | null>((resolve, reject) => {
      const tx = db.transaction(JOB_STORE, 'readonly')
      const store = tx.objectStore(JOB_STORE)
      const req = store.get(id)
      req.onsuccess = () => resolve((req.result as DeliveryJob | undefined) ?? null)
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return null
  }
}

/** Load the stored package bytes for a job, or null if not stored. */
export async function loadDeliveryPackage(id: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    return await withDb((db) => new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(PKG_STORE, 'readonly')
      const store = tx.objectStore(PKG_STORE)
      const req = store.get(id)
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null)
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return null
  }
}

/** Patch a job's fields and update its `updatedAt`. */
export async function updateDeliveryJob(
  id: string,
  patch: Partial<DeliveryJob>,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(JOB_STORE, 'readwrite')
    const store = tx.objectStore(JOB_STORE)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const existing = getReq.result as DeliveryJob | undefined
      if (!existing) {
        reject(new Error(`DeliveryJob ${id} not found`))
        return
      }
      const updated: DeliveryJob = {
        ...existing,
        ...patch,
        id: existing.id,         // never overwrite id
        createdAt: existing.createdAt, // never overwrite createdAt
        updatedAt: Date.now(),
      }
      store.put(updated)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

/** Delete a job and its stored package bytes. */
export async function deleteDeliveryJob(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction([JOB_STORE, PKG_STORE], 'readwrite')
    tx.objectStore(JOB_STORE).delete(id)
    tx.objectStore(PKG_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

// ---------------------------------------------------------------------------
// LabelGrid submission (real HTTP POST via /api/rain/distribute)
// ---------------------------------------------------------------------------

export interface SubmitResultOk {
  ok: true
  providerResponse: string
}
export interface SubmitResultFail {
  ok: false
  error: string
  requiresCredentials: boolean
}
export type SubmitResult = SubmitResultOk | SubmitResultFail

/**
 * Submit a packaged delivery job to LabelGrid (or whichever DSP aggregator is
 * configured via env vars).
 *
 * Flow:
 *   1. Loads the persisted package bytes from IndexedDB.
 *   2. POSTs a multipart/form-data request to `/api/rain/distribute` with:
 *        - `manifest`: JSON string of ReleaseManifest
 *        - `package`: the ZIP Blob (application/zip)
 *        - `jobId`: the DeliveryJob id
 *   3. The server route checks `process.env.LABELGRID_API_KEY`:
 *        - If missing → 409 with `{ requiresCredentials: true, error: '...' }`.
 *          The client surfaces this honestly — the package IS built and IS
 *          ready, but no delivery has been attempted.
 *        - If present → the server makes a real `fetch()` to
 *          `LABELGRID_API_URL` (default `https://api.labelgrid.com/v1/deliveries`)
 *          with `Authorization: Bearer <key>` and forwards the multipart body.
 *          2xx → `{ ok: true, providerResponse }`. Non-2xx →
 *          `{ ok: false, error: <provider body>, requiresCredentials: false }`.
 *   4. The client updates the DeliveryJob status accordingly.
 *
 * Honest disclosure: the LABELGRID_API_KEY env var is NOT set in the default
 * sandbox `.env` file. The function will return `requiresCredentials: true`
 * until the operator sets the env var and restarts the dev server. This is
 * intentional and matches the user directive: "build the integration layer
 * so the workflow is complete once credentials are supplied".
 */
export async function submitToLabelGrid(job: DeliveryJob): Promise<SubmitResult> {
  const pkg = await loadDeliveryPackage(job.id)
  if (!pkg) {
    return {
      ok: false,
      error: 'Package bytes not found in IndexedDB — rebuild the package before submitting.',
      requiresCredentials: false,
    }
  }
  // Mark the job as submitting so the UI can render an in-flight state.
  await updateDeliveryJob(job.id, {
    status: 'submitting',
    submittedAt: Date.now(),
    error: undefined,
  })

  try {
    const fd = new FormData()
    fd.append('jobId', job.id)
    fd.append('manifest', JSON.stringify(job.manifest))
    fd.append('package', new Blob([pkg.buffer as ArrayBuffer], { type: 'application/zip' }), `${job.manifest.releaseId}.zip`)

    const resp = await fetch('/api/rain/distribute', {
      method: 'POST',
      body: fd,
    })
    const body = await resp.json().catch(() => ({ error: 'Non-JSON provider response' })) as {
      ok?: boolean
      providerResponse?: string
      error?: string
      requiresCredentials?: boolean
    }

    if (resp.ok && body.ok) {
      await updateDeliveryJob(job.id, {
        status: 'delivered',
        deliveredAt: Date.now(),
        providerResponse: body.providerResponse ?? 'Delivered',
      })
      return { ok: true, providerResponse: body.providerResponse ?? 'Delivered' }
    }

    const requiresCredentials = body.requiresCredentials === true
    const errMsg = body.error ?? `Provider returned HTTP ${resp.status}`
    await updateDeliveryJob(job.id, {
      status: 'failed',
      error: errMsg,
      providerResponse: body.providerResponse,
    })
    return { ok: false, error: errMsg, requiresCredentials }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Network error during submission'
    await updateDeliveryJob(job.id, {
      status: 'failed',
      error: errMsg,
    })
    return { ok: false, error: errMsg, requiresCredentials: false }
  }
}
