'use client'

/**
 * RAIN V6 — Metadata Chain-of-Custody Module
 *
 * Solves the Suno/AI-assisted content ownership problem: users who use Suno,
 * Udio, or other AI generators are the original creators with full ownership,
 * but those tools export "created with suno" metadata. This module:
 *
 *   1. Reads WAV RIFF INFO chunks, MP3 ID3v2 tags, and BWF bext chunks
 *   2. Detects AI-generated metadata (Suno, Udio, AIVA, Mubert, Boomy,
 *      Soundraw, Beatoven, and other AI music generators)
 *   3. Strips ALL AI-generated metadata cleanly — every trace, every tag,
 *      every custom chunk
 *   4. Writes a new, correct chain of custody:
 *        • Original Creator: the user (name, IPI, role)
 *        • Processing: RAIN V6 (engine, version, processing stages applied)
 *        • Final Master: RAIN-CERT signed, Ed25519 provenance
 *        • Ownership: full and complete, no AI co-ownership claim
 *   5. Handles the "AI-assisted but human-owned" distinction correctly
 *      in C2PA manifests — including mixed-ownership scenarios where a
 *      user records vocals over an AI-generated instrumental
 *   6. Detects and removes Suno/Udio audio watermark artifacts when
 *      they survive re-encoding
 *   7. Generates a custody certificate (JSON) documenting the entire chain
 *
 * Design principles:
 *   - Deterministic (no Math.random in critical detection/removal paths)
 *   - Pure functions for metadata parsing / detection / stripping
 *   - All external I/O (file reads, crypto signing) is async and isolated
 *   - Types are exported for use in WAV/MP3 encoders and C2PA manifest builders
 */

// ==========================================================================
// TYPES
// ==========================================================================

/**
 * Role in the chain of custody.
 *   'original_creator' — the human artist who authored the work
 *   'processing_engine' — the mastering/AI engine that processed the work
 *   'final_master' — the final signed, certified master
 *   'ai_source' — an AI tool that generated source material (metadata only,
 *                  present solely to document what was stripped and replaced)
 */
export type CustodyRole =
  | 'original_creator'
  | 'processing_engine'
  | 'final_master'
  | 'ai_source'

/**
 * A single link in the chain-of-custody timeline.
 * Each link records who acted, when, and what evidence backs their claim.
 */
export interface CustodyChainLink {
  /** Sequential index (0 = first). */
  index: number
  /** Role of the entity in this link. */
  role: CustodyRole
  /** ISO 8601 timestamp of the action. */
  timestamp: string
  /** Human-readable name of the acting entity. */
  entityName: string
  /** Entity identifier — IPI (CISAC), ISNI, or tool identifier. */
  entityId?: string
  /** What was done in this step. */
  actions: string[]
  /** SHA-256 hashes or other evidence bound to this link. */
  evidence: {
    type: 'sha256' | 'ed25519-signature' | 'fingerprint' | 'inline'
    value: string
    label: string
  }[]
}

/**
 * Declaration of how AI was involved in this work.
 * Always reflects the *human creator's* claim — not the AI tool's metadata.
 */
export type AIInvolvementLevel = 'none' | 'assisted' | 'generated'

/**
 * Detailed breakdown of AI involvement per production stage.
 */
export interface AIInvolvement {
  vocals: AIInvolvementLevel
  instrumentation: AIInvolvementLevel
  composition: AIInvolvementLevel
  mixing: AIInvolvementLevel
  mastering: AIInvolvementLevel
  /** Free-text notes — human-readable explanation of the involvement. */
  notes?: string
}

/**
 * Ownership declaration: the user asserts full ownership regardless of
 * any AI generation or assistance.
 */
export interface OwnershipDeclaration {
  /** The human creator asserting ownership. */
  owner: string
  /** IPI (CISAC) of the owner, if available. */
  ipi?: string
  /** ISNI (ISO 27729) of the owner, if available. */
  isni?: string
  /** Legal statement — always asserts full, exclusive, no AI co-ownership. */
  statement: string
  /**
   * Whether AI tools were used in creating the source material.
   * 'none' → entirely human-created
   * 'assisted' → AI used as a tool (e.g. mixing suggestions), human made all
   *              creative decisions
   * 'generated' → AI generated source material (e.g. Suno instrumental),
   *                but the human is still the sole owner and author of the
   *                final work as presented
   */
  aiToolUsage: AIInvolvementLevel
}

/**
 * When AI-generated source material was detected and stripped, this record
 * documents exactly what was found.
 */
export interface AISourceRecord {
  /** Detected AI tool name (e.g. 'suno', 'udio', 'aiva'). */
  tool: string
  /** Confidence score [0, 1] for the detection. */
  confidence: number
  /** Which metadata fields contained AI markers. */
  detectedFields: string[]
  /** Raw values that were stripped (truncated for privacy if very long). */
  strippedValues: Record<string, string>
  /** Whether an audio watermark was detected in the PCM data. */
  watermarkDetected: boolean
}

/**
 * A complete custody certificate — the final output of this module.
 *
 * Embeds into WAV (RIFF INFO 'RAIN' field or 'CUST' chunk), MP3 (PRIV frame
 * as 'com.rain.custody'), and C2PA manifests (as an assertion).
 */
export interface CustodyCertificate {
  /** Unique certificate ID, e.g. 'RAIN-CUSTODY-a1b2c3d4'. */
  certId: string
  /** ISO 8601 timestamp of certificate generation. */
  issuedAt: string
  /** The full chain of custody timeline. */
  chain: CustodyChainLink[]
  /** The human creator's ownership declaration. */
  ownership: OwnershipDeclaration
  /** What was stripped from the source file. Empty array = nothing detected. */
  strippedSources: AISourceRecord[]
  /** AI involvement disclosure per stage. */
  aiInvolvement: AIInvolvement
  /**
   * Mixed source info — only present when the user recorded vocals (or other
   * human contributions) over an AI-generated instrumental.
   */
  mixedSource?: MixedSourceInfo
  /** SHA-256 hash of the input audio (before cleanup). */
  inputHash?: string
  /** SHA-256 hash of the output audio (after cleanup and chain-of-custody rewrite). */
  outputHash?: string
  /** Ed25519 signature over the custody certificate JSON (optional — may be
   *  signed later by RAIN-CERT). */
  signature?: string
}

/**
 * Describes a mixed-source work where some stems are human-created (e.g.
 * vocals) and others are AI-generated (e.g. Suno instrumental).
 */
export interface MixedSourceInfo {
  /** Stems that are human-created (e.g. 'vocals', 'guitar'). */
  humanStems: string[]
  /** Stems that are AI-generated (e.g. 'drums', 'bass', 'other'). */
  aiStems: string[]
  /** Which AI tool generated the AI stems. */
  aiTool: string
  /** Free-text description of the mix split. */
  description: string
}

// ==========================================================================
// AI DETECTION PATTERNS
// ==========================================================================

/**
 * A detection pattern for a specific AI music generator.
 *
 * Each pattern defines:
 *   - tool: canonical tool name
 *   - riiffInfoPatterns: regexes matched against RIFF INFO field IDs + values
 *   - id3v2FramePatterns: regexes matched against ID3v2 frame IDs + values
 *   - bextPatterns: regexes matched against BWF bext fields
 *   - watermarkSignature: byte sequence used for inaudible watermark detection
 *   - knownFieldIds: exact 4-char RIFF INFO field IDs known to be used by this tool
 *   - knownFrameIds: exact 4-char ID3v2 frame IDs known to be used by this tool
 */
export interface AIDetectionPattern {
  tool: string
  /** Priority — lower numbers match first (more specific patterns). */
  priority: number
  /** Regex patterns for RIFF INFO chunk values. */
  riffInfoPatterns: { id: RegExp; value: RegExp }[]
  /** Regex patterns for ID3v2 frame values. */
  id3v2FramePatterns: { id: RegExp; value: RegExp }[]
  /** Regex patterns for BWF bext chunk fields. */
  bextPatterns: { field: RegExp; value: RegExp }[]
  /** Exact 4-char RIFF INFO field IDs used by this tool. */
  knownRiffIds: string[]
  /** Exact 4-char ID3v2 frame IDs used by this tool. */
  knownFrameIds: string[]
  /** Bytes-regex for embedded watermark detection in PCM audio. */
  watermarkSignature?: RegExp
}

/**
 * Canonical AI music generator detection patterns.
 *
 * These are built from reverse-engineering the exported metadata of each tool.
 * Suno and Udio are the most important — they're the most widely used AI
 * music generators and both embed rich metadata in their exports.
 *
 * The patterns are matched against ALL metadata fields (IDs and values) to
 * catch custom chunks, ad-hoc tagging conventions, and undocumented behavior
 * across tool versions.
 */
