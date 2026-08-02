/**
 * RAIN V6 — Canonical Constants
 *
 * Authoritative source for macro definitions, genre presets, platform targets,
 * pipeline stages, tier definitions, and platform-wide configuration.
 * Values here MUST align with the documented RAIN V6 specification.
 */

import type { MacroKey, MacroValues, PipelineStage, PlatformTarget, StemKey, StemState } from './types'

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const RAIN_BRAND = {
  name: 'RAIN',
  fullName: 'R∞N — RAIN v6',
  tagline: 'AI Audio Transformation, Mastering & Distribution Infrastructure',
  publisher: 'ThatGuy Productions · ARCOVEL Technologies International',
  motto: 'Rain doesn\'t live in the cloud.',
  accent: '#AAFF00', // signature lime accent
  accentSecondary: '#8B5CF6',
  version: '6.0.0-rc1',
} as const

// ---------------------------------------------------------------------------
// A/B Snapshots — slot count for the session-only macro comparison scratchpad
// (A / B / C / D). Moved here from store.ts so store.ts only exports the
// Zustand hook, which keeps React Fast Refresh happy (mixing a hook export
// with a runtime const export forces full reloads on every store edit).
// ---------------------------------------------------------------------------

export const SNAPSHOT_SLOT_COUNT = 4

// ---------------------------------------------------------------------------
// Macros — 7 canonical creative controls
// ---------------------------------------------------------------------------

export interface MacroDef {
  key: MacroKey
  label: string
  color: string
  description: string
  subParams: string[]
  default: number
}

export const MACROS: readonly MacroDef[] = [
  {
    key: 'brighten',
    label: 'BRIGHTEN',
    color: '#AAFF00',
    description: 'High-frequency presence, air, sparkle',
    subParams: ['high_shelf_8k', 'air_peak_16k'],
    default: 5.0,
  },
  {
    key: 'glue',
    label: 'GLUE',
    color: '#8B5CF6',
    description: 'Bus compression, cohesion, unified mix feel',
    subParams: ['mb_ratio_low', 'mb_ratio_mid', 'mb_ratio_high'],
    default: 6.0,
  },
  {
    key: 'width',
    label: 'WIDTH',
    color: '#00D4FF',
    description: 'Stereo width, spatial spread (bass mono < 200 Hz)',
    subParams: ['stereo_width', 'side_gain'],
    default: 5.0,
  },
  {
    key: 'punch',
    label: 'PUNCH',
    color: '#F97316',
    description: 'Transient emphasis, impact, drum presence',
    subParams: ['mb_attack_mid', 'mb_release_mid'],
    default: 5.0,
  },
  {
    key: 'warmth',
    label: 'WARMTH',
    color: '#D946EF',
    description: 'Harmonic saturation, low-shelf @ 200 Hz, analog tone',
    subParams: ['saturation_drive', 'low_shelf_200'],
    default: 2.5,
  },
  {
    key: 'space',
    label: 'SPACE',
    color: '#06B6D4',
    description: 'Spatial depth, reverb, immersive quality',
    subParams: ['stereo_width_ms', 'side_gain'],
    default: 3.0,
  },
  {
    key: 'repair',
    label: 'REPAIR',
    color: '#10B981',
    description: 'Spectral repair intensity (noise reduction, de-click, de-ess)',
    subParams: ['hpf', 'de_ess', 'noise_floor'],
    default: 0.0,
  },
] as const

export const DEFAULT_MACROS: MacroValues = MACROS.reduce((acc, m) => {
  acc[m.key] = m.default
  return acc
}, {} as MacroValues)

// Tension pairs — warns when conflicting macros are both cranked (> 7)
export const TENSION_PAIRS: ReadonlyArray<{ keys: [MacroKey, MacroKey]; message: string }> = [
  { keys: ['brighten', 'warmth'], message: 'High shelf + THD boost may cause harshness' },
  { keys: ['glue', 'width'], message: 'Heavy compression + wide stereo may cause instability' },
  { keys: ['glue', 'punch'], message: 'Bus compression + transient boost creates conflicting dynamics' },
  { keys: ['warmth', 'punch'], message: 'Saturation + transient emphasis may over-distort attacks' },
  { keys: ['space', 'punch'], message: 'Reverb depth + transient emphasis blurs impact' },
  { keys: ['brighten', 'repair'], message: 'Brighten + spectral repair may reintroduce sibilance' },
]

