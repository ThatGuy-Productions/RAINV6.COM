/**
 * RAIN V6 — Type Definitions
 * Canonical types shared across the mastering engine, store, DSP, and UI.
 *
 * Design intent: keep types pure (no runtime logic) so they can be safely
 * imported into both client and server code paths without side effects.
 */

// ---------------------------------------------------------------------------
// Macros — the 7 canonical creative controls (0.0 – 10.0)
// ---------------------------------------------------------------------------

export type MacroKey =
  | 'brighten'
  | 'glue'
  | 'width'
  | 'punch'
  | 'warmth'
  | 'space'
  | 'repair'

export type MacroValues = Record<MacroKey, number>

export type MacroSource = 'MODEL' | 'HEURISTIC' | 'MANUAL'

// ---------------------------------------------------------------------------
// ProcessingParams — 46 canonical DSP parameters per CLAUDE.md
// ---------------------------------------------------------------------------

export interface ProcessingParams {
  // Loudness target
  target_lufs: number
  true_peak_ceiling: number

  // Multiband dynamics (3-band)
  mb_threshold_low: number
  mb_threshold_mid: number
  mb_threshold_high: number
  mb_ratio_low: number
  mb_ratio_mid: number
  mb_ratio_high: number
  mb_attack_low: number
  mb_attack_mid: number
  mb_attack_high: number
  mb_release_low: number
  mb_release_mid: number
  mb_release_high: number

  // EQ (8-band parametric)
  eq_gains: number[]

  // Analog saturation
  analog_saturation: boolean
  saturation_drive: number
  saturation_mode: 'tape' | 'tube' | 'transformer'

  // Mid/Side processing
  ms_enabled: boolean
  mid_gain: number
  side_gain: number
  stereo_width: number

  // SAIL (Stem-Aware Intelligent Limiting)
  sail_enabled: boolean
  sail_stem_gains: number[]

  // Vinyl mode
  vinyl_mode: boolean

  // Macro controls
  macro_brighten: number
  macro_glue: number
  macro_width: number
  macro_punch: number
  macro_warmth: number
  macro_space: number
  macro_repair: number
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'processing'
  | 'complete'
  | 'failed'

export interface RainScore {
  overall: number
  spotify: number
  apple_music: number
  youtube: number
  tidal: number
  codec_penalty: Record<string, number>
}

/**
 * DDEX contributor role — used by the contributors[] array on TrackMetadata.
 * Mirrors the ERN 4.3.2 <ResourceContributor> + <ReleaseContributor> roles
 * (DDEX PI/PA list, simplified to the roles a Ditto-style release actually
 * needs at the metadata-entry stage).
 */
export type ContributorRole =
  | 'songwriter'
  | 'composer'
  | 'lyricist'
  | 'performer'
  | 'featured'
  | 'producer'
  | 'mixer'
  | 'masterer'
  | 'publisher'

/** Single contributor row — name, role, IPI/ISNI identifiers, and writer share %. */
export interface Contributor {
  name: string
  role: ContributorRole
  /** Interested Parties Information (CISAC) — 9-11 digit numeric, no dashes. */
  ipi?: string
  /** International Standard Name Identifier (ISO 27729) — 16 digits incl. check. */
  isni?: string
  /** Share % — only meaningful for songwriter/composer/lyricist/publisher
   *  roles. Should sum to 100 across all writer-share contributors. */
  share?: number
}

/**
 * AI involvement disclosure per stage — reused from DistributionRelease, but
 * promoted into TrackMetadata so it is the single source of truth (DistributeTab
 * and the DDEX builder both read it from here).
 */
export interface AiDisclosure {
  vocals: 'none' | 'assisted' | 'generated'
  instrumentation: 'none' | 'assisted' | 'generated'
  composition: 'none' | 'assisted' | 'generated'
  mixing: 'none' | 'assisted' | 'generated'
  mastering: 'none' | 'assisted' | 'generated'
  [key: string]: 'none' | 'assisted' | 'generated'
}

export interface TrackMetadata {
  // ---- Core (legacy fields kept for backwards compatibility) ----
  title: string
  artist: string
  album: string
  genre: string
  trackNumber: string
  year: string
  isrc: string
  upc: string
  // P2-EXPORT: freeform comment — embedded as RIFF INFO ICMT (WAV) or ID3v2
  // COMM frame (MP3) when the Metadata toggle is ON. Repurposed as "release notes".
  comment: string