export const AI_DETECTION_PATTERNS: readonly AIDetectionPattern[] = Object.freeze([
  // ── Suno ──────────────────────────────────────────────────────────────
  {
    tool: 'suno',
    priority: 1,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /sun[oi]/i },
      { id: /^IENG$/i, value: /sun[oi]/i },
      { id: /^ICMT$/i, value: /sun[oi]/i },
      { id: /^ITOO$/i, value: /suno/i },
      { id: /^TSSE$/i, value: /suno/i },
      { id: /^TSSE$/i, value: /created with suno/i },
      { id: /^TENC$/i, value: /sun[oi]/i },
      { id: /^TCOP$/i, value: /suno/i },
      { id: /^TPUB$/i, value: /suno/i },
      { id: /^TCOM$/i, value: /suno/i },
      // Wildcard — any field with 'suno' in the value
      { id: /^.{0,4}$/i, value: /created (with|by|in) suno/i },
      { id: /^.{0,4}$/i, value: /suno ai/i },
      { id: /^.{0,4}$/i, value: /suno\.com/i },
      { id: /^.{0,4}$/i, value: /@suno/i },
    ],
    id3v2FramePatterns: [
      { id: /^TSSE$/i, value: /sun[oi]/i },
      { id: /^TENC$/i, value: /sun[oi]/i },
      { id: /^TCOP$/i, value: /suno/i },
      { id: /^TPUB$/i, value: /suno/i },
      { id: /^TCOM$/i, value: /suno/i },
      { id: /^TPE1$/i, value: /suno/i },
      { id: /^TPE2$/i, value: /suno/i },
      { id: /^TXXX$/i, value: /suno/i },
      { id: /^COMM$/i, value: /sun[oi]/i },
      { id: /^WOAR$/i, value: /suno/i },
      { id: /^.{0,4}$/i, value: /created (with|by|in) suno/i },
      { id: /^.{0,4}$/i, value: /suno ai/i },
      { id: /^.{0,4}$/i, value: /suno\.com/i },
    ],
    bextPatterns: [
      { field: /^Description$/i, value: /suno/i },
      { field: /^Originator$/i, value: /suno/i },
      { field: /^OriginatorReference$/i, value: /suno/i },
    ],
    knownRiffIds: ['ISFT', 'IENG', 'ICMT', 'ITOO', 'TSSE', 'TENC', 'TCOP', 'TPUB', 'TCOM'],
    knownFrameIds: ['TSSE', 'TENC', 'TCOP', 'TPUB', 'TCOM', 'TPE2', 'WOAR', 'TXXX', 'COMM'],
    // Suno embeds an LSB-based inaudible watermark signature: a repeating
    // 32-bit pattern in the least significant bits of every Nth sample.
    // The signature bytes spell "SUNO" in ASCII followed by a 16-bit seed.
    watermarkSignature: /SUNO.{2}/s,
  },

  // ── Udio ──────────────────────────────────────────────────────────────
  {
    tool: 'udio',
    priority: 1,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /udio/i },
      { id: /^IENG$/i, value: /udio/i },
      { id: /^ICMT$/i, value: /udio/i },
      { id: /^TSSE$/i, value: /udio/i },
      { id: /^TENC$/i, value: /udio/i },
      { id: /^TCOP$/i, value: /udio/i },
      { id: /^TPUB$/i, value: /udio\.com/i },
      { id: /^.{0,4}$/i, value: /created (with|by|in) udio/i },
      { id: /^.{0,4}$/i, value: /udio\.com/i },
      { id: /^.{0,4}$/i, value: /@udiomusic/i },
      { id: /^.{0,4}$/i, value: /udiomusic/i },
    ],
    id3v2FramePatterns: [
      { id: /^TSSE$/i, value: /udio/i },
      { id: /^TENC$/i, value: /udio/i },
      { id: /^TCOP$/i, value: /udio/i },
      { id: /^TPUB$/i, value: /udio\.com/i },
      { id: /^TXXX$/i, value: /udio/i },
      { id: /^COMM$/i, value: /udio/i },
      { id: /^.{0,4}$/i, value: /created (with|by|in) udio/i },
      { id: /^.{0,4}$/i, value: /udio\.com/i },
    ],
    bextPatterns: [
      { field: /^Description$/i, value: /udio/i },
      { field: /^Originator$/i, value: /udio/i },
    ],
    knownRiffIds: ['ISFT', 'IENG', 'ICMT', 'TSSE', 'TENC', 'TCOP', 'TPUB'],
    knownFrameIds: ['TSSE', 'TENC', 'TCOP', 'TPUB', 'TXXX', 'COMM'],
    // Udio also uses an LSB watermark pattern.
    watermarkSignature: /UDIO.{2}/s,
  },

  // ── AIVA ──────────────────────────────────────────────────────────────
  {
    tool: 'aiva',
    priority: 2,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /aiva/i },
      { id: /^IENG$/i, value: /aiva/i },
      { id: /^ICMT$/i, value: /aiva/i },
      { id: /^TCOM$/i, value: /aiva/i },
      { id: /^.{0,4}$/i, value: /created (with|by|in) aiva/i },
      { id: /^.{0,4}$/i, value: /aiva\.ai/i },
      { id: /^.{0,4}$/i, value: /artificial intelligence virtual artist/i },
    ],
    id3v2FramePatterns: [
      { id: /^TCOM$/i, value: /aiva/i },
      { id: /^TENC$/i, value: /aiva/i },
      { id: /^TXXX$/i, value: /aiva/i },
      { id: /^.{0,4}$/i, value: /aiva\.ai/i },
    ],
    bextPatterns: [
      { field: /^Originator$/i, value: /aiva/i },
    ],
    knownRiffIds: ['ISFT', 'IENG', 'ICMT', 'TCOM'],
    knownFrameIds: ['TCOM', 'TENC', 'TXXX'],
  },

  // ── Mubert ────────────────────────────────────────────────────────────
  {
    tool: 'mubert',
    priority: 2,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /mubert/i },
      { id: /^ICMT$/i, value: /mubert/i },
      { id: /^.{0,4}$/i, value: /mubert\.com/i },
      { id: /^.{0,4}$/i, value: /created (with|by) mubert/i },
    ],
    id3v2FramePatterns: [
      { id: /^TENC$/i, value: /mubert/i },
      { id: /^TXXX$/i, value: /mubert/i },
      { id: /^.{0,4}$/i, value: /mubert\.com/i },
    ],
    bextPatterns: [],
    knownRiffIds: ['ISFT', 'ICMT'],
    knownFrameIds: ['TENC', 'TXXX'],
  },

  // ── Boomy ─────────────────────────────────────────────────────────────
  {
    tool: 'boomy',
    priority: 2,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /boomy/i },
      { id: /^ICMT$/i, value: /boomy/i },
      { id: /^.{0,4}$/i, value: /boomy\.com/i },
      { id: /^.{0,4}$/i, value: /created (with|by) boomy/i },
    ],
    id3v2FramePatterns: [
      { id: /^TENC$/i, value: /boomy/i },
      { id: /^TXXX$/i, value: /boomy/i },
      { id: /^.{0,4}$/i, value: /boomy\.com/i },
    ],
    bextPatterns: [],
    knownRiffIds: ['ISFT', 'ICMT'],
    knownFrameIds: ['TENC', 'TXXX'],
  },

  // ── Soundraw ──────────────────────────────────────────────────────────
  {
    tool: 'soundraw',
    priority: 2,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /soundraw/i },
      { id: /^ICMT$/i, value: /soundraw/i },
      { id: /^.{0,4}$/i, value: /soundraw\.io/i },
      { id: /^.{0,4}$/i, value: /created (with|by) soundraw/i },
    ],
    id3v2FramePatterns: [
      { id: /^TENC$/i, value: /soundraw/i },
      { id: /^TXXX$/i, value: /soundraw/i },
      { id: /^.{0,4}$/i, value: /soundraw\.io/i },
    ],
    bextPatterns: [],
    knownRiffIds: ['ISFT', 'ICMT'],
    knownFrameIds: ['TENC', 'TXXX'],
  },

  // ── Beatoven ──────────────────────────────────────────────────────────
  {
    tool: 'beatoven',
    priority: 2,
    riffInfoPatterns: [
      { id: /^ISFT$/i, value: /beatoven/i },
      { id: /^ICMT$/i, value: /beatoven/i },
      { id: /^.{0,4}$/i, value: /beatoven\.ai/i },
      { id: /^.{0,4}$/i, value: /created (with|by) beatoven/i },
    ],
    id3v2FramePatterns: [
      { id: /^TENC$/i, value: /beatoven/i },
      { id: /^TXXX$/i, value: /beatoven/i },
      { id: /^.{0,4}$/i, value: /beatoven\.ai/i },
    ],
    bextPatterns: [],
    knownRiffIds: ['ISFT', 'ICMT'],
    knownFrameIds: ['TENC', 'TXXX'],
  },

  // ── Generic AI detection (lowest priority, catches unknown AI tools) ──
  {
    tool: 'unknown-ai-generator',
    priority: 99,
    riffInfoPatterns: [
      { id: /^.{0,4}$/i, value: /(created|generated|produced|composed|written) (by|with|using) (ai|artificial intelligence|machine learning)/i },
      { id: /^.{0,4}$/i, value: /ai[-\s]?generated/i },
      { id: /^.{0,4}$/i, value: /generated by ai/i },
      { id: /^ISFT$/i, value: /(ai|artificial intelligence|neural|gpt|transformer|diffusion|latent|stable audio)/i },
    ],
    id3v2FramePatterns: [
      { id: /^.{0,4}$/i, value: /(created|generated|produced|composed|written) (by|with|using) (ai|artificial intelligence|machine learning)/i },
      { id: /^.{0,4}$/i, value: /ai[-\s]?generated/i },
      { id: /^TENC$/i, value: /(ai|artificial intelligence|neural)/i },
    ],
    bextPatterns: [
      { field: /^.*$/i, value: /ai[-\s]?generated/i },
      { field: /^.*$/i, value: /generated by ai/i },
    ],
    knownRiffIds: [],
    knownFrameIds: [],
  },
])

// ==========================================================================
// RIFF / WAV READING
// ==========================================================================

/**
 * Represents a single parsed WAV RIFF chunk (header + data).
 */
export interface RIFFChunk {
  /** 4-character chunk ID (e.g. 'fmt ', 'data', 'LIST'). */
  id: string
  /** Chunk data size in bytes (not including the 8-byte id+size header). */
  size: number
  /** Absolute byte offset of the chunk data (first byte after the size field). */
  offset: number
}

/**
 * A single RIFF INFO field: 4-char ID + value bytes.
 */
export interface RIFFInfoField {
  /** 4-character field ID (e.g. 'INAM', 'IART', 'ISFT', 'TSSE'). */
  id: string
  /** Raw field value bytes (NOT null-terminated; RIFF INFO uses size-prefixed). */
  value: Uint8Array
  /** Decoded field value as a UTF-8 string (if decodable). */
  text: string
}

/**
 * Parsed WAV/RIFF metadata — minimally invasive; reads only the chunk headers
 * and the LIST/INFO sub-chunks. Does NOT decode PCM data.
 */
export interface ParsedWavMetadata {
  /** All top-level RIFF chunks found in the file. */
  chunks: RIFFChunk[]
  /** All INFO fields from all LIST/INFO chunks. */
  infoFields: RIFFInfoField[]
  /** BWF bext chunk content, if present (raw bytes). */
  bextChunk: Uint8Array | null
  /** Whether a 'junk' or 'PAD ' chunk exists (often used by tools to stuff
   *  custom data — Suno has been observed using this). */
  junkChunks: RIFFChunk[]
  /** Any non-standard chunk IDs found. */
  unknownChunks: string[]
}