// ---------------------------------------------------------------------------
// 16-stage mastering pipeline
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { id: 1, name: 'Format Normalization', description: 'Resample to 48 kHz, 64-bit float stereo', status: 'pending', durationMs: 0 },
  { id: 2, name: 'Provenance Record', description: 'ITU-R BS.1770-4 LUFS + true-peak + spectral + QC measurement', status: 'pending', durationMs: 0 },
  { id: 3, name: 'Feature Extraction', description: '43-dim vector: Loudness, Dynamics, Spectral, Stereo, Transient, Tonal', status: 'pending', durationMs: 0 },
  { id: 4, name: 'AI Inference', description: 'RainNet v2 → 46 ProcessingParams via sigmoid × 10 macro mapping', status: 'pending', durationMs: 0 },
  { id: 5, name: 'Reference Matching', description: 'Genre-aware spectral target matching', status: 'pending', durationMs: 0 },
  { id: 6, name: 'Spectral Repair', description: 'HPF, sibilance reduction, rumble removal, spectral smoothing', status: 'pending', durationMs: 0 },
  { id: 7, name: 'Source Separation', description: 'BS-RoFormer 4-pass cascade → 12 stems', status: 'pending', durationMs: 0 },
  { id: 8, name: 'Per-Stem Repair', description: 'Individual stem QC and spectral correction', status: 'pending', durationMs: 0 },
  { id: 9, name: 'Per-Stem Processing', description: 'SAIL v2 stem-aware limiting, vocal protection, gain faders', status: 'pending', durationMs: 0 },
  { id: 10, name: 'Master Bus', description: 'EQ → Multiband comp → Stereo widening → Groove → Life injection', status: 'pending', durationMs: 0 },
  { id: 11, name: 'Loudness Targeting', description: '27 platform targets — Spotify −14, Apple −16, Atmos −18, CD −9, vinyl', status: 'pending', durationMs: 0 },
  { id: 12, name: 'True-Peak Limiting', description: 'Brickwall limiter at true_peak_ceiling (4× polyphase ISP measure). Spatial rendering is a separate path invoked from the Spatial tab / Atmos export', status: 'pending', durationMs: 0 },
  { id: 13, name: 'QC Validation', description: '18 automated checks with auto-remediation', status: 'pending', durationMs: 0 },
  { id: 14, name: 'Forensic Watermark', description: 'Ed25519 RAIN-CERT preparation (output hash + manifest)', status: 'pending', durationMs: 0 },
  { id: 15, name: 'Output Packaging', description: '24-bit WAV @ 48 kHz + 320 kbps MP3 with TPDF dither; RAIN-CERT signed', status: 'pending', durationMs: 0 },
  { id: 16, name: 'Distribution', description: 'DDEX ERN 4.3.2, LabelGrid API delivery, ISRC/UPC generation', status: 'pending', durationMs: 0 },
] as const

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

export const GENRES = [
  'pop', 'rock', 'hiphop', 'electronic', 'classical', 'jazz',
  'metal', 'folk', 'rnb', 'country', 'reggae', 'ambient',
  'amapiano', 'gospel', 'afrobeats', 'afro_house', 'gqom',
] as const

export type Genre = (typeof GENRES)[number]

// ---------------------------------------------------------------------------
// Platform targets — 27 platform loudness targets
// ---------------------------------------------------------------------------

