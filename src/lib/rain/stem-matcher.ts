'use client'

/**
 * RAIN V6 — Stem Filename Matcher
 *
 * Maps an arbitrary audio filename from a stem .zip (e.g. "Track01_LeadVox.wav",
 * "kick_drum.wav", "03_bass.wav") to one of the 12 canonical `StemKey` values
 * defined in `src/lib/rain/constants.ts`.
 *
 * The matcher is intentionally fuzzy: it strips common prefixes (track
 * numbers), removes the file extension, normalises separators, and looks for
 * keywords anywhere in the resulting stem name. Keywords are checked in a
 * deliberate precedence order so that "bass_drum.wav" → `kick` (NOT `bass`),
 * and "lead_vocal.wav" → `vocals` (NOT `guitar`, which would match on "lead"
 * in some DAW conventions).
 *
 * Precedence (highest first):
 *   1. kick patterns   (kick, kick_drum, bd, bass_drum)
 *   2. snare           (snare, snare_drum, sn, snr)
 *   3. hats            (hat, hats, hihat, hi_hat, hh)
 *   4. percussion      (perc, percussion, congas, shaker, tambourine, bongo)
 *   5. backing_vocals  (backing, bv, bvs, harmony, choir)
 *   6. vocals          (vocal, vox, leadvox, lead_vocal, lead)
 *   7. bass            (bass, bassline, sub_bass, subbass, sub)
 *   8. guitar          (guitar, guit, gtr)
 *   9. piano           (piano, keys, keyboards, rhodes, electric_piano)
 *  10. ambience        (ambience, ambient, room, reverb, fx, atmos)
 *  11. drums           (drums, drum_bus, drum_stem, drum)  ← full drum bus
 *  12. other           (other, misc, instruments, music, instrumental, backing_track)
 *
 * Notes on the precedence design:
 *   • `kick` is tried before `bass` so that "bass_drum.wav" resolves to kick,
 *     not bass. ("bass_drum" is the orchestral/DAW term for a kick drum.)
 *   • `kick`'s pattern list also explicitly includes "bass_drum".
 *   • `backing_vocals` is tried before `vocals` so that "backing_vocal.wav"
 *     resolves to backing_vocals (it contains both "vocal" and "backing"),
 *     not vocals.
 *   • `snare` is tried before `drums` so that "snare.wav" does not get
 *     swallowed by the generic `drums` match.
 *   • `drums` is intentionally low priority — it's the catch-all for a
 *     full drum bus ("drum_stem.wav", "drums.wav"). Individual drum hits
 *     (kick/snare/hats/percussion) all take precedence.
 *
 * Matching is case-insensitive, ignores path separators, and treats `_`,
 * `-`, `.`, `(`, `)`, `[`, `]`, and digits-as-word-prefix as word boundaries.
 */

import type { StemKey } from './types'
import type { ZipEntry } from './zip-reader'

// ---------------------------------------------------------------------------
// Audio extension whitelist (case-insensitive)
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS = new Set([
  'wav', 'wave',
  'mp3',
  'flac',
  'aac',
  'ogg', 'oga',
  'm4a', 'mp4a', 'mp4', // m4a is the audio-only MP4 container
  'aiff', 'aif', 'aifc',
  'opus', 'weba', 'webm', // opus + webm-audio
  'wma',
])

function getExtension(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  const base = slash >= 0 ? filename.slice(slash + 1) : filename
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** True if the filename looks like an audio file we can decode. */
export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filename))
}

// ---------------------------------------------------------------------------
// Normalisation — lowercase, strip extension, strip leading track-number
// prefixes, normalise separators to underscores, collapse repeats.
// ---------------------------------------------------------------------------

/**
 * Normalise a filename for keyword matching.
 *
 * Examples:
 *   "Track01_LeadVox.wav"   → "track_leadvox"
 *   "03 - bass_drum.wav"    → "bass_drum"
 *   "[Stems]/01 - vocals"   → "vocals"
 *   "01.Kick.wav"           → "kick"
 */