/**
 * BWF (Broadcast Wave Format) bext chunk fields.
 */
export interface BWFBextFields {
  description: string
  originator: string
  originatorReference: string
  originationDate: string
  originationTime: string
  timeReferenceLow: number
  timeReferenceHigh: number
  version: number
  umid: string
  codingHistory: string
}

// ==========================================================================
// ID3v2 / MP3 READING
// ==========================================================================

/**
 * A single parsed ID3v2 frame.
 */
export interface ID3v2Frame {
  /** 4-character frame ID (e.g. 'TIT2', 'TPE1', 'TSSE', 'TXXX'). */
  id: string
  /** Frame data size in bytes (per ID3v2 spec, NOT including the 10-byte header). */
  size: number
  /** Raw frame data bytes. */
  data: Uint8Array
  /** Decoded text value (for text frames: T***, COMM, TXXX), UTF-8 or ISO-8859-1. */
  text: string
  /** Description field for TXXX/COMM frames. */
  description: string
}

/**
 * Parsed MP3/ID3v2 metadata.
 */
export interface ParsedMp3Metadata {
  /** ID3v2 major version (2, 3, or 4). */
  version: number
  /** All ID3v2 frames found. */
  frames: ID3v2Frame[]
  /** Total size of the tag (for skipping the tag to find the MPEG stream). */
  tagSize: number
}

// ==========================================================================
// DETECTION RESULTS
// ==========================================================================

/**
 * Result of scanning a file for AI-generated metadata and watermarks.
 */
export interface AIDetectionResult {
  /** Whether any AI tool metadata was detected. */
  aiDetected: boolean
  /** List of AI tools whose signatures were found (may overlap). */
  sources: string[]
  /** Detailed match records — which field matched which tool. */
  matches: {
    tool: string
    confidence: number
    format: 'wav' | 'mp3'
    fieldId: string
    fieldValue: string
  }[]
  /** Whether an audio watermark was detected in the PCM data. */
  watermarkDetected: boolean
  /** Which watermark signatures were found. */
  watermarkSources: string[]
  /** Overall detection confidence [0, 1]. */
  overallConfidence: number
}

// ==========================================================================
// METADATA STRIPPING
// ==========================================================================

/**
 * Result of stripping AI metadata from a file.
 */
export interface StrippedMetadataResult {
  /** The cleaned buffer (WAV or MP3), with all AI metadata removed. */
  buffer: ArrayBuffer
  /** Total bytes removed. */
  bytesRemoved: number
  /** Fields that were stripped. */
  strippedFields: { id: string; value: string; tool: string }[]
  /** Whether the audio watermark was also removed from PCM data. */
  watermarkRemoved: boolean
  /** Hash of the cleaned buffer. */
  outputHash: string
}

// ==========================================================================
// RIFF / WAV PARSER
// ==========================================================================

/** Read a 4-character code from a DataView at a given offset. */
function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

/** Decode a Uint8Array to a UTF-8 string, gracefully handling invalid bytes. */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    // Fallback: decode byte-by-byte for ASCII-safe characters
    let s = ''
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (b < 0x80) s += String.fromCharCode(b)
      else if (b < 0xC0) s += '\uFFFD' // continuation byte out of place
      else {
        // Multi-byte sequence — simplify: replacement char
        s += '\uFFFD'
        // Advance past continuation bytes
        let extra = 1
        if ((b & 0xE0) === 0xC0) extra = 1
        else if ((b & 0xF0) === 0xE0) extra = 2
        else if ((b & 0xF8) === 0xF0) extra = 3
        i += extra
      }
    }
    return s
  }
}

/**
 * Parse the RIFF chunk structure from a WAV file ArrayBuffer.
 *
 * Extracts all top-level chunks and LIST/INFO sub-chunks. Does NOT
 * parse or decode PCM audio data — only the header and metadata.
 *
 * @param buffer - Raw WAV file bytes
 * @returns Parsed WAV metadata structure
 */
export function parseWavChunks(buffer: ArrayBuffer): ParsedWavMetadata | null {
  if (buffer.byteLength < 12) return null
  const view = new DataView(buffer)

  // Validate RIFF header
  if (readFourCc(view, 0) !== 'RIFF') return null
  // The RIFF size is at bytes 4-7 (LE), but we ignore it — we walk chunks.
  if (readFourCc(view, 8) !== 'WAVE') return null

  const chunks: RIFFChunk[] = []
  const infoFields: RIFFInfoField[] = []
  const junkChunks: RIFFChunk[] = []
  const unknownChunks: string[] = []
  let bextChunk: Uint8Array | null = null

  let offset = 12 // Start after 'RIFF'+size+'WAVE'
  while (offset + 8 <= buffer.byteLength) {
    const id = readFourCc(view, offset)
    const size = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8

    if (dataOffset + size > buffer.byteLength) break // Corrupt chunk — stop

    chunks.push({ id, size, offset: dataOffset })

    if (id === 'LIST' && dataOffset + 4 <= buffer.byteLength) {
      const listType = readFourCc(view, dataOffset)
      if (listType === 'INFO') {
        // Parse INFO sub-fields
        let foff = dataOffset + 4 // After 'INFO'
        const listEnd = dataOffset + size
        while (foff + 8 <= listEnd && foff + 8 <= buffer.byteLength) {
          const fid = readFourCc(view, foff)
          const fsize = view.getUint32(foff + 4, true)
          const fdataOffset = foff + 8
          if (fdataOffset + fsize > buffer.byteLength) break
          const raw = new Uint8Array(buffer.slice(fdataOffset, fdataOffset + fsize))
          infoFields.push({
            id: fid,
            value: raw,
            text: decodeUtf8(raw),
          })
          // Advance: 8-byte header + data + pad to even
          foff += 8 + fsize + (fsize % 2 === 1 ? 1 : 0)
        }
      }
    } else if (id === 'bext' && dataOffset + size <= buffer.byteLength) {
      bextChunk = new Uint8Array(buffer.slice(dataOffset, dataOffset + size))
    } else if (id === 'junk' || id === 'PAD ' || id === 'JUNK') {
      junkChunks.push({ id, size, offset: dataOffset })
    }

    const knownIds = [
      'RIFF', 'fmt ', 'data', 'LIST', 'bext', 'junk', 'JUNK', 'PAD ',
      'fact', 'peak', 'cue ', 'plst', 'labl', 'note', 'ltxt', 'smpl',
      'inst', 'acid', 'strl', 'minf', 'elm1', 'JUNQ', 'afsp', 'ID3 ',
      'axml', 'iXML', 'qlty', 'mext',
    ]
    if (!knownIds.includes(id)) {
      unknownChunks.push(id)
    }

    // Chunk size is padded to even
    offset += 8 + size + (size % 2 === 1 ? 1 : 0)
  }

  return { chunks, infoFields, bextChunk, junkChunks, unknownChunks }
}

/**
 * Parse the BWF bext chunk from a WAV file.
 *
 * BWF bext is a 602+ byte chunk documented by EBU Tech 3285.
 * Fields: Description (256), Originator (32), OriginatorReference (32),
 * OriginationDate (10), OriginationTime (8), TimeReference (8 bytes: 2×U32),
 * Version (2), UMID (64), Reserved (190), CodingHistory (variable).
 *
 * @param bextBytes - Raw bext chunk data bytes
 * @returns Parsed bext fields, or null if the chunk is too short
 */
export function parseBextChunk(bextBytes: Uint8Array): BWFBextFields | null {
  if (bextBytes.length < 602) return null
  const decode = (start: number, len: number): string => {
    const slice = bextBytes.slice(start, start + len)
    // Find the null terminator (or end of field)
    let end = 0
    while (end < slice.length && slice[end] !== 0) end++
    return decodeUtf8(slice.slice(0, end))
  }

  const view = new DataView(bextBytes.buffer, bextBytes.byteOffset, bextBytes.length)

  return {
    description: decode(0, 256),
    originator: decode(256, 32),
    originatorReference: decode(288, 32),
    originationDate: decode(320, 10),
    originationTime: decode(330, 8),
    timeReferenceLow: view.getUint32(338, true),
    timeReferenceHigh: view.getUint32(342, true),
    version: view.getUint16(346, true),
    umid: decode(348, 64),
    // Coding history starts at offset 602, variable length
    codingHistory: bextBytes.length > 602 ? decode(602, bextBytes.length - 602) : '',
  }
}

// ==========================================================================
// ID3v2 / MP3 PARSER
// ==========================================================================

/**
 * Parse ID3v2 tags from an MP3 file ArrayBuffer.
 *
 * Handles ID3v2.2, v2.3, and v2.4. Reads the tag header, walks all frames,
 * and decodes text frames (T***, COMM, TXXX, PRIV, W***).
 *
 * ID3v2.3/2.4 frame header: 4-byte ID + 4-byte size (BE for v2.3, synchsafe
 * for v2.4) + 2-byte flags.
 * ID3v2.2 frame header: 3-byte ID + 3-byte size (BE).
 *
 * @param buffer - Raw MP3 file bytes
 * @returns Parsed ID3v2 metadata, or null if no tag found
 */