/** Loudness target profiles for mastering — use for rendering, NOT for distribution. */
export const PLATFORM_TARGETS: readonly PlatformTarget[] = [
  // Tier 1 — Major streaming
  { slug: 'spotify', label: 'Spotify', targetLufs: -14, truePeakCeiling: -1, codec: 'Ogg Vorbis', tier: 1 },
  { slug: 'spotify_loud', label: 'Spotify Loud', targetLufs: -11, truePeakCeiling: -1, codec: 'Ogg Vorbis', tier: 1 },
  { slug: 'apple_music', label: 'Apple Music', targetLufs: -16, truePeakCeiling: -1, codec: 'AAC', tier: 1 },
  { slug: 'apple_music_spatial', label: 'Apple Spatial', targetLufs: -16, truePeakCeiling: -1, codec: 'AAC Atmos', tier: 1 },
  { slug: 'dolby_atmos', label: 'Dolby Atmos', targetLufs: -18, truePeakCeiling: -1, codec: 'E-AC-3 JOC', tier: 1 },
  { slug: 'youtube', label: 'YouTube', targetLufs: -14, truePeakCeiling: -1, codec: 'Opus', tier: 1 },
  { slug: 'youtube_music', label: 'YouTube Music', targetLufs: -14, truePeakCeiling: -1, codec: 'Opus', tier: 1 },
  { slug: 'tidal', label: 'Tidal', targetLufs: -14, truePeakCeiling: -1, codec: 'FLAC / AAC', tier: 1 },
  { slug: 'amazon_music', label: 'Amazon Music', targetLufs: -14, truePeakCeiling: -2, codec: 'AAC', tier: 1 },
  { slug: 'amazon_ultra_hd', label: 'Amazon Ultra HD', targetLufs: -14, truePeakCeiling: -1, codec: 'FLAC 24-bit', tier: 1 },

  // Tier 2 — Secondary streaming
  { slug: 'deezer', label: 'Deezer', targetLufs: -15, truePeakCeiling: -1, codec: 'MP3 / FLAC', tier: 2 },
  { slug: 'soundcloud', label: 'SoundCloud', targetLufs: -14, truePeakCeiling: -1, codec: 'Opus', tier: 2 },
  { slug: 'pandora', label: 'Pandora', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 2 },
  { slug: 'tiktok', label: 'TikTok', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 2 },
  { slug: 'instagram', label: 'Instagram', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 2 },

  // Tier 3 — Physical & broadcast
  { slug: 'cd', label: 'CD', targetLufs: -9, truePeakCeiling: -0.3, codec: 'PCM 16-bit', tier: 3 },
  { slug: 'vinyl', label: 'Vinyl', targetLufs: -14, truePeakCeiling: -1, codec: 'PCM 24-bit', tier: 3 },
  { slug: 'broadcast_ebu', label: 'EBU R128', targetLufs: -23, truePeakCeiling: -1, codec: 'WAV', tier: 3 },
  { slug: 'broadcast_atsc', label: 'ATSC A/85', targetLufs: -24, truePeakCeiling: -2, codec: 'WAV', tier: 3 },

  // Tier 4 — Specialty
  { slug: 'audiobook_acx', label: 'Audiobook ACX', targetLufs: -20, truePeakCeiling: -3, codec: 'MP3', tier: 4 },
  { slug: 'podcast', label: 'Podcast', targetLufs: -16, truePeakCeiling: -1, codec: 'MP3', tier: 4 },
  { slug: 'game_audio', label: 'Game Audio', targetLufs: -18, truePeakCeiling: -1, codec: 'WAV', tier: 4 },

  // Tier 5 — Niche / regional
  { slug: 'qobuz', label: 'Qobuz', targetLufs: -14, truePeakCeiling: -1, codec: 'FLAC 24-bit', tier: 5 },
  { slug: 'anghami', label: 'Anghami', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 5 },
  { slug: 'jiosaavn', label: 'JioSaavn', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 5 },
  { slug: 'boomplay', label: 'Boomplay', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 5 },
  { slug: 'netease', label: 'NetEase', targetLufs: -14, truePeakCeiling: -1, codec: 'AAC', tier: 5 },
] as const

export const DEFAULT_PLATFORM = 'spotify'

/**
 * DDEX ERN 4.3.2 delivery partners — real DSPs and aggregators, NOT loudness targets.
 * Separated from PLATFORM_TARGETS per audit finding: CD, Vinyl, EBU R128, ATSC A/85,
 * and Podcast are loudness profiles, not DDEX delivery partners.
 */
export interface DspDeliveryPartner {
  slug: string
  label: string
  requiresIsrc: boolean
  requiresUpc: boolean
  territoryRestrictions: string[] // empty = worldwide
}