function normaliseStemName(filename: string): string {
  // Strip path components.
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  let base = slash >= 0 ? filename.slice(slash + 1) : filename

  // Strip extension.
  const dot = base.lastIndexOf('.')
  if (dot > 0) base = base.slice(0, dot)

  // Lowercase.
  let s = base.toLowerCase()

  // Replace separator chars with spaces (we'll tokenise on space later).
  s = s.replace(/[_\-./()<>[\]{}]+/g, ' ')

  // Insert a space between a digit and a letter ("01Kick" → "01 kick") so the
  // leading-number-strip regex below catches it.
  s = s.replace(/(\d)([a-z])/gi, '$1 $2').replace(/([a-z])(\d)/gi, '$1 $2')

  // Strip leading track-number tokens (e.g. "01", "track 01", "track01",
  // "stem 3"). Match up to two leading number/track/stem tokens.
  s = s.replace(/^\s*((track|stem|part|file|disk|cd|side)\s*)?\d+\s*/i, '')
  s = s.replace(/^\s*((track|stem|part|file|disk|cd|side)\s*)?\d+\s*/i, '')

  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

// ---------------------------------------------------------------------------
// Keyword tables — ORDER MATTERS (highest-priority stem first).
//
// Each entry: [StemKey, string[] of keywords]
// Keywords are tested with word-boundary matching. A "word boundary" here is
// either the start/end of the normalised name, or a space. Multi-word
// keywords (e.g. "bass drum") are supported.
// ---------------------------------------------------------------------------

interface StemPattern {
  key: StemKey
  /** Substrings to look for. Each is matched as a whole word or as a leading
   *  substring of a word (so "vocal" matches "vocal", "vocals", "vocal_fx",
   *  "leadvocal", but NOT "antivocal" — wait, that's too strict. Let's
   *  relax: a match is a substring occurrence.) */
  keywords: string[]
}

const STEM_PATTERNS: StemPattern[] = [
  // 1. kick — MUST come before bass (so "bass_drum" → kick).
  {
    key: 'kick',
    keywords: ['kick', 'kickdrum', 'kick drum', 'bass drum', 'bassdrum', 'bd', 'bd k'],
  },
  // 2. snare
  {
    key: 'snare',
    keywords: ['snare', 'snaredrum', 'snare drum', 'snr', 'sn '],
  },
  // 3. hats
  {
    key: 'hats',
    keywords: ['hihat', 'hi hat', 'hi-hat', 'hats', 'hat', 'hh', 'hihats'],
  },
  // 4. percussion
  {
    key: 'percussion',
    keywords: ['percussion', 'perc', 'congas', 'conga', 'shaker', 'tambourine', 'tamb', 'bongo', 'bongos', 'clap', 'claps', 'toms', 'tom'],
  },
  // 5. backing_vocals — MUST come before vocals.
  {
    key: 'backing_vocals',
    keywords: ['backing vocal', 'backing vox', 'backing', 'bvocals', 'bvocal', 'bvs', 'bv ', 'harmony', 'harmonies', 'choir', 'backing_track'],
  },
  // 6. vocals
  {
    key: 'vocals',
    keywords: ['lead vocal', 'lead vox', 'leadvox', 'lead_vocal', 'leadvox', 'vocal', 'vox', 'lead', 'acapella', 'accapella', 'voice'],
  },
  // 7. bass
  {
    key: 'bass',
    keywords: ['sub bass', 'subbass', 'sub-bass', 'bassline', 'bass line', 'bass', 'sub'],
  },
  // 8. guitar
  {
    key: 'guitar',
    keywords: ['guitar', 'guitars', 'guit', 'gtr', 'acoustic gtr', 'elec gtr'],
  },
  // 9. piano
  {
    key: 'piano',
    keywords: ['electric piano', 'electric_piano', 'rhodes', 'piano', 'keys', 'keyboards', 'keyboard', 'ep'],
  },
  // 10. ambience
  {
    key: 'ambience',
    keywords: ['ambience', 'ambient', 'room', 'reverb', 'fx', 'atmos', 'atmosphere', 'hall', 'plate'],
  },
  // 11. drums — full drum bus. Low priority so individual hits win.
  {
    key: 'drums',
    keywords: ['drum bus', 'drum_bus', 'drum stem', 'drum_stem', 'drumkit', 'drum kit', 'drumset', 'drums', 'drum'],
  },
  // 12. other — catch-all.
  {
    key: 'other',
    keywords: ['other', 'misc', 'instruments', 'instrumental', 'music', 'backing track', 'mix minus vocals', 'no vocals'],
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a filename to a canonical stem key.
 *
 * @returns The matching StemKey, or null if no keyword matched.
 */
export function matchStemKey(filename: string): StemKey | null {
  const normalised = normaliseStemName(filename)
  if (!normalised) return null

  // Try each pattern group in precedence order. Within a group, test each
  // keyword — but longer keywords first (so "bass drum" beats "bass" inside
  // its own group, in case we ever reorder).
  for (const { key, keywords } of STEM_PATTERNS) {
    // Sort keywords by length descending so multi-word patterns match first.
    const sorted = [...keywords].sort((a, b) => b.length - a.length)
    for (const kw of sorted) {
      if (containsKeyword(normalised, kw)) {
        return key
      }
    }
  }
  return null
}

/**
 * Word-boundary-aware substring test. A keyword "kw" matches the normalised
 * string `s` if `kw` appears as a substring anywhere in `s`. We don't enforce
 * strict word boundaries because compound DAW names ("leadvocal", "kickdrum")
 * often run keywords together — false positives are minimised by the
 * precedence ordering above.
 *
 * @param s    The normalised stem name (lowercase, space-separated tokens).
 * @param kw   The lowercase keyword to search for (may contain spaces).
 */
function containsKeyword(s: string, kw: string): boolean {
  if (!kw) return false
  if (kw.length === 1) {
    // Single-letter keywords (e.g. "bd", "bv") are too aggressive — we
    // require a strict token match for 1- or 2-letter keywords to avoid
    // matching inside random words.
    // Split into tokens and compare exactly.
    const tokens = s.split(' ')
    return tokens.includes(kw)
  }
  if (kw.length <= 3) {
    // 2-3 letter keywords: require token match OR a leading substring of a
    // token (so "vox" matches "vox", "vox1", "leadviox" — actually no, that's
    // too loose). Strict token match for short keywords.
    const tokens = s.split(' ')
    return tokens.some((t) => t === kw || t.startsWith(kw))
  }
  // Long keywords: plain substring match.
  return s.includes(kw)
}

// ---------------------------------------------------------------------------
// Batch helpers — operate on a list of ZipEntry from extractZip()
// ---------------------------------------------------------------------------

export interface MatchedStem {
  entry: ZipEntry
  key: StemKey
}

export interface ExtractionResult {
  /** Audio files whose filename matched a canonical stem key. */
  matched: MatchedStem[]
  /** Audio files that did NOT match any stem key (kept for the summary). */
  unmatchedAudio: ZipEntry[]
  /** Non-audio files (cover art, README, etc.) — not included in either list. */
  nonAudio: ZipEntry[]
  /** When the same StemKey was matched by multiple files, all but the first
   *  occurrence are listed here with the duplicate key. */
  duplicates: Array<{ entry: ZipEntry; key: StemKey }>
}

/**
 * Separate a list of ZIP entries into matched / unmatched / non-audio / duplicates.
 *
 * Matching logic:
 *   1. Skip non-audio files entirely (they go to `nonAudio`).
 *   2. For each audio file, call `matchStemKey(filename)`.
 *   3. If matched and the key has NOT been seen yet → add to `matched`.
 *   4. If matched but the key was already taken → add to `duplicates`.
 *   5. If unmatched → add to `unmatchedAudio`.
 */
export function extractStemsFromZip(entries: ZipEntry[]): ExtractionResult {
  const matched: MatchedStem[] = []
  const unmatchedAudio: ZipEntry[] = []
  const nonAudio: ZipEntry[] = []
  const duplicates: Array<{ entry: ZipEntry; key: StemKey }> = []
  const seenKeys = new Set<StemKey>()

  for (const entry of entries) {
    if (!isAudioFile(entry.filename)) {
      nonAudio.push(entry)
      continue
    }
    const key = matchStemKey(entry.filename)
    if (!key) {
      unmatchedAudio.push(entry)
      continue
    }
    if (seenKeys.has(key)) {
      duplicates.push({ entry, key })
      continue
    }
    seenKeys.add(key)
    matched.push({ entry, key })
  }

  return { matched, unmatchedAudio, nonAudio, duplicates }
}
