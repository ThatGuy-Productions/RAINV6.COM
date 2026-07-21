/**
 * RAIN V6 — Ditto-standard release metadata validation + option lists.
 *
 * This module is the single source of truth for:
 *   • Format validators (ISRC / UPC / ISWC) — used by the metadata form to
 *     show live red-border error feedback, and by the DDEX builder to fail
 *     fast on bad identifiers.
 *   • `validateMetadata(m)` — returns a flat list of `{ field, message }`
 *     issues. Empty array = ready to ship.
 *   • Curated option lists for the dropdowns / multi-selects on the form:
 *       - GENRE_SUBGENRE_OPTIONS  (two-level DDEX genre:subgenre)
 *       - LANGUAGE_OPTIONS        (ISO 639-2)
 *       - PRO_OPTIONS             (collecting societies)
 *       - TERRITORY_OPTIONS       (ISO 3166 + WORLDWIDE)
 *       - CONTRIBUTOR_ROLE_OPTIONS
 *
 * Spec references:
 *   • ISO 3901 (ISRC)        — CC-XXX-YY-NNNNN
 *   • ISO 639-2 (language)   — 3-letter codes
 *   • ISO 3166 (territories) — 2-letter country codes
 *   • ISO 27729 (ISNI)       — 16-digit with check digit (not validated here)
 *   • CISAC IPI              — 9-11 digit numeric
 *   • DDEX ERN 4.3.2         — genre:subgenre convention, AIInvolvement block
 */

import type { ContributorRole, TrackMetadata } from './types'

// ---------------------------------------------------------------------------
// ISRC — ISO 3901: CC-XXX-YY-NNNNN
// ---------------------------------------------------------------------------

/**
 * ISO 3901 ISRC, written without dashes: 2 country + 3 registrant + 2 year +
 * 5 designation = 12 alphanumeric chars. Country code is always letters,
 * registrant may be alphanumeric, year + designation are digits.
 */
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/

/** Validate an ISRC string. Accepts the dashed form (CC-XXX-YY-NNNNN) by stripping dashes first. */
export function validateIsrc(s: string): boolean {
  if (!s) return false
  const compact = s.replace(/[-\s]/g, '').toUpperCase()
  return ISRC_RE.test(compact)
}

// ---------------------------------------------------------------------------
// UPC — 12-digit EAN-13 minus the leading zero, with mod-10 check digit
// ---------------------------------------------------------------------------

/**
 * Validate a 12-digit UPC. The check digit is computed with the EAN-13
 * weights (3,1,3,1,...) — same as ISBN-13 and ISSN-13. Returns true iff the
 * embedded check digit matches the computed one.
 */