  // ---- Release-level (Ditto standard) ----
  /** ISO date YYYY-MM-DD — official release date. */
  releaseDate?: string
  /** ISO date YYYY-MM-DD — for re-releases / back-catalogue. */
  originalReleaseDate?: string
  /** Release type — drives DDEX <ReleaseType> + DSP categorisation. */
  releaseType?: 'single' | 'ep' | 'album' | 'compilation'
  /** Record label name. */
  label?: string
  /** Distributor name (default 'RAIN V6'). */
  distributor?: string
  /** P-line holder (sound-recording copyright holder), e.g. "2024 Artist". */
  copyrightHolder?: string
  /** C-line year (often same as copyrightYear but kept separate for splits). */
  copyrightYear?: string
  /** Music publisher name. */
  publisher?: string
  /** Publisher IPI (CISAC). */
  publisherIpi?: string
  /** PRO / collecting society — free text, suggested from PRO_OPTIONS. */
  pro?: string
  /** Territories — ISO 3166 country codes, or ['WORLDWIDE']. */
  territories?: string[]
  /** Master rights owner (distinct from P-line holder). */
  masterOwner?: string
  /** Internal contract / catalogue reference. */
  contractReference?: string

  // ---- Track-level ----
  /** ISWC (T-xxx.xxx.xxx-x format). */
  iswc?: string
  /** Recording year (may differ from release year for back-catalogue). */
  recordingYear?: string
  /** Explicit-lyrics rating — drives DDEX <ParentalWarningType>. */
  explicitLyrics?: 'none' | 'explicit' | 'clean'
  /** Parental Advisory flag (the iconic black-and-white "PAL" sticker). */
  parentalAdvisory?: boolean
  /** ISO 639-2 language code (eng, fra, deu, ...). */
  language?: string
  /** DDEX genre:subgenre, e.g. "Pop:Indie Pop". */
  genreSubgenre?: string
  /** Volume / disc number for multi-disc releases. */
  trackVolume?: string
  /** Total tracks in release (denominator of "track N of M"). */
  trackTotal?: string

  // ---- Contributors / Credits ----
  contributors?: Contributor[]