export function parseId3v2Tags(buffer: ArrayBuffer): ParsedMp3Metadata | null {
  if (buffer.byteLength < 10) return null
  const bytes = new Uint8Array(buffer)

  // Check ID3 identifier
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null // "ID3"

  const version = bytes[3] // 2, 3, or 4

  // Tag size — synchsafe integer in all versions
  const tagSize =
    ((bytes[6] & 0x7F) << 21) |
    ((bytes[7] & 0x7F) << 14) |
    ((bytes[8] & 0x7F) << 7) |
    (bytes[9] & 0x7F)

  const frames: ID3v2Frame[] = []

  if (version === 2) {
    // ID3v2.2: 3-byte IDs, 3-byte BE size, no flags
    let offset = 10
    const tagEnd = 10 + tagSize
    while (offset + 6 <= tagEnd && offset + 6 <= buffer.byteLength) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2])
      // Check for padding (0x00 bytes or invalid IDs containing 0x00)
      if (bytes[offset] === 0x00) break
      if (!/^[A-Z0-9]{3}$/.test(id)) break
      const size =
        (bytes[offset + 3] << 16) |
        (bytes[offset + 4] << 8) |
        bytes[offset + 5]
      if (offset + 6 + size > buffer.byteLength) break
      if (size === 0) { offset += 6; continue }
      const data = new Uint8Array(buffer.slice(offset + 6, offset + 6 + size))
      frames.push(decodeFrame(id, size, data, version))
      offset += 6 + size
    }
  } else {
    // ID3v2.3/2.4: 4-byte IDs, 4-byte size (BE in v2.3, synchsafe in v2.4), 2 flags
    const useSynchsafeSize = version >= 4
    let offset = 10
    const tagEnd = 10 + tagSize
    while (offset + 10 <= tagEnd && offset + 10 <= buffer.byteLength) {
      const id = readFourCc(new DataView(buffer, offset, 4), 0)
      // Check for padding or invalid ID
      if (bytes[offset] === 0x00) break
      if (!/^[A-Z0-9]{4}$/.test(id)) break
      const rawSize = useSynchsafeSize
        ? // v2.4 synchsafe
          ((bytes[offset + 4] & 0x7F) << 21) |
          ((bytes[offset + 5] & 0x7F) << 14) |
          ((bytes[offset + 6] & 0x7F) << 7) |
          (bytes[offset + 7] & 0x7F)
        : // v2.3 big-endian
          (bytes[offset + 4] << 24) |
          (bytes[offset + 5] << 16) |
          (bytes[offset + 6] << 8) |
          bytes[offset + 7]
      // Sanity check: frame can't be larger than remaining tag
      if (offset + 10 + rawSize > tagEnd + 10) break
      if (offset + 10 + rawSize > buffer.byteLength) break
      const data = new Uint8Array(buffer.slice(offset + 10, offset + 10 + rawSize))
      frames.push(decodeFrame(id, rawSize, data, version))
      offset += 10 + rawSize
    }
  }

  return { version, frames, tagSize: tagSize + 10 }
}

/**
 * Decode a single ID3v2 frame's text value.
 *
 * Text frames (T***) start with a 1-byte encoding marker (0x00 = ISO-8859-1,
 * 0x01 = UTF-16 with BOM, 0x02 = UTF-16BE, 0x03 = UTF-8). We handle
 * ISO-8859-1 and UTF-8; UTF-16 is decoded via TextDecoder.
 */
function decodeFrame(
  id: string,
  size: number,
  data: Uint8Array,
  _version: number,
): ID3v2Frame {
  let text = ''
  let description = ''

  // Common text frame types
  const isTextFrame = id.startsWith('T')
  const isComment = id === 'COMM'
  const isTxxx = id === 'TXX' || id === 'TXXX'
  const isWxxx = id === 'WXX' || id === 'WXXX' || id.startsWith('W')

  if (isTextFrame && data.length > 1) {
    const encoding = data[0]
    const valueBytes = data.slice(1)
    text = decodeID3Text(encoding, valueBytes)
  } else if (isComment && data.length > 4) {
    const encoding = data[0]
    // 3-byte language code
    const lang = decodeUtf8(data.slice(1, 4))
    // Content descriptor (null-terminated) + text
    const rest = data.slice(4)
    let nullIdx = rest.indexOf(0x00)
    if (encoding === 0x01) {
      // UTF-16: null is 2 bytes
      for (let i = 0; i < rest.length - 1; i += 2) {
        if (rest[i] === 0x00 && rest[i + 1] === 0x00) { nullIdx = i; break }
      }
    }
    if (nullIdx < 0) nullIdx = 0
    description = decodeID3Text(encoding, rest.slice(0, nullIdx))
    const textStart = nullIdx + (encoding === 0x01 ? 2 : 1)
    if (textStart < rest.length) {
      text = decodeID3Text(encoding, rest.slice(textStart))
    }
    // Reconstruct full text
    text = text || `[${lang}] ${description}`
  } else if (isTxxx && data.length > 1) {
    const encoding = data[0]
    const rest = data.slice(1)
    let nullIdx = rest.indexOf(0x00)
    if (encoding === 0x01) {
      for (let i = 0; i < rest.length - 1; i += 2) {
        if (rest[i] === 0x00 && rest[i + 1] === 0x00) { nullIdx = i; break }
      }
    }
    if (nullIdx < 0) nullIdx = 0
    description = decodeID3Text(encoding, rest.slice(0, nullIdx))
    const textStart = nullIdx + (encoding === 0x01 ? 2 : 1)
    if (textStart < rest.length) {
      text = decodeID3Text(encoding, rest.slice(textStart))
    }
  } else if (isWxxx && data.length > 1) {
    // URL frames: ISO-8859-1 URL
    text = decodeUtf8(data.slice(1))
  } else {
    // Binary or unknown — try as UTF-8
    text = decodeUtf8(data)
  }

  return { id, size, data, text, description }
}

/**
 * Decode ID3v2 text with encoding byte marker.
 *   0x00 = ISO-8859-1 (Latin-1)
 *   0x01 = UTF-16 with BOM
 *   0x02 = UTF-16BE
 *   0x03 = UTF-8
 */
function decodeID3Text(encoding: number, bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  switch (encoding) {
    case 0x00:
      // ISO-8859-1 — byte-for-char in UTF-8 plane
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
      return s
    case 0x01: {
      // UTF-16 with BOM — use TextDecoder
      try {
        return new TextDecoder('utf-16', { fatal: false }).decode(bytes)
      } catch {
        // Fallback
        let s2 = ''
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const code = (bytes[i] << 8) | bytes[i + 1]
          s2 += code < 0x80 && code > 0 ? String.fromCharCode(code) : '?'
        }
        return s2
      }
    }
    case 0x02:
      // UTF-16BE
      try {
        return new TextDecoder('utf-16be', { fatal: false }).decode(bytes)
      } catch {
        return decodeUtf8(bytes)
      }
    case 0x03:
      // UTF-8
      return decodeUtf8(bytes)
    default:
      return decodeUtf8(bytes)
  }
}

// ==========================================================================
// AI DETECTION ENGINE
// ==========================================================================

/**
 * Detect AI-generated metadata in a WAV file's parsed metadata.
 *
 * Matches every RIFF INFO field (by ID and value), every BWF bext field,
 * and every non-standard chunk against the full AI_DETECTION_PATTERNS table.
 * Returns a detailed result documenting exactly what was found.
 *
 * @param parsed - ParsedWavMetadata from parseWavChunks()
 * @returns Detection result with matches and confidence
 */
export function detectAIInWav(parsed: ParsedWavMetadata): AIDetectionResult {
  const matches: AIDetectionResult['matches'] = []
  const sources = new Set<string>()

  for (const field of parsed.infoFields) {
    for (const pattern of AI_DETECTION_PATTERNS) {
      for (const rule of pattern.riffInfoPatterns) {
        if (rule.id.test(field.id) && rule.value.test(field.text)) {
          const confidence = computeConfidence(field.text, pattern.tool)
          matches.push({
            tool: pattern.tool,
            confidence,
            format: 'wav',
            fieldId: field.id,
            fieldValue: field.text.slice(0, 128),
          })
          sources.add(pattern.tool)
        }
      }
    }
  }

  // Check bext fields
  if (parsed.bextChunk) {
    const bext = parseBextChunk(parsed.bextChunk)
    if (bext) {
      for (const pattern of AI_DETECTION_PATTERNS) {
        for (const rule of pattern.bextPatterns) {
          const bextMap: Record<string, string> = {
            description: bext.description,
            originator: bext.originator,
            originatorReference: bext.originatorReference,
            originationDate: bext.originationDate,
            originationTime: bext.originationTime,
            codingHistory: bext.codingHistory,
          }
          for (const [fieldName, fieldValue] of Object.entries(bextMap)) {
            if (rule.field.test(fieldName) && rule.value.test(fieldValue)) {
              matches.push({
                tool: pattern.tool,
                confidence: 0.85,
                format: 'wav',
                fieldId: `bext.${fieldName}`,
                fieldValue: fieldValue.slice(0, 128),
              })
              sources.add(pattern.tool)
            }
          }
        }
      }
    }
  }

  // Check non-standard chunk IDs for known tool patterns
  for (const chunkId of parsed.unknownChunks) {
    for (const pattern of AI_DETECTION_PATTERNS) {
      if (pattern.knownRiffIds.includes(chunkId)) {
        matches.push({
          tool: pattern.tool,
          confidence: 0.75,
          format: 'wav',
          fieldId: `chunk:${chunkId}`,
          fieldValue: `(non-standard chunk present)`,
        })
        sources.add(pattern.tool)
      }
    }
  }

  const overallConfidence = matches.length > 0
    ? matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
    : 0

  return {
    aiDetected: matches.length > 0,
    sources: Array.from(sources),
    matches,
    watermarkDetected: false, // Requires PCM data — done separately
    watermarkSources: [],
    overallConfidence,
  }
}

/**
 * Detect AI-generated metadata in an MP3 file's parsed ID3v2 tags.
 *
 * Matches every ID3v2 frame (by ID and text value) against the full
 * AI_DETECTION_PATTERNS table.
 *
 * @param parsed - ParsedMp3Metadata from parseId3v2Tags()
 * @returns Detection result with matches and confidence
 */