export const DSP_DELIVERY_PARTNERS: readonly DspDeliveryPartner[] = [
  { slug: 'spotify', label: 'Spotify', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'apple_music', label: 'Apple Music', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'amazon_music', label: 'Amazon Music', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'youtube_music', label: 'YouTube Music', requiresIsrc: true, requiresUpc: false, territoryRestrictions: [] },
  { slug: 'tidal', label: 'Tidal', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'deezer', label: 'Deezer', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'soundcloud', label: 'SoundCloud', requiresIsrc: false, requiresUpc: false, territoryRestrictions: [] },
  { slug: 'pandora', label: 'Pandora', requiresIsrc: true, requiresUpc: false, territoryRestrictions: ['US'] },
  { slug: 'tiktok', label: 'TikTok', requiresIsrc: false, requiresUpc: false, territoryRestrictions: [] },
  { slug: 'instagram', label: 'Instagram / Facebook', requiresIsrc: false, requiresUpc: false, territoryRestrictions: [] },
  { slug: 'qobuz', label: 'Qobuz', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'boomplay', label: 'Boomplay', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
  { slug: 'anghami', label: 'Anghami', requiresIsrc: true, requiresUpc: false, territoryRestrictions: ['MENA'] },
  { slug: 'labelgrid', label: 'LabelGrid — Direct Delivery', requiresIsrc: true, requiresUpc: true, territoryRestrictions: [] },
] as const

// ---------------------------------------------------------------------------
// Pricing tiers
// ---------------------------------------------------------------------------

export interface PricingTier {
  slug: string
  name: string
  price: number
  period: string
  renders: string
  tagline: string
  features: string[]
  highlight?: boolean
  accent: string
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    slug: 'free',
    name: 'Free Beta',
    price: 0,
    period: 'forever',
    renders: 'Unlimited',
    tagline: 'Full capability — no paywalls, no gating',
    accent: '#AAFF00',
    highlight: true,
    features: [
      'Real-time in-browser DSP mastering (ITU-R BS.1770-4)',
      'WAV 24-bit + MP3 320 kbps export with TPDF dither',
      '7 macro controls + genre heuristics',
      'RAIN Score across Spotify / Apple / YouTube / Tidal',
      '12-stem BS-RoFormer source separation',
      'Reference track matching (31-band 1/3-octave)',
      '64-dim AIE voice vector (Mel-band STFT)',
      'Ed25519 RAIN-CERT provenance certificates',
      'Spatial audio: 7.1.4 + binaural HRTF',
      '18-point QC engine + Distribution (DDEX ERN 4.3.2)',
      'Audio never leaves your device on the free path',
    ],
  },
]
// ---------------------------------------------------------------------------
// 12-stem source separation
// ---------------------------------------------------------------------------

export const STEM_KEYS: readonly StemKey[] = [
  'vocals', 'backing_vocals', 'drums', 'bass', 'guitar', 'piano',
  'kick', 'snare', 'hats', 'percussion', 'ambience', 'other',
] as const

export const STEM_COLORS: Record<StemKey, string> = {
  vocals: '#AAFF00',
  backing_vocals: '#84CC16',
  drums: '#F97316',
  bass: '#EF4444',
  guitar: '#F59E0B',
  piano: '#EAB308',
  kick: '#FB923C',
  snare: '#FDBA74',
  hats: '#FCD34D',
  percussion: '#FDE68A',
  ambience: '#06B6D4',
  other: '#64748B',
}

export const STEM_LABELS: Record<StemKey, string> = {
  vocals: 'Lead Vocals',
  backing_vocals: 'Backing Vocals',
  drums: 'Drums',
  bass: 'Bass',
  guitar: 'Guitar',
  piano: 'Piano',
  kick: 'Kick',
  snare: 'Snare',
  hats: 'Hats',
  percussion: 'Percussion',
  ambience: 'Ambience',
  other: 'Other',
}

export function defaultStems(): StemState[] {
  return STEM_KEYS.map((k) => ({
    key: k,
    label: STEM_LABELS[k],
    color: STEM_COLORS[k],
    gain: 0,
    muted: false,
    solo: false,
    level: 0,
  }))
}

// ---------------------------------------------------------------------------
// QC checks — 18 automated checks
// ---------------------------------------------------------------------------