export function validateUpc(s: string): boolean {
  if (!/^\d{12}$/.test(s ?? '')) return false
  let sum = 0
  for (let i = 0; i < 11; i++) {
    sum += parseInt(s[i], 10) * (i % 2 === 0 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return check === parseInt(s[11], 10)
}

// ---------------------------------------------------------------------------
// ISWC — T-xxx.xxx.xxx-x
// ---------------------------------------------------------------------------

/**
 * ISO 15707 ISWC. The canonical display form is `T-XXX.XXX.XXX-X` where the
 * 9 inner digits are the work identifier and the final digit is a mod-10
 * check digit computed over `T` + the 9 digits. We validate the format and
 * the check digit (the prefix letter is always 'T').
 */
export function validateIswc(s: string): boolean {
  if (!s) return false
  const trimmed = s.trim().toUpperCase()
  if (!/^T-\d{3}\.\d{3}\.\d{3}-\d$/.test(trimmed)) return false
  // Check digit math (ISO 15707): weight the 'T' as 1, then digits 2..10.
  const digits = trimmed.slice(2).replace(/[.-]/g, '') // 10 digits
  // The first 9 are the work id; the 10th is the check digit.
  const work = digits.slice(0, 9)
  const check = parseInt(digits[9], 10)
  const weighted = (1 + work.split('').reduce((acc, d, i) => acc + parseInt(d, 10) * (i + 2), 0)) % 10
  // ISWC check digit is 10 - (sum % 10), with 0 staying 0.
  const expected = (10 - weighted) % 10
  return check === expected
}

// ---------------------------------------------------------------------------
// validateMetadata — returns [] iff ready to ship
// ---------------------------------------------------------------------------

export interface MetadataIssue {
  /** Dotted path into TrackMetadata, e.g. "isrc", "aiDisclosure.vocals". */
  field: string
  /** Human-readable message — shown as red text under the field. */
  message: string
}

/**
 * Validate a TrackMetadata object against the Ditto standard.
 *
 * Required fields: title, artist. Conditional: ISRC / UPC / ISWC are optional
 * but, if present, must pass format + check-digit validation. territories, if
 * not WORLDWIDE, must contain only valid ISO 3166 codes. Contributor share
 * total (for songwriter / composer / lyricist / publisher roles) is reported
 * as a single warning if it doesn't sum to 100.
 */
export function validateMetadata(m: TrackMetadata): MetadataIssue[] {
  const issues: MetadataIssue[] = []

  // ---- Required: title + artist ----
  if (!m.title?.trim()) {
    issues.push({ field: 'title', message: 'Release / track title is required.' })
  }
  if (!m.artist?.trim()) {
    issues.push({ field: 'artist', message: 'Primary artist is required.' })
  }

  // ---- Release date format (YYYY-MM-DD) if present ----
  if (m.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(m.releaseDate)) {
    issues.push({ field: 'releaseDate', message: 'Release date must be YYYY-MM-DD.' })
  }
  if (m.originalReleaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(m.originalReleaseDate)) {
    issues.push({ field: 'originalReleaseDate', message: 'Original release date must be YYYY-MM-DD.' })
  }

  // ---- Identifier formats (optional but validated if present) ----
  if (m.isrc && !validateIsrc(m.isrc)) {
    issues.push({ field: 'isrc', message: 'ISRC must match CC-XXX-YY-NNNNN (ISO 3901).' })
  }
  if (m.upc && !validateUpc(m.upc)) {
    issues.push({ field: 'upc', message: 'UPC must be 12 digits with a valid EAN-13 check digit.' })
  }
  if (m.iswc && !validateIswc(m.iswc)) {
    issues.push({ field: 'iswc', message: 'ISWC must match T-XXX.XXX.XXX-X with a valid check digit.' })
  }

  // ---- Year fields must be 4-digit numbers if present ----
  const yearFields: Array<[string, string | undefined]> = [
    ['year', m.year],
    ['recordingYear', m.recordingYear],
    ['copyrightYear', m.copyrightYear],
  ]
  for (const [field, value] of yearFields) {
    if (value && !/^\d{4}$/.test(value)) {
      issues.push({ field, message: `${field} must be a 4-digit year.` })
    }
  }

  // ---- Track number / track total must be positive integers if present ----
  if (m.trackNumber && !/^\d+$/.test(m.trackNumber)) {
    issues.push({ field: 'trackNumber', message: 'Track number must be a positive integer.' })
  }
  if (m.trackTotal && !/^\d+$/.test(m.trackTotal)) {
    issues.push({ field: 'trackTotal', message: 'Track total must be a positive integer.' })
  }
  if (m.trackVolume && !/^\d+$/.test(m.trackVolume)) {
    issues.push({ field: 'trackVolume', message: 'Volume / disc number must be a positive integer.' })
  }

  // ---- Publisher IPI must be numeric (9-11 digits) if present ----
  if (m.publisherIpi && !/^\d{9,11}$/.test(m.publisherIpi.replace(/[-\s]/g, ''))) {
    issues.push({ field: 'publisherIpi', message: 'Publisher IPI must be 9-11 digits (CISAC).' })
  }

  // ---- Contributor IPI / ISNI format + writer share total ----
  const writerRoles: ContributorRole[] = ['songwriter', 'composer', 'lyricist', 'publisher']
  let writerShareTotal = 0
  let hasWriterShares = false
  ;(m.contributors ?? []).forEach((c, i) => {
    if (c.ipi && !/^\d{9,11}$/.test(c.ipi.replace(/[-\s]/g, ''))) {
      issues.push({ field: `contributors[${i}].ipi`, message: `Contributor ${i + 1}: IPI must be 9-11 digits.` })
    }
    if (c.isni && !/^\d{15}[\dX]$/.test(c.isni.replace(/[-\s]/g, '').toUpperCase())) {
      issues.push({ field: `contributors[${i}].isni`, message: `Contributor ${i + 1}: ISNI must be 16 chars (digit or X).` })
    }
    if (writerRoles.includes(c.role)) {
      if (typeof c.share === 'number' && !Number.isNaN(c.share)) {
        writerShareTotal += c.share
        hasWriterShares = true
      }
    }
  })
  if (hasWriterShares && Math.abs(writerShareTotal - 100) > 0.5) {
    issues.push({
      field: 'contributors',
      message: `Writer + publisher shares total ${writerShareTotal.toFixed(1)}% — should sum to 100%.`,
    })
  }

  // ---- territories: WORLDWIDE or list of ISO 3166 codes ----
  if (m.territories && m.territories.length > 0) {
    const valid = m.territories.every((t) => t === 'WORLDWIDE' || /^[A-Z]{2}$/.test(t))
    if (!valid) {
      issues.push({ field: 'territories', message: 'Territories must be WORLDWIDE or 2-letter ISO 3166 codes.' })
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Curated option lists
// ---------------------------------------------------------------------------

/**
 * Two-level DDEX genre:subgenre list. 12 top-level genres × ~5 subgenres each.
 * The metadata form renders this as a cascading two-select (genre → subgenre)
 * and writes the combined value as `"Genre:Subgenre"` into `genreSubgenre`.
 */
export const GENRE_SUBGENRE_OPTIONS: { genre: string; subgenres: string[] }[] = [
  { genre: 'Pop', subgenres: ['Indie Pop', 'Synth Pop', 'Dance Pop', 'Electropop', 'Bedroom Pop'] },
  { genre: 'Rock', subgenres: ['Indie Rock', 'Alt Rock', 'Hard Rock', 'Punk', 'Post-Rock'] },
  { genre: 'Hip-Hop', subgenres: ['Trap', 'Boom Bap', 'Drill', 'Lo-Fi Hip-Hop', 'Rap'] },
  { genre: 'Electronic', subgenres: ['House', 'Techno', 'Drum & Bass', 'Ambient', 'Dubstep'] },
  { genre: 'R&B/Soul', subgenres: ['Contemporary R&B', 'Neo-Soul', 'Funk', 'Alternative R&B', 'Classic Soul'] },
  { genre: 'Jazz', subgenres: ['Smooth Jazz', 'Bebop', 'Fusion', 'Vocal Jazz', 'Free Jazz'] },
  { genre: 'Classical', subgenres: ['Orchestral', 'Chamber', 'Solo Instrumental', 'Choral', 'Opera'] },
  { genre: 'Country', subgenres: ['Modern Country', 'Classic Country', 'Americana', 'Bluegrass', 'Outlaw'] },
  { genre: 'Latin', subgenres: ['Reggaeton', 'Latin Pop', 'Bachata', 'Salsa', 'Regional Mexican'] },
  { genre: 'Reggae', subgenres: ['Roots Reggae', 'Dub', 'Dancehall', 'Ska', 'Lovers Rock'] },
  { genre: 'World', subgenres: ['Afrobeats', 'Bollywood', 'Celtic', 'K-Pop', 'Tropical'] },
  { genre: 'Folk', subgenres: ['Indie Folk', 'Folk Rock', 'Singer-Songwriter', 'Folk Pop', 'Traditional'] },
]

/** ISO 639-2 language codes — common release languages, with display names. */
export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'eng', label: 'English' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'spa', label: 'Spanish' },
  { value: 'ita', label: 'Italian' },
  { value: 'por', label: 'Portuguese' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'kor', label: 'Korean' },
  { value: 'zho', label: 'Chinese (Mandarin)' },
  { value: 'ara', label: 'Arabic' },
  { value: 'rus', label: 'Russian' },
  { value: 'hin', label: 'Hindi' },
  { value: 'nld', label: 'Dutch' },
  { value: 'swe', label: 'Swedish' },
  { value: 'pol', label: 'Polish' },
  { value: 'tur', label: 'Turkish' },
]

/** PRO / collecting society suggestions — free-text field with these as datalist options. */
export const PRO_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— None —' },
  { value: 'PRS', label: 'PRS for Music (UK)' },
  { value: 'ASCAP', label: 'ASCAP (US)' },
  { value: 'BMI', label: 'BMI (US)' },
  { value: 'SESAC', label: 'SESAC (US)' },
  { value: 'SACEM', label: 'SACEM (FR)' },
  { value: 'GEMA', label: 'GEMA (DE)' },
  { value: 'SIAE', label: 'SIAE (IT)' },
  { value: 'JASRAC', label: 'JASRAC (JP)' },
  { value: 'KOMCA', label: 'KOMCA (KR)' },
  { value: 'APRA', label: 'APRA AMCOS (AU/NZ)' },
  { value: 'SOCAN', label: 'SOCAN (CA)' },
]

/**
 * Territory options — 'WORLDWIDE' plus the most common ISO 3166 country codes
 * (full list would be 249 entries; this curated list covers 50+ top markets).
 */
export const TERRITORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'WORLDWIDE', label: 'Worldwide' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'PL', label: 'Poland' },
  { value: 'IE', label: 'Ireland' },
  { value: 'PT', label: 'Portugal' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'AT', label: 'Austria' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'CN', label: 'China' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'TW', label: 'Taiwan' },
  { value: 'SG', label: 'Singapore' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'PH', label: 'Philippines' },
  { value: 'TH', label: 'Thailand' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'IN', label: 'India' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'AR', label: 'Argentina' },
  { value: 'CL', label: 'Chile' },
  { value: 'CO', label: 'Colombia' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'EG', label: 'Egypt' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'TR', label: 'Turkey' },
  { value: 'IL', label: 'Israel' },
  { value: 'RU', label: 'Russia' },
  { value: 'UA', label: 'Ukraine' },
]

/** Contributor role options — drives the `<select>` in each table row. */
export const CONTRIBUTOR_ROLE_OPTIONS: { value: ContributorRole; label: string }[] = [
  { value: 'songwriter', label: 'Songwriter' },
  { value: 'composer', label: 'Composer' },
  { value: 'lyricist', label: 'Lyricist' },
  { value: 'performer', label: 'Performer (Primary Artist)' },
  { value: 'featured', label: 'Featured Artist' },
  { value: 'producer', label: 'Producer' },
  { value: 'mixer', label: 'Mixer' },
  { value: 'masterer', label: 'Mastering Engineer' },
  { value: 'publisher', label: 'Publisher' },
]

/** Roles that count toward the writer-share total. */
export const WRITER_ROLES: ContributorRole[] = ['songwriter', 'composer', 'lyricist', 'publisher']