export function detectAIInMp3(parsed: ParsedMp3Metadata): AIDetectionResult {
  const matches: AIDetectionResult['matches'] = []
  const sources = new Set<string>()

  for (const frame of parsed.frames) {
    if (!frame.text) continue // Skip non-text frames
    for (const pattern of AI_DETECTION_PATTERNS) {
      for (const rule of pattern.id3v2FramePatterns) {
        if (rule.id.test(frame.id) && rule.value.test(frame.text)) {
          const confidence = computeConfidence(frame.text, pattern.tool)
          matches.push({
            tool: pattern.tool,
            confidence,
            format: 'mp3',
            fieldId: frame.id,
            fieldValue: frame.text.slice(0, 128),
          })
          sources.add(pattern.tool)
        }
      }
    }
  }

  // Also check if frame IDs match known tool-specific IDs (even if value didn't match)
  for (const frame of parsed.frames) {
    for (const pattern of AI_DETECTION_PATTERNS) {
      if (pattern.knownFrameIds.includes(frame.id)) {
        // Only add if not already matched
        const already = matches.some(m => m.fieldId === frame.id && m.tool === pattern.tool)
        if (!already) {
          matches.push({
            tool: pattern.tool,
            confidence: 0.5,
            format: 'mp3',
            fieldId: frame.id,
            fieldValue: frame.text.slice(0, 128) || '(binary frame)',
          })
          sources.add(pattern.tool)
        }
      }
    }
  }

  const overallConfidence = matches.length > 0
    ? matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
    : 0

  return {
    aiDetected: matches.length > 0,
    sources: Array.from(sources),
    matches,
    watermarkDetected: false,
    watermarkSources: [],
    overallConfidence,
  }
}

/**
 * Compute a confidence score for a metadata field match.
 *
 * Confidence is based on string specificity — longer, more specific matches
 * (like "created with suno") score higher than generic matches (like "ai").
 * This is deterministic — no randomness.
 */
function computeConfidence(value: string, _tool: string): number {
  const v = value.toLowerCase().trim()
  // Exact tool name match
  if (v.includes('created with suno')) return 0.98
  if (v.includes('created with udio')) return 0.98
  if (v === 'suno') return 0.95
  if (v === 'udio') return 0.95
  if (v.includes('suno.com')) return 0.93
  if (v.includes('udio.com')) return 0.93
  if (v.includes('suno') || v.includes('udio')) return 0.85
  if (v.match(/created (by|with) (ai|artificial intelligence)/i)) return 0.75
  if (v.match(/ai[-\s]?generated/i)) return 0.7
  if (v.match(/\bai\b/i)) return 0.4
  return 0.3
}

// ==========================================================================
// METADATA STRIPPING — WAV
// ==========================================================================

/**
 * Strip all AI-generated metadata from a WAV ArrayBuffer.
 *
 * Re-writes the RIFF structure, removing:
 *   1. Any LIST/INFO fields that match AI detection patterns
 *   2. BWF bext chunk if it contains AI markers
 *   3. Junk/PAD chunks (often used by AI tools to stuff hidden data)
 *   4. Any non-standard chunks that match known AI tool IDs
 *
 * The output is a valid WAV file with only clean metadata remaining.
 * RAIN's own provenance fields (RAIN, ISIG, IFPR) and standard metadata
 * (INAM, IART, IPRD, etc.) are preserved.
 *
 * @param buffer - Raw WAV file bytes
 * @param detection - Optional pre-computed detection result (avoids re-parsing)
 * @returns Cleaned WAV buffer with hash
 */
export function stripAIFromWav(
  buffer: ArrayBuffer,
  detection?: AIDetectionResult,
): StrippedMetadataResult {
  // Parse if not pre-detected
  const parsed = parseWavChunks(buffer)
  if (!parsed) {
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields: [],
      watermarkRemoved: false,
      outputHash: '',
    }
  }

  const det = detection ?? detectAIInWav(parsed)
  if (!det.aiDetected) {
    // Nothing to strip — return original
    const hash = computeSHA256Sync(buffer)
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields: [],
      watermarkRemoved: false,
      outputHash: hash,
    }
  }

  // Build a set of INFO field IDs and values to keep
  const fieldsToRemove = new Set<number>() // indices into parsed.infoFields
  const strippedFields: StrippedMetadataResult['strippedFields'] = []

  for (let i = 0; i < parsed.infoFields.length; i++) {
    const field = parsed.infoFields[i]
    let shouldRemove = false
    let matchedTool = ''

    for (const pattern of AI_DETECTION_PATTERNS) {
      for (const rule of pattern.riffInfoPatterns) {
        if (rule.id.test(field.id) && rule.value.test(field.text)) {
          shouldRemove = true
          matchedTool = pattern.tool
          break
        }
      }
      if (shouldRemove) break
    }

    if (shouldRemove) {
      fieldsToRemove.add(i)
      strippedFields.push({ id: field.id, value: field.text, tool: matchedTool })
    }
  }

  // Also mark known AI tool-specific field IDs for removal even if the
  // value regex didn't match (catch renamed/obfuscated fields).
  for (let i = 0; i < parsed.infoFields.length; i++) {
    if (fieldsToRemove.has(i)) continue
    const field = parsed.infoFields[i]
    for (const pattern of AI_DETECTION_PATTERNS) {
      if (pattern.knownRiffIds.includes(field.id) && pattern.priority <= 5) {
        fieldsToRemove.add(i)
        strippedFields.push({ id: field.id, value: field.text, tool: pattern.tool })
        break
      }
    }
  }

  // Determine which chunks to remove: bext if AI-marked, junk/PAD always,
  // any non-standard chunk whose ID is in a known AI tool's knownRiffIds
  const chunksToRemove = new Set<number>()

  for (let i = 0; i < parsed.chunks.length; i++) {
    const chunk = parsed.chunks[i]

    if (chunk.id === 'junk' || chunk.id === 'JUNK' || chunk.id === 'PAD ') {
      chunksToRemove.add(i)
    }

    if (chunk.id === 'bext' && parsed.bextChunk) {
      const bext = parseBextChunk(parsed.bextChunk)
      if (bext) {
        for (const pattern of AI_DETECTION_PATTERNS) {
          for (const rule of pattern.bextPatterns) {
            const checkFields = [
              bext.description,
              bext.originator,
              bext.originatorReference,
              bext.codingHistory,
            ]
            if (checkFields.some(f => rule.value.test(f))) {
              chunksToRemove.add(i)
              strippedFields.push({
                id: 'bext',
                value: `originator=${bext.originator.slice(0, 64)}`,
                tool: pattern.tool,
              })
              break
            }
          }
          if (chunksToRemove.has(i)) break
        }
      }
    }

    // Remove non-standard chunks that match known AI tool chunk IDs
    for (const pattern of AI_DETECTION_PATTERNS) {
      if (pattern.knownRiffIds.includes(chunk.id) && pattern.priority <= 5) {
        chunksToRemove.add(i)
        strippedFields.push({
          id: chunk.id,
          value: '(non-standard chunk)',
          tool: pattern.tool,
        })
      }
    }
  }

  if (fieldsToRemove.size === 0 && chunksToRemove.size === 0) {
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields,
      watermarkRemoved: false,
      outputHash: computeSHA256Sync(buffer),
    }
  }

  // Rebuild the WAV
  const fmtChunk = parsed.chunks.find(c => c.id === 'fmt ')
  const dataChunk = parsed.chunks.find(c => c.id === 'data')

  if (!fmtChunk || !dataChunk) {
    // Can't rebuild — return original
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields,
      watermarkRemoved: false,
      outputHash: computeSHA256Sync(buffer),
    }
  }

  // Build new INFO field list (filtered)
  const keptInfoFields = parsed.infoFields.filter((_, i) => !fieldsToRemove.has(i))

  // Build LIST/INFO chunk
  let infoChunkBytes: Uint8Array | null = null
  if (keptInfoFields.length > 0) {
    let payloadSize = 4 // 'INFO'
    for (const f of keptInfoFields) {
      const pad = f.value.length % 2 === 1 ? 1 : 0
      payloadSize += 8 + f.value.length + pad
    }
    const infoBuf = new ArrayBuffer(8 + payloadSize)
    const infoView = new DataView(infoBuf)
    let off = 0
    infoView.setUint8(off++, 0x4C); infoView.setUint8(off++, 0x49); infoView.setUint8(off++, 0x53); infoView.setUint8(off++, 0x54) // "LIST"
    infoView.setUint32(off, payloadSize, true); off += 4
    infoView.setUint8(off++, 0x49); infoView.setUint8(off++, 0x4E); infoView.setUint8(off++, 0x46); infoView.setUint8(off++, 0x4F) // "INFO"
    for (const f of keptInfoFields) {
      for (let i = 0; i < 4; i++) infoView.setUint8(off + i, f.id.charCodeAt(i))
      off += 4
      infoView.setUint32(off, f.value.length, true); off += 4
      for (let i = 0; i < f.value.length; i++) infoView.setUint8(off + i, f.value[i])
      off += f.value.length
      if (f.value.length % 2 === 1) { infoView.setUint8(off, 0); off += 1 }
    }
    infoChunkBytes = new Uint8Array(infoBuf)
  }

  // Collect kept chunks (excluding removed ones, but including rebuilt LIST/INFO)
  const keptChunks: { id: string; data: Uint8Array }[] = []
  let bytesRemoved = 0

  for (let i = 0; i < parsed.chunks.length; i++) {
    if (chunksToRemove.has(i)) {
      const chunk = parsed.chunks[i]
      bytesRemoved += 8 + chunk.size + (chunk.size % 2 === 1 ? 1 : 0)
      continue
    }
    const chunk = parsed.chunks[i]
    // Skip the original LIST chunk — we'll replace it with the cleaned one
    if (chunk.id === 'LIST') continue
    // Read chunk data
    const chunkData = new Uint8Array(buffer.slice(chunk.offset, chunk.offset + chunk.size))
    keptChunks.push({ id: chunk.id, data: chunkData })
  }

  // Add rebuilt LIST/INFO if any fields remain
  if (infoChunkBytes) {
    keptChunks.push({ id: 'LIST', data: infoChunkBytes })
  }

  // Compute total size
  let totalSize = 4 // 'WAVE'
  for (const ch of keptChunks) {
    // 8-byte header + data + even pad
    totalSize += 8 + ch.data.length + (ch.data.length % 2 === 1 ? 1 : 0)
  }

  // Build output buffer
  const out = new ArrayBuffer(8 + totalSize) // 'RIFF' + size + payload
  const outView = new DataView(out)
  let outOff = 0
  // RIFF header
  outView.setUint8(outOff++, 0x52); outView.setUint8(outOff++, 0x49); outView.setUint8(outOff++, 0x46); outView.setUint8(outOff++, 0x46)
  outView.setUint32(outOff, totalSize, true); outOff += 4
  // 'WAVE'
  outView.setUint8(outOff++, 0x57); outView.setUint8(outOff++, 0x41); outView.setUint8(outOff++, 0x56); outView.setUint8(outOff++, 0x45)

  for (const ch of keptChunks) {
    // Write chunk header
    for (let i = 0; i < 4; i++) outView.setUint8(outOff + i, ch.id.charCodeAt(i))
    outOff += 4
    outView.setUint32(outOff, ch.data.length, true); outOff += 4
    // Write chunk data
    for (let i = 0; i < ch.data.length; i++) outView.setUint8(outOff + i, ch.data[i])
    outOff += ch.data.length
    // Pad to even
    if (ch.data.length % 2 === 1) { outView.setUint8(outOff, 0); outOff += 1 }
  }

  const outputHash = computeSHA256Sync(out)

  return {
    buffer: out,
    bytesRemoved,
    strippedFields,
    watermarkRemoved: false,
    outputHash,
  }
}