export const QC_CHECK_NAMES = [
  { id: 'qc_lufs', name: 'LUFS (BS.1770-4)', category: 'loudness' as const, target: '±1.0 LU of target' },
  { id: 'qc_true_peak', name: 'True Peak (4× OS)', category: 'loudness' as const, target: '≤ −1.0 dBTP' },
  { id: 'qc_lra', name: 'Loudness Range (LRA)', category: 'dynamic' as const, target: '5 – 9 LU' },
  { id: 'qc_crest_factor', name: 'Crest Factor', category: 'dynamic' as const, target: '≥ 6 dB' },
  { id: 'qc_rms', name: 'RMS Level', category: 'loudness' as const, target: '−22 – −10 dBFS' },
  { id: 'qc_stereo_width', name: 'Stereo Width (M/S)', category: 'stereo' as const, target: '0.8 – 1.3' },
  { id: 'qc_stereo_correlation', name: 'Stereo Correlation', category: 'stereo' as const, target: '> 0.5' },
  { id: 'qc_dc_offset', name: 'DC Offset', category: 'spectral' as const, target: '< 0.1%' },
  { id: 'qc_phase', name: 'Phase Coherence', category: 'stereo' as const, target: '> 0.9' },
  { id: 'qc_bass_mono', name: 'Bass Mono (≤ 200 Hz)', category: 'stereo' as const, target: 'side < −18 dB' },
  { id: 'qc_rumble', name: 'Subsonic Rumble', category: 'spectral' as const, target: '< −60 dB < 20 Hz' },
  { id: 'qc_sibilance', name: 'Sibilance (5–8 kHz)', category: 'spectral' as const, target: '< −10 dB' },
  { id: 'qc_high_freq', name: 'HF Balance (15+ kHz)', category: 'spectral' as const, target: '> −45 dB air' },
  { id: 'qc_zero_crossings', name: 'Zero-Crossing Analysis', category: 'spectral' as const, target: 'no stuck-at-zero' },
  { id: 'qc_clipping', name: 'Clipping Detection', category: 'dynamic' as const, target: '0 samples ≥ ±0.99' },
  { id: 'qc_codec_prediction', name: 'Codec Pre-Echo Risk', category: 'transient' as const, target: '< 0.3 risk' },
  { id: 'qc_provenance', name: 'Provenance Validation', category: 'provenance' as const, target: 'Ed25519 signature valid' },
  { id: 'qc_fingerprint', name: 'Fingerprint Verification', category: 'provenance' as const, target: 'hash matches recompute' },
]

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabDef {
  slug: string
  label: string
  icon: string
  group: 'master' | 'repair' | 'distribution' | 'intelligence' | 'system'
  description: string
}

export const TABS: readonly TabDef[] = [
  { slug: 'mastering', label: 'Mastering', icon: 'Sliders', group: 'master', description: '16-stage mastering engine' },
  { slug: 'stems', label: 'Stems', icon: 'Layers', group: 'master', description: '12-stem BS-RoFormer separation' },
  { slug: 'repair', label: 'Repair', icon: 'Wrench', group: 'repair', description: 'Neural spectral repair' },
  // Pitch tab removed — non-functional (CREPE/PSOLA not implemented). Will return in V7 with real DSP.
  { slug: 'spatial', label: 'Spatial', icon: 'Box', group: 'master', description: 'Dolby Atmos binaural' },
  { slug: 'qc', label: 'QC', icon: 'ShieldCheck', group: 'master', description: '18-point quality control' },
  { slug: 'reference', label: 'Reference', icon: 'Target', group: 'intelligence', description: 'A/B reference matching' },
  { slug: 'metadata', label: 'Metadata', icon: 'ClipboardList', group: 'distribution', description: 'Ditto-standard release metadata' },
  { slug: 'export', label: 'Export', icon: 'Download', group: 'distribution', description: 'WAV / MP3 export' },
  { slug: 'distribute', label: 'Distribute', icon: 'Share2', group: 'distribution', description: 'DDEX ERN 4.3.2 delivery' },
  { slug: 'provenance', label: 'Provenance', icon: 'Fingerprint', group: 'distribution', description: 'RAIN-CERT & C2PA' },
  { slug: 'aie', label: 'Artist Identity', icon: 'UserCircle', group: 'intelligence', description: '64-dim voice vector' },
  { slug: 'analytics', label: 'Analytics', icon: 'BarChart3', group: 'system', description: 'Renders, score, storage' },
  { slug: 'settings', label: 'Settings', icon: 'Settings', group: 'system', description: 'Account & engine config' },
] as const

// ---------------------------------------------------------------------------
// LUFS reference targets for the meter scale
// ---------------------------------------------------------------------------

export const LUFS_SCALE = {
  min: -36,
  max: 0,
  targets: [
    { label: 'CD', value: -9, color: '#F59E0B' },
    { label: 'Spotify', value: -14, color: '#10B981' },
    { label: 'Apple', value: -16, color: '#06B6D4' },
    { label: 'Atmos', value: -18, color: '#8B5CF6' },
    { label: 'EBU R128', value: -23, color: '#64748B' },
  ],
} as const