  // ---- AI Disclosure (single source of truth — flows into DDEX AIInvolvement) ----
  aiDisclosure?: AiDisclosure
}

export interface AudioAnalysis {
  lufs: number
  truePeak: number
  rms: number
  crestFactor: number
  dynamicRange: number
  sampleRate: number
  duration: number
  channels: number
  bitDepth: number
  bpm: number | null
  key: string | null
  spectrum: Float32Array
  peakFrequency: number
  zeroCrossingRate: number
  /** AUDIT-P2: real QC measurements (previously hardcoded in QCTab). */
  qcMetrics: QCMetrics
  /**
   * P2-METERS: real FFT-derived spectral descriptors. Computed by
   * computeSpectralFeatures() over the same averaged magnitude spectrum
   * returned in `spectrum`. Every field is derived from FFT bin data —
   * no synthetic / hardcoded values.
   */
  spectralFeatures: SpectralFeatures
  /**
   * P2-METERS: ISO 31-band 1/3-octave energies in dB, indexed by the
   * canonical band centers [20, 25, 31.5, 40, ... 20000] Hz. Each entry
   * is the energy in dB averaged over the FFT bins that fall inside the
   * band's frequency range.
   */
  thirdOctaveBands: Float32Array
}

/**
 * Real FFT-derived spectral descriptors (P2-METERS).
 * All fields are computed from the magnitude spectrum — no synthetic data.
 */
export interface SpectralFeatures {
  /** Spectral centroid in Hz (weighted mean bin → Hz). Brightness measure. */
  centroid: number
  /** Spectral spread (standard deviation around centroid) in Hz. */
  spread: number
  /** Spectral skewness (3rd moment, normalized). */
  skewness: number
  /** Spectral kurtosis (4th moment, normalized). */
  kurtosis: number
  /** Spectral rolloff at 85% cumulative energy, in Hz. */
  rolloff85: number
  /** Spectral rolloff at 95% cumulative energy, in Hz. */
  rolloff95: number
  /** Spectral flatness (geometric/arithmetic mean ratio, 0..1). 1 = white noise. */
  flatness: number
  /**
   * Spectral flux: frame-to-frame change in magnitude. 0 for the first
   * frame (no previous); positive values indicate new spectral content.
   */
  flux: number
  /** Peak frequency in Hz (bin with the highest magnitude). */
  peakFrequency: number
}

/** Real measured QC metrics computed from the audio channels + spectrum. */
export interface QCMetrics {
  /** DC offset as a fraction of full-scale (0.0 = none, 1.0 = full DC). */
  dcOffset: number
  /**
   * Full-buffer normalized L/R Pearson correlation in [-1, 1]
   * (1 = mono, 0 = uncorrelated, -1 = out of phase). This is the
   * "Stereo Correlation" QC item per spec.
   */
  phaseCorrelation: number
  /**
   * Short-time cross-correlation between L and R at zero lag, averaged
   * across 20 ms windows. Distinct from `phaseCorrelation` (which is the
   * whole-buffer Pearson): this captures LOCAL phase drift over time. This
   * is the "Phase Coherence" QC item per spec. Range [-1, 1].
   */
  phaseCoherence: number
  /** Stereo width ratio: side energy / mid energy (0 = mono, 1 = typical, >1 = wide). */
  stereoWidth: number
  /** RMS level in dBFS (averaged across both channels). */
  rmsDb: number
  /** Side-channel energy below 200 Hz in dB (lower = more mono-compatible bass). */
  bassSideDb: number
  /** 5–8 kHz band energy in dB (sibilance region). */
  sibilanceDb: number
  /** Sub-20 Hz energy in dB (rumble). */
  rumbleDb: number
  /** 15+ kHz energy in dB (air). */
  highFreqDb: number
  /**
   * Zero-crossing rate in crossings per second (averaged across channels).
   * Used by the Zero-Crossing Analysis QC item.
   */
  zeroCrossingRate: number
  /**
   * Count of samples stuck at exactly 0 while neighbouring samples are at
   * full scale — a tell-tale sign of DC-offset clipping at the zero crossing.
   * Used by the Zero-Crossing Analysis QC item.
   */
  zeroCrossingStuck: number
  /** Count of samples at or beyond ±0.999 (digital clipping). */
  clippedSamples: number
  /**
   * Transient density in onsets per second. Used by the Codec Prediction
   * QC item — high transient density + low bitrate = pre-echo risk.
   */
  transientDensity: number
  /**
   * Codec pre-echo risk score in [0, 1]. Derived from transient density
   * and overall signal energy — high transient density in spectrally
   * dense material at typical lossy bitrates (320 kbps MP3, 128 kbps Opus)
   * will produce pre-echo artifacts. 0 = no risk, 1 = severe risk.
   */
  preechoRisk: number
  /**
   * Effective bandwidth in Hz — the highest frequency bin where the
   * spectral magnitude remains within 40 dB of the peak band's level.
   * Used by the "Bandwidth Integrity" QC check to detect a clean
   * frequency cutoff (e.g. from a lossy source or an encoder lowpass).
   * For a full-bandwidth 48 kHz master this should be ≥ 21 kHz; a value
   * of 16–18 kHz indicates a lossy lowpass has been baked into the
   * source or introduced by the export encoder.
   */
  effectiveBandwidthHz: number
}

export interface ProvenanceCertificate {
  certId: string
  inputHash: string
  outputHash: string
  wasmHash: string
  signedAt: string
  algorithm: string
  publicKey: string
  signature: string
  manifest: C2PAManifest
}

export interface C2PAManifest {
  version: string
  claimGenerator: string
  actions: Array<{
    action: string
    parameters: Record<string, string | number | boolean>
    when: string
  }>
  assertions: Array<{
    label: string
    data: Record<string, unknown>
  }>
}

// ---------------------------------------------------------------------------
// Stem separation
// ---------------------------------------------------------------------------

export type StemKey =
  | 'vocals'
  | 'backing_vocals'
  | 'drums'
  | 'bass'
  | 'guitar'
  | 'piano'
  | 'kick'
  | 'snare'
  | 'hats'
  | 'percussion'
  | 'ambience'
  | 'other'

export interface StemState {
  key: StemKey
  label: string
  color: string
  gain: number // dB
  muted: boolean
  solo: boolean
  level: number // 0..1 real-time
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface PipelineStage {
  id: number
  name: string
  description: string
  status: 'pending' | 'active' | 'complete' | 'failed'
  durationMs: number
}

// ---------------------------------------------------------------------------
// AI Assistant
// ---------------------------------------------------------------------------

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  suggestions?: MacroSuggestion
  report?: string
}

export interface MacroSuggestion {
  macros: Partial<MacroValues>
  confidence: number
  reasoning: string
  tensions: string[]
}

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

export interface QCCheck {
  id: string
  name: string
  category: 'loudness' | 'spectral' | 'dynamic' | 'stereo' | 'format' | 'provenance' | 'transient'
  status: 'pass' | 'warn' | 'fail'
  measured: string
  target: string
  message: string
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export interface PlatformTarget {
  slug: string
  label: string
  targetLufs: number
  truePeakCeiling: number
  codec: string
  tier: 1 | 2 | 3 | 4 | 5
}

export interface DistributionRelease {
  id: string
  title: string
  artist: string
  isrc: string
  upc: string
  platforms: string[]
  aiDisclosure: {
    vocals: 'none' | 'assisted' | 'generated'
    instrumentation: 'none' | 'assisted' | 'generated'
    composition: 'none' | 'assisted' | 'generated'
    mixing: 'none' | 'assisted' | 'generated'
    mastering: 'none' | 'assisted' | 'generated'
  }
  // AUDIT-P3 FIX: honest status cycle. We can only generate a DDEX package
  // locally — there is no DSP aggregator API in-browser — so 'delivered' and
  // 'live' (which implied actual delivery) have been replaced with 'packaged'.
  status: 'draft' | 'pending' | 'packaged'
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AnalyticsPoint {
  date: string
  renders: number
  minutes: number
  score: number
  storageMb: number
}