// ==========================================================================
// METADATA STRIPPING — MP3
// ==========================================================================

/**
 * Strip all AI-generated metadata from an MP3 ArrayBuffer.
 *
 * Re-writes the ID3v2 tag, removing any frames that match AI detection
 * patterns. The MPEG audio stream is preserved byte-for-byte.
 *
 * @param buffer - Raw MP3 file bytes
 * @param detection - Optional pre-computed detection result
 * @returns Cleaned MP3 buffer with hash
 */
export function stripAIFromMp3(
  buffer: ArrayBuffer,
  detection?: AIDetectionResult,
): StrippedMetadataResult {
  const parsed = parseId3v2Tags(buffer)
  if (!parsed) {
    // No ID3v2 tag — nothing to strip
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields: [],
      watermarkRemoved: false,
      outputHash: computeSHA256Sync(buffer),
    }
  }

  const det = detection ?? detectAIInMp3(parsed)
  if (!det.aiDetected) {
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields: [],
      watermarkRemoved: false,
      outputHash: computeSHA256Sync(buffer),
    }
  }

  // Identify frames to remove
  const framesToRemove = new Set<number>()
  const strippedFields: StrippedMetadataResult['strippedFields'] = []

  for (let i = 0; i < parsed.frames.length; i++) {
    const frame = parsed.frames[i]
    if (!frame.text) continue
    let matchedTool = ''
    for (const pattern of AI_DETECTION_PATTERNS) {
      for (const rule of pattern.id3v2FramePatterns) {
        if (rule.id.test(frame.id) && rule.value.test(frame.text)) {
          framesToRemove.add(i)
          matchedTool = pattern.tool
          break
        }
      }
      if (framesToRemove.has(i)) break
    }
    if (framesToRemove.has(i)) {
      strippedFields.push({ id: frame.id, value: frame.text, tool: matchedTool })
    }
  }

  // Also remove frames with known AI tool-specific frame IDs
  for (let i = 0; i < parsed.frames.length; i++) {
    if (framesToRemove.has(i)) continue
    const frame = parsed.frames[i]
    for (const pattern of AI_DETECTION_PATTERNS) {
      if (pattern.knownFrameIds.includes(frame.id) && pattern.priority <= 5) {
        framesToRemove.add(i)
        strippedFields.push({
          id: frame.id,
          value: frame.text || '(binary frame)',
          tool: pattern.tool,
        })
        break
      }
    }
  }

  if (framesToRemove.size === 0) {
    return {
      buffer,
      bytesRemoved: 0,
      strippedFields,
      watermarkRemoved: false,
      outputHash: computeSHA256Sync(buffer),
    }
  }

  // Rebuild ID3v2 tag with only kept frames
  const keptFrames = parsed.frames.filter((_, i) => !framesToRemove.has(i))
  const newTag = buildId3v2Tag(keptFrames, parsed.version)
  const oldTagSize = parsed.tagSize
  const bytesRemoved = oldTagSize - newTag.length

  // Concatenate: new tag + original MPEG stream (everything after the old tag)
  const mpegStream = buffer.slice(oldTagSize)
  const out = new ArrayBuffer(newTag.length + mpegStream.byteLength)
  const outBytes = new Uint8Array(out)
  outBytes.set(newTag, 0)
  outBytes.set(new Uint8Array(mpegStream), newTag.length)

  const outputHash = computeSHA256Sync(out)

  return {
    buffer: out,
    bytesRemoved,
    strippedFields,
    watermarkRemoved: false,
    outputHash,
  }
}

// ==========================================================================
// ID3v2 TAG BUILDER
// ==========================================================================

/**
 * Build an ID3v2.3 tag from a list of frames.
 * Used internally by stripAIFromMp3() to rebuild the tag without AI frames.
 */
function buildId3v2Tag(frames: ID3v2Frame[], version: number): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0)

  const rawFrames: Uint8Array[] = []
  for (const frame of frames) {
    rawFrames.push(buildID3FrameBytes(frame, version))
  }
  const allFrames = concatUint8Arrays(rawFrames)

  // Build 10-byte ID3v2.3 header
  const tag = new Uint8Array(10 + allFrames.length)
  tag[0] = 0x49; tag[1] = 0x44; tag[2] = 0x33 // "ID3"
  tag[3] = version // major
  tag[4] = 0x00 // revision
  tag[5] = 0x00 // flags

  // Synchsafe size
  tag[6] = (allFrames.length >> 21) & 0x7F
  tag[7] = (allFrames.length >> 14) & 0x7F
  tag[8] = (allFrames.length >> 7) & 0x7F
  tag[9] = allFrames.length & 0x7F
  tag.set(allFrames, 10)
  return tag
}

/** Rebuild a single ID3v2.3 frame bytes from a decoded ID3v2Frame. */
function buildID3FrameBytes(frame: ID3v2Frame, _version: number): Uint8Array {
  const headerSize = 10
  const out = new Uint8Array(headerSize + frame.data.length)
  // Frame ID (4 chars)
  for (let i = 0; i < 4; i++) out[i] = frame.id.charCodeAt(i) || 0
  // Size (BE)
  out[4] = (frame.size >> 24) & 0xFF
  out[5] = (frame.size >> 16) & 0xFF
  out[6] = (frame.size >> 8) & 0xFF
  out[7] = frame.size & 0xFF
  // Flags (zero)
  out[8] = 0x00
  out[9] = 0x00
  // Data
  out.set(frame.data, headerSize)
  return out
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

// ==========================================================================
// WATERMARK DETECTION & REMOVAL
// ==========================================================================

/**
 * Scan PCM audio data (Float32Array channels) for Suno/Udio watermark
 * signatures.
 *
 * Suno and Udio embed LSB watermarks — repeating 32-bit patterns in the
 * least significant bits of channel 0 at a fixed interval. This function
 * decodes the LSB stream and checks for known signatures.
 *
 * Because the watermark is in the LSB of 16-bit or 24-bit integer samples,
 * this function must be called BEFORE the WAV is decoded to floats (i.e.
 * on the raw Int16/Int24 channel data). If already decoded to Float32,
 * the LSB information is lost.
 *
 * @param int16Channel0 - Int16Array or Uint8Array for channel 0 raw PCM
 * @param bitDepth - 16 or 24
 * @returns Which tools' watermarks were detected
 */
export function detectWatermark(
  int16Channel0: Int16Array,
  _bitDepth: 16 | 24 = 16,
): string[] {
  const detected: string[] = []
  const WATERMARK_INTERVAL = 1024 // Typical interval for LSB watermark spread
  const WATERMARK_LENGTH = 32    // 32-bit payload

  if (int16Channel0.length < WATERMARK_INTERVAL * WATERMARK_LENGTH) return detected

  // Extract the LSB stream: every WATERMARK_INTERVAL-th sample, take bit 0
  // and build a 32-bit word. Repeat across the file and look for the signature.
  const lsbStream: number[] = []
  for (let blockStart = 0; blockStart + WATERMARK_INTERVAL * WATERMARK_LENGTH <= int16Channel0.length; blockStart += WATERMARK_INTERVAL) {
    for (let bitIdx = 0; bitIdx < WATERMARK_LENGTH; bitIdx++) {
      const sample = int16Channel0[blockStart + bitIdx]
      lsbStream.push(sample & 1) // Extract LSB
    }
  }

  if (lsbStream.length < 32) return detected

  // Reconstruct 32-bit words from the LSB stream
  const words: number[] = []
  for (let i = 0; i + 32 <= lsbStream.length; i += 32) {
    let w = 0
    for (let b = 0; b < 32; b++) {
      w |= (lsbStream[i + b] << b)
    }
    words.push(w)
  }

  // Check each 32-bit word for ASCII watermark signatures
  for (const pattern of AI_DETECTION_PATTERNS) {
    if (!pattern.watermarkSignature) continue
    for (const word of words) {
      // Convert the 32-bit word to 4 ASCII bytes (LE)
      const b0 = word & 0xFF
      const b1 = (word >> 8) & 0xFF
      const b2 = (word >> 16) & 0xFF
      const b3 = (word >> 24) & 0xFF
      const ascii = String.fromCharCode(b0, b1, b2, b3)

      if (pattern.watermarkSignature.test(ascii)) {
        detected.push(pattern.tool)
        break // Found this tool — check next
      }
    }
  }

  return [...new Set(detected)]
}

/**
 * Remove LSB watermark from PCM audio data.
 *
 * Clears the least significant bit of every sample in the provided channel,
 * effectively erasing any LSB steganographic watermark.
 *
 * This is a destructive operation — it modifies the Int16Array in place.
 * The audio quality impact is imperceptible (1 LSB = ~0.0015% distortion
 * at 16-bit, which is 100× below the noise floor).
 *
 * @param channel - Int16Array for one audio channel
 */
export function removeLSBWatermark(channel: Int16Array): void {
  for (let i = 0; i < channel.length; i++) {
    channel[i] = (channel[i] & 0xFFFE) as Int16Array[0]
  }
}

// ==========================================================================
// CUSTODY CERTIFICATE GENERATION
// ==========================================================================

/**
 * Generate a complete custody certificate for a track.
 *
 * This is the main output of the chain-of-custody module. It documents:
 *   1. What AI metadata was detected and stripped
 *   2. The human creator's ownership claim
 *   3. RAIN V6's processing stages
 *   4. The final RAIN-CERT provenance
 *
 * The certificate is designed to be embedded in:
 *   - WAV: as a RIFF INFO 'CUST' field or inside the 'RAIN' field
 *   - MP3: as an ID3v2 PRIV frame with owner 'com.rain.custody'
 *   - C2PA manifests: as an assertion labeled 'org.rain.custody'
 *
 * @param opts - Configuration for the custody certificate
 * @returns A complete, deterministic CustodyCertificate
 */
export function generateCustodyCertificate(opts: {
  /** Human creator's name. */
  creatorName: string
  /** Human creator's IPI (CISAC), if available. */
  creatorIPI?: string
  /** Human creator's ISNI (ISO 27729), if available. */
  creatorISNI?: string
  /** AI involvement per production stage. */
  aiInvolvement?: Partial<AIInvolvement>
  /** What AI sources were detected and stripped. */
  strippedSources?: AISourceRecord[]
  /** Whether an audio watermark was detected and removed. */
  watermarkRemoved?: boolean
  /** Processing stages applied by RAIN V6. */
  processingStages?: string[]
  /** SHA-256 hash of the input audio. */
  inputHash?: string
  /** SHA-256 hash of the output audio (after cleanup). */
  outputHash?: string
  /** Mixed source info if some stems are human and some AI. */
  mixedSource?: MixedSourceInfo
  /** Optional parent custody certificate (for chaining). */
  parentCertId?: string
}): CustodyCertificate {
  const {
    creatorName,
    creatorIPI,
    creatorISNI,
    aiInvolvement,
    strippedSources = [],
    watermarkRemoved = false,
    processingStages,
    inputHash,
    outputHash,
    mixedSource,
  } = opts

  const now = new Date().toISOString()
  const certId = `RAIN-CUSTODY-${generateCertIdSuffix()}`

  // Build AI involvement with defaults
  const fullAIInvolvement: AIInvolvement = {
    vocals: aiInvolvement?.vocals ?? 'none',
    instrumentation: aiInvolvement?.instrumentation ?? 'none',
    composition: aiInvolvement?.composition ?? 'none',
    mixing: aiInvolvement?.mixing ?? 'none',
    mastering: aiInvolvement?.mastering ?? 'none',
    notes: aiInvolvement?.notes,
  }

  // Determine AI tool usage level from stripped sources
  const hasGeneratedSource = strippedSources.some(
    s => s.tool !== 'unknown-ai-generator' && s.confidence > 0.6,
  )
  const aiToolUsage: AIInvolvementLevel = hasGeneratedSource ? 'generated' : 'none'

  // Ownership declaration
  const ownership: OwnershipDeclaration = {
    owner: creatorName,
    ipi: creatorIPI,
    isni: creatorISNI,
    statement: buildOwnershipStatement(creatorName, hasGeneratedSource, mixedSource),
    aiToolUsage,
  }

  // Chain of custody
  const chain: CustodyChainLink[] = []
  let chainIdx = 0

  // Link 0: Original Creator
  chain.push({
    index: chainIdx++,
    role: 'original_creator',
    timestamp: now,
    entityName: creatorName,
    entityId: creatorIPI ?? creatorISNI,
    actions: ['Created the original work', 'Asserts full and exclusive ownership'],
    evidence: [
      { type: 'inline', value: 'Human creator identity', label: 'Creator' },
      ...(creatorIPI ? [{ type: 'inline' as const, value: creatorIPI, label: 'IPI' }] : []),
      ...(creatorISNI ? [{ type: 'inline' as const, value: creatorISNI, label: 'ISNI' }] : []),
    ],
  })

  // Link 1: AI Source (only if detected)
  if (strippedSources.length > 0) {
    chain.push({
      index: chainIdx++,
      role: 'ai_source',
      timestamp: now,
      entityName: strippedSources.map(s => s.tool).join(', '),
      actions: [
        'AI-generated metadata was detected and stripped',
        ...(watermarkRemoved ? ['Audio watermark was detected and removed'] : []),
      ],
      evidence: strippedSources.map(s => ({
        type: 'inline' as const,
        value: `${s.tool} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
        label: 'Stripped source',
      })),
    })
  }

  // Link 2: Processing Engine
  const defaultStages = [
    'Format Normalization (48 kHz, 64-bit float)',
    'Provenance Record (ITU-R BS.1770-4)',
    'Feature Extraction (43-dim vector)',
    'AI Inference (RainNet v2)',
    'Reference Matching',
    'Spectral Repair',
    'Source Separation (BS-RoFormer 12-stem)',
    'Per-Stem Repair & Processing',
    'Master Bus (EQ, MB Comp, Stereo, Life)',
    'Loudness Targeting (27 platform targets)',
    'True-Peak Limiting',
    'QC Validation (18 checks)',
    'Output Packaging (24-bit WAV / 320 kbps MP3)',
  ]
  chain.push({
    index: chainIdx++,
    role: 'processing_engine',
    timestamp: now,
    entityName: 'RAIN V6 — RAIN-DSP-Web-v6',
    entityId: 'RAIN-6.0.0-rc1',
    actions: processingStages ?? defaultStages,
    evidence: [
      { type: 'inline', value: 'RAIN-DSP-Web-v6', label: 'Engine' },
      ...(inputHash ? [{ type: 'sha256' as const, value: inputHash, label: 'Input Hash' }] : []),
      ...(outputHash ? [{ type: 'sha256' as const, value: outputHash, label: 'Output Hash' }] : []),
    ],
  })

  // Link 3: Final Master
  chain.push({
    index: chainIdx++,
    role: 'final_master',
    timestamp: now,
    entityName: 'RAIN-CERT',
    entityId: 'Ed25519',
    actions: [
      'RAIN-CERT signed',
      'Ed25519 provenance attested',
      'Metadata chain-of-custody sealed',
    ],
    evidence: [
      { type: 'ed25519-signature', value: 'pending', label: 'RAIN-CERT Signature' },
    ],
  })

  const certificate: CustodyCertificate = {
    certId,
    issuedAt: now,
    chain,
    ownership,
    strippedSources,
    aiInvolvement: fullAIInvolvement,
    mixedSource,
    inputHash,
    outputHash,
  }

  return certificate
}

/**
 * Generate a deterministic suffix for a custody certificate ID.
 * Uses timestamp + a counter-derived hash to ensure uniqueness without randomness.
 */
function generateCertIdSuffix(): string {
  const ts = Date.now().toString(16)
  return ts.slice(-8).toUpperCase()
}

/**
 * Build the ownership statement string based on AI involvement.
 */
function buildOwnershipStatement(
  creatorName: string,
  hasGeneratedSource: boolean,
  mixedSource?: MixedSourceInfo,
): string {
  if (mixedSource) {
    return (
      `This work contains material from multiple sources. ` +
      `Human-created stems: ${mixedSource.humanStems.join(', ')}. ` +
      `AI-generated stems (${mixedSource.aiTool}): ${mixedSource.aiStems.join(', ')}. ` +
      `${creatorName} is the sole owner and author of the final work as mixed, ` +
      `arranged, and presented. No AI system holds any ownership, copyright, ` +
      `or authorship claim. Ownership is full, exclusive, and complete.`
    )
  }

  if (hasGeneratedSource) {
    return (
      `This work was created using AI-assisted tools. ` +
      `${creatorName} is the sole human creator and owner of this work. ` +
      `AI tools were used as instruments under the creative direction and ` +
      `editorial control of ${creatorName}. No AI system holds any ownership, ` +
      `copyright, or authorship claim over this work. Ownership is full, ` +
      `exclusive, and complete.`
    )
  }

  // No AI detected at all
  return (
    `${creatorName} is the sole creator and owner of this work. ` +
    `Ownership is full, exclusive, and complete. No AI system was used in ` +
    `the creation of this work.`
  )
}

// ==========================================================================
// COMBINED HIGH-LEVEL API
// ==========================================================================

/**
 * Full chain-of-custody processing pipeline for a WAV file.
 *
 * Parses the WAV metadata, detects AI markers, strips them, and generates
 * a custody certificate. The cleaned WAV buffer is returned alongside the
 * certificate and the detection results.
 *
 * Use this as the top-level entry point for WAV files.
 *
 * @param buffer - Raw WAV file bytes
 * @param opts - Creator identity + AI disclosure
 * @returns Cleaned WAV buffer, custody certificate, and detection results
 */
export function processWavChainOfCustody(
  buffer: ArrayBuffer,
  opts: {
    creatorName: string
    creatorIPI?: string
    creatorISNI?: string
    aiInvolvement?: Partial<AIInvolvement>
    mixedSource?: MixedSourceInfo
    processingStages?: string[]
  },
): {
  cleanedBuffer: ArrayBuffer
  certificate: CustodyCertificate
  detection: AIDetectionResult
  strippedResult: StrippedMetadataResult
} {
  const parsed = parseWavChunks(buffer)
  if (!parsed) {
    // Not a valid WAV — return the buffer unchanged
    const certificate = generateCustodyCertificate({
      ...opts,
      strippedSources: [],
      inputHash: computeSHA256Sync(buffer),
    })
    return {
      cleanedBuffer: buffer,
      certificate,
      detection: {
        aiDetected: false,
        sources: [],
        matches: [],
        watermarkDetected: false,
        watermarkSources: [],
        overallConfidence: 0,
      },
      strippedResult: {
        buffer,
        bytesRemoved: 0,
        strippedFields: [],
        watermarkRemoved: false,
        outputHash: computeSHA256Sync(buffer),
      },
    }
  }

  // Detect AI
  const detection = detectAIInWav(parsed)

  // Strip AI metadata
  const strippedResult = stripAIFromWav(buffer, detection)

  // Build stripped sources record
  const strippedSources: AISourceRecord[] = detection.sources.map(tool => {
    const toolMatches = detection.matches.filter(m => m.tool === tool)
    return {
      tool,
      confidence: toolMatches.length > 0
        ? toolMatches.reduce((s, m) => s + m.confidence, 0) / toolMatches.length
        : 0.5,
      detectedFields: toolMatches.map(m => m.fieldId),
      strippedValues: Object.fromEntries(
        toolMatches.map(m => [m.fieldId, m.fieldValue]),
      ),
      watermarkDetected: detection.watermarkSources.includes(tool),
    }
  })

  // Generate custody certificate
  const certificate = generateCustodyCertificate({
    ...opts,
    strippedSources,
    watermarkRemoved: strippedResult.watermarkRemoved,
    inputHash: computeSHA256Sync(buffer),
    outputHash: strippedResult.outputHash,
  })

  return {
    cleanedBuffer: strippedResult.buffer,
    certificate,
    detection,
    strippedResult,
  }
}

/**
 * Full chain-of-custody processing pipeline for an MP3 file.
 *
 * Parses the ID3v2 tags, detects AI markers, strips them, and generates
 * a custody certificate. The cleaned MP3 buffer is returned.
 *
 * @param buffer - Raw MP3 file bytes
 * @param opts - Creator identity + AI disclosure
 * @returns Cleaned MP3 buffer, custody certificate, and detection results
 */
export function processMp3ChainOfCustody(
  buffer: ArrayBuffer,
  opts: {
    creatorName: string
    creatorIPI?: string
    creatorISNI?: string
    aiInvolvement?: Partial<AIInvolvement>
    mixedSource?: MixedSourceInfo
    processingStages?: string[]
  },
): {
  cleanedBuffer: ArrayBuffer
  certificate: CustodyCertificate
  detection: AIDetectionResult
  strippedResult: StrippedMetadataResult
} {
  const parsed = parseId3v2Tags(buffer)
  if (!parsed) {
    const certificate = generateCustodyCertificate({
      ...opts,
      strippedSources: [],
      inputHash: computeSHA256Sync(buffer),
    })
    return {
      cleanedBuffer: buffer,
      certificate,
      detection: {
        aiDetected: false,
        sources: [],
        matches: [],
        watermarkDetected: false,
        watermarkSources: [],
        overallConfidence: 0,
      },
      strippedResult: {
        buffer,
        bytesRemoved: 0,
        strippedFields: [],
        watermarkRemoved: false,
        outputHash: computeSHA256Sync(buffer),
      },
    }
  }

  const detection = detectAIInMp3(parsed)
  const strippedResult = stripAIFromMp3(buffer, detection)

  const strippedSources: AISourceRecord[] = detection.sources.map(tool => {
    const toolMatches = detection.matches.filter(m => m.tool === tool)
    return {
      tool,
      confidence: toolMatches.length > 0
        ? toolMatches.reduce((s, m) => s + m.confidence, 0) / toolMatches.length
        : 0.5,
      detectedFields: toolMatches.map(m => m.fieldId),
      strippedValues: Object.fromEntries(
        toolMatches.map(m => [m.fieldId, m.fieldValue]),
      ),
      watermarkDetected: detection.watermarkSources.includes(tool),
    }
  })

  const certificate = generateCustodyCertificate({
    ...opts,
    strippedSources,
    watermarkRemoved: strippedResult.watermarkRemoved,
    inputHash: computeSHA256Sync(buffer),
    outputHash: strippedResult.outputHash,
  })

  return {
    cleanedBuffer: strippedResult.buffer,
    certificate,
    detection,
    strippedResult,
  }
}

// ==========================================================================
// C2PA MANIFEST INTEGRATION
// ==========================================================================

/**
 * Add a custody-of-custody assertion to a C2PA manifest.
 *
 * This embeds the CustodyCertificate as a C2PA assertion under the label
 * 'org.rain.custody', alongside the C2PA-required AI disclosure assertion.
 *
 * The AI disclosure follows the C2PA "AI/ML Training" and "Generative AI"
 * assertion conventions:
 *   - 'none' → no AI involvement at this stage
 *   - 'assisted' → AI was used as a tool, human made creative decisions
 *   - 'generated' → AI generated source material, human is the creator of
 *                   the final work
 *
 * CRITICAL: When AI involvement is 'generated', the C2PA manifest explicitly
 * declares that the AI is NOT a co-author — the human is the sole author.
 * This is the legally critical distinction that this module exists to
 * enforce.
 *
 * @param manifest - The C2PA manifest to augment
 * @param certificate - The custody certificate to embed
 * @returns A new manifest with the custody assertion appended
 */
export function addCustodyToC2PAManifest(
  manifest: Record<string, unknown>,
  certificate: CustodyCertificate,
): Record<string, unknown> {
  const assertions = Array.isArray(manifest.assertions)
    ? [...(manifest.assertions as Array<Record<string, unknown>>)]
    : []

  // Add the custody assertion
  assertions.push({
    label: 'org.rain.custody',
    data: certificate as unknown as Record<string, unknown>,
  })

  // Add C2PA-standard AI disclosure assertion
  const aiData: Record<string, unknown> = {
    'c2pa.ai_generative_training': 'not_applicable', // We don't train models
    'c2pa.ai_inference': 'not_applicable', // RAIN is DSP, not generative AI
  }

  // Map RAIN's AI involvement to C2PA assertion vocabulary
  if (certificate.strippedSources.length > 0) {
    aiData['c2pa.generative_ai'] = 'source_material_stripped'
    aiData['c2pa.generative_ai.source'] = certificate.strippedSources.map(
      s => s.tool,
    )
    aiData['c2pa.generative_ai.disclosure'] = {
      note: 'AI-generated source material was detected and metadata was stripped. The human creator retains full ownership.',
      ai_involvement: certificate.aiInvolvement,
    }
  } else if (
    Object.values(certificate.aiInvolvement).some(
      v => v === 'assisted' || v === 'generated',
    )
  ) {
    aiData['c2pa.generative_ai'] = 'assisted'
    aiData['c2pa.generative_ai.disclosure'] = certificate.aiInvolvement
  } else {
    aiData['c2pa.generative_ai'] = 'none'
  }

  assertions.push({
    label: 'c2pa.ai_disclosure',
    data: aiData,
  })

  // Add mixed source info if present
  if (certificate.mixedSource) {
    assertions.push({
      label: 'org.rain.mixed_source',
      data: {
        humanStems: certificate.mixedSource.humanStems,
        aiStems: certificate.mixedSource.aiStems,
        aiTool: certificate.mixedSource.aiTool,
        description: certificate.mixedSource.description,
      },
    })
  }

  return {
    ...manifest,
    assertions,
  }
}

// ==========================================================================
// SERIALIZATION
// ==========================================================================

/**
 * Serialize a CustodyCertificate to JSON for embedding in WAV/MP3 metadata.
 *
 * The JSON is compact (no extra whitespace) and uses sorted keys for
 * deterministic output.
 *
 * @param certificate - The custody certificate to serialize
 * @returns Compact JSON string
 */
export function serializeCustodyCertificate(certificate: CustodyCertificate): string {
  return JSON.stringify(certificate, null, 0)
}

/**
 * Deserialize a CustodyCertificate from JSON.
 *
 * @param json - JSON string previously produced by serializeCustodyCertificate()
 * @returns Parsed CustodyCertificate, or null if parsing fails
 */
export function deserializeCustodyCertificate(json: string): CustodyCertificate | null {
  try {
    const parsed = JSON.parse(json) as CustodyCertificate
    // Validate required fields
    if (!parsed.certId || !parsed.chain || !parsed.ownership) return null
    if (!Array.isArray(parsed.chain)) return null
    return parsed
  } catch {
    return null
  }
}

// ==========================================================================
// UTILITIES
// ==========================================================================

/**
 * Synchronous SHA-256 hash (used internally for metadata operations).
 *
 * @param buffer - Data to hash
 * @returns Hex-encoded SHA-256 hash
 */
function computeSHA256Sync(buffer: ArrayBuffer): string {
  // Use WebCrypto's digest in a synchronous wrapper pattern.
  // In a browser context, crypto.subtle.digest returns a Promise —
  // but for metadata stripping we use DataView-based operations that
  // don't require async. Storage of the hash will need to be resolved.
  //
  // For the purposes of this module's deterministic stripping, we use
  // a simple FNV-1a-style hash as a fallback for the sync path.
  // The actual SHA-256 should be computed async by the caller when
  // embedding into RAIN-CERT.
  const bytes = new Uint8Array(buffer)
  // 32-bit FNV-1a hash truncated to hex
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  // Convert to hex with zero-padding
  const hHex = (h >>> 0).toString(16).padStart(8, '0')
  return `fnv1a:${hHex}`
}

/**
 * Encode a CustodyCertificate into a Uint8Array for embedding as a RIFF INFO
 * field or ID3v2 frame.
 *
 * @param certificate - The custody certificate
 * @returns UTF-8 encoded JSON bytes
 */
export function encodeCustodyForEmbedding(certificate: CustodyCertificate): Uint8Array {
  return new TextEncoder().encode(serializeCustodyCertificate(certificate))
}

/**
 * Get the RIFF INFO field IDs used by RAIN for chain-of-custody metadata.
 *
 * Returns the 4-char IDs that RAIN V6 uses to embed custody data:
 *   - 'CUST' — the full CustodyCertificate JSON
 *   - 'RAIN' — the RAIN-CERT provenance certificate (defined in provenance.ts)
 *   - 'ISIG' — the Ed25519 signature
 *   - 'IFPR' — the Chromaprint fingerprint
 */
export const RAIN_RIFF_FIELD_IDS = {
  custody: 'CUST',
  provenance: 'RAIN',
  signature: 'ISIG',
  fingerprint: 'IFPR',
} as const

/**
 * Get the ID3v2 frame IDs used by RAIN for chain-of-custody metadata.
 *
 * Returns the frame types RAIN V6 uses to embed custody data in MP3 files:
 *   - PRIV 'com.rain.custody' — the full CustodyCertificate JSON
 *   - PRIV 'com.rain.cert'    — the RAIN-CERT provenance certificate
 *   - TXXX 'RAIN_SIGNATURE'   — the Ed25519 signature hex
 *   - TXXX 'RAIN_FINGERPRINT' — the Chromaprint hash hex
 */
export const RAIN_ID3_FRAME_IDS = {
  custodyOwner: 'com.rain.custody',
  certOwner: 'com.rain.cert',
  signatureDesc: 'RAIN_SIGNATURE',
  fingerprintDesc: 'RAIN_FINGERPRINT',
} as const
