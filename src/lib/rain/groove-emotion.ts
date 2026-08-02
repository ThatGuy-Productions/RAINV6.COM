/**
 * RAIN V6 - Groove + Emotional Intelligence Engine
 *
 * This module brings "feel" to the mastering pipeline - the missing piece
 * between technical correctness and musical excellence.
 *
 * ## Groove Intelligence (rhythmic feel)
 *   1. Tempo Detection - BPM from onset analysis (spectral flux + autocorrelation)
 *   2. Groove Quantization - straight/swing/shuffle/half-time/double-time via IOI analysis
 *   3. Groove-Preserving Multiband Compression - attack/release locked to musical values
 *   4. Transient Enhancement - genre-aware beat emphasis (kick on 1&3, snare on 2&4 etc.)
 *   5. Dynamics Map - per-bar energy contour, section boundary detection
 *
 * ## Emotional Intelligence
 *   6. Valence/Arousal Estimation - simplified MERT-style from spectral features
 *   7. Emotion-Preserving Settings - genre settings tempered by detected emotion
 *   8. Tension Arc Detection - build-ups, drops, releases from dynamics map
 *   9. Section-Aware Processing - different processing per section type
 *
 * 100% TypeScript, browser-compatible, no external dependencies beyond the
 * Web Audio API. Uses Float32Array operations throughout. All spectral
 * analysis via real FFT (imported from dsp.ts).
 */

import { fftInPlace, hannWindow } from './dsp'
import type { ProcessingParams, SpectralFeatures } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Beat position markers for transient enhancement. */
export type BeatPosition = 'downbeat' | 'backbeat' | 'offbeat' | 'sixteenth' | 'none'

/** Groove pattern classification. */
export type GrooveType =
  | 'straight'
  | 'swing'
  | 'shuffle'
  | 'half-time'
  | 'double-time'
  | 'triplet'
  | 'unknown'

/** Detected section type within a track. */
export type SectionType = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'drop' | 'outro' | 'unknown'

/** A single section boundary with metadata. */
export interface Section {
  /** Section type label. */
  type: SectionType
  /** Start time in seconds. */
  startS: number
  /** End time in seconds. */
  endS: number
  /** Mean RMS energy in dB for this section. */
  meanEnergyDb: number
  /** Transient density in onsets/sec for this section. */
  transientDensity: number
  /** Whether this section is building energy (1 = rising, 0 = flat, -1 = falling). */
  energyTrend: number
}

/** Complete groove analysis result. */
export interface GrooveProfile {
  /** Detected BPM, or null if unreliable. */
  bpm: number | null
  /** Confidence of BPM detection [0, 1]. */
  bpmConfidence: number
  /** Classified groove pattern. */
  grooveType: GrooveType
  /** Confidence of groove classification [0, 1]. */
  grooveConfidence: number
  /** Swing ratio: ratio of 1st-to-2nd eighth note duration (1.0 = straight, 1.5+ = swing). */
  swingRatio: number
  /** Time signature numerator (4 = 4/4, 3 = 3/4, etc.). */
  timeSignature: number
  /** Per-bar energy contour - start time + mean RMS per bar. */
  barEnergies: Array<{ startS: number; energyDb: number; transientCount: number }>
  /** Detected musical sections. */
  sections: Section[]
  /** Beat grid: onset times in seconds for each detected beat. */
  beatGrid: number[]
  /** Musical subdivision durations in seconds (1/64, 1/32, 1/16, 1/8, 1/4 note). */
  subdivisions: {
    sixtyFourth: number
    thirtySecond: number
    sixteenth: number
    eighth: number
    quarter: number
  }
  /** Groove-aware attack time (ms) per band - derived from BPM + groove type. */
  grooveAttackMs: { low: number; mid: number; high: number }
  /** Groove-aware release time (ms) per band - locked to subdivision. */
  grooveReleaseMs: { low: number; mid: number; high: number }
}

/** Complete emotional analysis result. */
export interface EmotionProfile {
  /** Valence: -1 (sad/dark) to +1 (happy/bright). */
  valence: number
  /** Arousal: -1 (calm/subdued) to +1 (energetic/intense). */
  arousal: number
  /** Dominant emotion quadrant label. */
  quadrant: 'calm-happy' | 'energetic-happy' | 'calm-sad' | 'energetic-sad'
  /** Tension level: 0 (relaxed) to 1 (extreme tension/build-up). */
  tension: number
  /** Tension arc: array of tension values over time, one per section. */
  tensionArc: Array<{ timeS: number; tension: number; label: string }>
  /** Whether the track has a clear drop/release detected. */
  hasDrop: boolean
  /** Drop position in seconds, or null. */
  dropPositionS: number | null
  /** Harmonic-to-noise ratio estimate [0, 1]. */
  harmonicity: number
  /** Spectral centroid dominance (how much energy is in the central region). */
  spectralCentroidRatio: number
}

/**
 * Unified groove + emotion profile that feeds into ProcessingParams overrides.
 * This is the primary output type consumed by the pipeline.
 */
export interface GrooveEmotionProfile {
  groove: GrooveProfile
  emotion: EmotionProfile
}

/**
 * Processing parameter overrides derived from groove + emotion analysis.
 * These are merged into the base ProcessingParams to add feel-aware settings.
 */
export interface GrooveEmotionOverrides {
  /** Override multiband attack times (ms) with groove-locked values (4-band). */
  mb_attack_override?: { sub: number; low: number; mid: number; high: number; air: number }
  /** Override multiband release times (ms) with groove-locked values (4-band). */
  mb_release_override?: { sub: number; low: number; mid: number; high: number; air: number }
  /** Emotion-tempered EQ gain adjustments (added to base eq_gains). */
  eq_emotion_temper: number[]
  /** Emotion-tempered stereo width multiplier. */
  stereo_width_multiplier: number
  /** Emotion-tempered saturation drive multiplier. */
  saturation_drive_multiplier: number
  /** Compression ratio adjustment from emotion. */
  compression_ratio_adjust: number
  /** Section-aware processing hints. */
  section_hints: Map<SectionType, { eq_brighten: number; width: number; compression: number }>
  /** Detected groove type for UI display. */
  groove_type: GrooveType
  /** Detected BPM for UI display. */
  bpm: number | null
  /** Emotion quadrant for UI display. */
  emotion_quadrant: string
  /** Valence value for UI display. */
  valence: number
  /** Arousal value for UI display. */
  arousal: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FFT_SIZE = 1024
const HOP_SIZE = 256 // 75% overlap

/** Range of valid BPM values to search. */
const BPM_MIN = 50
const BPM_MAX = 220

/** Inter-onset interval (IOI) thresholds for groove classification. */
const SWING_THRESHOLD = 1.35 // ratio > 1.35 = swing feel
const SHUFFLE_THRESHOLD = 1.65 // ratio > 1.65 = shuffle/triplet feel
const HALF_TIME_THRESHOLD = 0.75 // ratio < 0.75 from expected = half-time

/** Section detection thresholds. */
const SECTION_MIN_BARS = 4 // minimum bars per section
const ENERGY_DROP_THRESHOLD = 8 // dB drop = section boundary candidate
const TRANSIENT_CHANGE_THRESHOLD = 0.5 // factor change in transient density

// ---------------------------------------------------------------------------
// 1. TEMPO DETECTION - onset analysis via spectral flux + autocorrelation
// ---------------------------------------------------------------------------

/**
 * Compute the spectral flux onset detection function over a mono channel.
 * Returns an onset strength envelope at the STFT hop rate.
 */
function computeOnsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const len = samples.length
  const numFrames = Math.max(1, Math.floor((len - FFT_SIZE) / HOP_SIZE) + 1)
  const onsetEnv = new Float32Array(numFrames)

  const real = new Float32Array(FFT_SIZE)
  const imag = new Float32Array(FFT_SIZE)
  const prevMag = new Float32Array(FFT_SIZE / 2 + 1)

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP_SIZE
    // Window into real[], zero imag[]
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i
      real[i] = (idx < len ? samples[idx] : 0) * (0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE)))
      imag[i] = 0
    }
    fftInPlace(real, imag)

    // Spectral flux: sum of positive differences in magnitude
    let flux = 0
    for (let b = 0; b < FFT_SIZE / 2 + 1; b++) {
      const mag = Math.sqrt(real[b] * real[b] + imag[b] * imag[b])
      const diff = mag - prevMag[b]
      if (diff > 0) flux += diff
      prevMag[b] = mag
    }
    onsetEnv[f] = flux
  }

  return onsetEnv
}

/**
 * Detect BPM from onset envelope via autocorrelation.
 * Returns { bpm, confidence }.
 */
export function detectBpm(
  onsetEnv: Float32Array,
  hopRate: number,
): { bpm: number | null; confidence: number } {
  const n = onsetEnv.length
  if (n < 4) return { bpm: null, confidence: 0 }

  // Normalize onset envelope (subtract mean for better autocorrelation)
  let mean = 0
  for (let i = 0; i < n; i++) mean += onsetEnv[i]
  mean /= n
  const norm = new Float32Array(n)
  for (let i = 0; i < n; i++) norm[i] = onsetEnv[i] - mean

  // Autocorrelation over lag range corresponding to BPM range
  // hopRate = sampleRate / HOP_SIZE = hops per second
  const minLag = Math.floor(hopRate * 60 / BPM_MAX) // 220 BPM = smallest lag
  const maxLag = Math.floor(hopRate * 60 / BPM_MIN) // 50 BPM = largest lag
  const maxSearchLag = Math.min(maxLag, Math.floor(n * 0.75))

  let bestLag = 0
  let bestCorr = -Infinity
  const corrValues: number[] = []

  for (let lag = minLag; lag <= maxSearchLag; lag++) {
    let c = 0
    for (let i = 0; i + lag < n; i++) {
      c += norm[i] * norm[i + lag]
    }
    c /= (n - lag) // normalize by overlap length
    corrValues.push(c)
    if (c > bestCorr) {
      bestCorr = c
      bestLag = lag
    }
  }

  if (bestLag === 0) return { bpm: null, confidence: 0 }

  const bpm = (hopRate * 60) / bestLag

  // Confidence: ratio of best correlation to median correlation
  // Also check if the half-tempo or double-tempo correlation is strong
  const sortedCorr = [...corrValues].sort((a, b) => b - a)
  const medianCorr = sortedCorr[Math.floor(sortedCorr.length / 2)]
  const topCorr = sortedCorr[0] || 0
  const secondCorr = sortedCorr[1] || 0

  // Confidence = how much does the best lag stand out
  let confidence = 0
  if (medianCorr > 0) {
    confidence = Math.max(0, Math.min(1, (topCorr - medianCorr) / (topCorr + 1e-10)))
  }

  // Penalize if there's a strong competing tempo at half or double
  const halfLag = Math.round(bestLag * 2)
  const doubleLag = Math.round(bestLag / 2)
  let halfCorr = 0
  let doubleCorr = 0
  for (let i = 0; i + halfLag < n; i++) halfCorr += norm[i] * norm[i + halfLag]
  halfCorr /= (n - halfLag)
  for (let i = 0; i + doubleLag < n; i++) doubleCorr += norm[i] * norm[i + doubleLag]
  doubleCorr /= (n - doubleLag)

  const ambiguity = Math.max(
    halfCorr / (topCorr + 1e-10),
    doubleCorr / (topCorr + 1e-10),
  )
  confidence *= Math.max(0, 1 - (ambiguity - 0.4) * 2)

  // Boost confidence if second-best correlation is close to best
  // (strong harmonic structure = reliable tempo)
  if (secondCorr > 0 && topCorr > 0) {
    const secondRatio = secondCorr / topCorr
    if (secondRatio < 0.5) confidence = Math.min(1, confidence * 1.2)
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}

// ---------------------------------------------------------------------------
// 2. GROOVE QUANTIZATION - IOI analysis for groove classification
// ---------------------------------------------------------------------------

/**
 * Extract inter-onset intervals (IOIs) from the onset envelope.
 * Returns array of IOIs in seconds.
 */
function extractIOIs(onsetEnv: Float32Array, hopRate: number): number[] {
  // Threshold-based onset detection
  const threshold = computeAdaptiveThreshold(onsetEnv)

  const onsets: number[] = []
  for (let i = 1; i < onsetEnv.length - 1; i++) {
    // Peak picking: local maximum above threshold
    if (
      onsetEnv[i] > threshold &&
      onsetEnv[i] > onsetEnv[i - 1] &&
      onsetEnv[i] >= onsetEnv[i + 1]
    ) {
      onsets.push(i / hopRate) // convert frame index to seconds
    }
  }

  // Compute IOIs
  const iois: number[] = []
  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i] - onsets[i - 1]
    // Filter unreasonable IOIs (shorter than 50 ms = noise, longer than 2 sec = gaps)
    if (ioi >= 0.05 && ioi <= 2.0) {
      iois.push(ioi)
    }
  }

  return iois
}

function computeAdaptiveThreshold(env: Float32Array): number {
  // Median + 1.5 × MAD (median absolute deviation)
  const sorted = new Float32Array(env).sort()
  const median = sorted[Math.floor(sorted.length / 2)]

  const absDev: number[] = []
  for (let i = 0; i < env.length; i++) absDev.push(Math.abs(env[i] - median))
  absDev.sort((a, b) => a - b)
  const mad = absDev[Math.floor(absDev.length / 2)]

  return median + mad * 1.5
}

/**
 * Classify the groove pattern from IOI distribution.
 */
export function classifyGroove(
  iois: number[],
  bpm: number | null,
): { grooveType: GrooveType; confidence: number; swingRatio: number } {
  if (iois.length < 8) {
    return { grooveType: 'unknown', confidence: 0, swingRatio: 1.0 }
  }

  // Expected quarter note duration from BPM
  const quarterNote = bpm ? 60 / bpm : 0.5
  const eighthNote = quarterNote / 2
  const sixteenthNote = quarterNote / 4
  const tripletEighth = quarterNote / 3

  // Build IOI histogram clusters
  // Cluster IOIs near expected note durations
  const clusters: { center: number; count: number }[] = [
    { center: sixteenthNote, count: 0 },
    { center: eighthNote, count: 0 },
    { center: quarterNote, count: 0 },
    { center: tripletEighth, count: 0 },
  ]

  const tolerance = 0.15 // 15% tolerance around expected value

  for (const ioi of iois) {
    for (const cluster of clusters) {
      if (Math.abs(ioi - cluster.center) / cluster.center < tolerance) {
        cluster.count++
        break
      }
    }
  }

  const totalClustered = clusters.reduce((s, c) => s + c.count, 0)
  if (totalClustered === 0) {
    return { grooveType: 'unknown', confidence: 0, swingRatio: 1.0 }
  }

  const sixteenthCount = clusters[0].count
  const eighthCount = clusters[1].count
  const quarterCount = clusters[2].count
  const tripletCount = clusters[3].count

  // Compute swing ratio from adjacent eighth-note IOIs
  let swingRatio = 1.0
  let swingPairCount = 0
  for (let i = 0; i < iois.length - 1; i++) {
    const pair = iois[i] + iois[i + 1]
    // Check if this pair sums to approximately a quarter note
    if (Math.abs(pair - quarterNote) / quarterNote < 0.2) {
      // The ratio of first to second IOI in the pair
      if (iois[i + 1] > 0) {
        swingRatio += iois[i] / iois[i + 1]
        swingPairCount++
      }
    }
  }
  if (swingPairCount > 0) {
    swingRatio /= swingPairCount + 1
  }

  // Classify
  let grooveType: GrooveType = 'straight'
  let confidence = 0.5

  if (tripletCount > totalClustered * 0.3) {
    grooveType = 'triplet'
    confidence = tripletCount / totalClustered
  } else if (swingRatio > SHUFFLE_THRESHOLD) {
    grooveType = 'shuffle'
    confidence = Math.min(1, (swingRatio - 1) / 0.8)
  } else if (swingRatio > SWING_THRESHOLD) {
    grooveType = 'swing'
    confidence = Math.min(1, (swingRatio - 1) / 0.5)
  } else if (sixteenthCount > totalClustered * 0.4) {
    grooveType = 'double-time'
    confidence = sixteenthCount / totalClustered
  } else if (eighthCount > totalClustered * 0.5 && quarterCount < totalClustered * 0.1) {
    grooveType = 'half-time'
    confidence = eighthCount / totalClustered
  } else {
    grooveType = 'straight'
    confidence = Math.max(0.3, (eighthCount + quarterCount) / totalClustered)
  }

  return {
    grooveType,
    confidence: Math.max(0, Math.min(1, confidence)),
    swingRatio: Math.max(0.5, Math.min(3.0, swingRatio)),
  }
}

// ---------------------------------------------------------------------------
// 3. GROOVE-PRESERVING MULTIBAND COMPRESSION (4-band) — musical time constants
// ---------------------------------------------------------------------------

/**
 * Compute musical subdivision durations from BPM.
 */
export function computeSubdivisions(bpm: number): {
  sixtyFourth: number
  thirtySecond: number
  sixteenth: number
  eighth: number
  quarter: number
} {
  const quarter = 60 / bpm
  return {
    sixtyFourth: quarter / 16,
    thirtySecond: quarter / 8,
    sixteenth: quarter / 4,
    eighth: quarter / 2,
    quarter,
  }
}

/**
 * Derive groove-locked attack and release times from BPM and groove type.
 *
 * Attack times are locked to musical subdivisions:
 *  - Low band (kick/bass): attack = 1/64 note (fast, tight sub control)
 *  - Mid band (instruments/vocals): attack = 1/32 or 1/16 note (groove-preserving)
 *  - High band (hats/cymbals): attack = 1/32 or 1/64 note (transient clarity)
 *
 * Release times are locked to the groove subdivision:
 *  - Low band: release = 1/8 note (breathe with the kick)
 *  - Mid band: release = 1/4 note (musical pump)
 *  - High band: release = 1/8 note (clean decay)
 *
 * All values converted to milliseconds.
 */
export function computeGrooveTimeConstants(
  bpm: number,
  grooveType: GrooveType,
): { attackMs: { low: number; mid: number; high: number }; releaseMs: { low: number; mid: number; high: number } } {
  const sub = computeSubdivisions(bpm)

  // Base attack: low = 1/64, mid = 1/32, high = 1/64
  let attackLow = sub.sixtyFourth * 1000
  let attackMid = sub.thirtySecond * 1000
  let attackHigh = sub.sixtyFourth * 1000

  // Base release: low = 1/8, mid = 1/4, high = 1/8
  let releaseLow = sub.eighth * 1000
  let releaseMid = sub.quarter * 1000
  let releaseHigh = sub.eighth * 1000

  // Adjust for groove type
  switch (grooveType) {
    case 'swing':
      // Swing: slightly longer attack on mid to preserve swung feel
      attackMid = sub.sixteenth * 1000
      releaseLow = sub.eighth * 1000 * 1.2 // breathe a bit longer
      releaseMid = sub.quarter * 1000 * 1.1
      break
    case 'shuffle':
      // Shuffle: triplet-based - lock to triplet eighth
      attackMid = (sub.quarter / 3) * 1000 // triplet eighth
      releaseLow = (sub.quarter / 3 * 2) * 1000 // two triplet eighths
      releaseMid = sub.quarter * 1000 * 1.2
      break
    case 'half-time':
      // Half-time: double the release times for spacious feel
      releaseLow = sub.quarter * 1000
      releaseMid = sub.quarter * 1000 * 2
      releaseHigh = sub.quarter * 1000
      attackMid = sub.eighth * 1000
      break
    case 'double-time':
      // Double-time: halve release times for tight feel
      releaseLow = sub.sixteenth * 1000
      releaseHigh = sub.sixteenth * 1000
      attackLow = sub.sixtyFourth * 1000 * 0.5
      attackHigh = sub.sixtyFourth * 1000 * 0.5
      break
    case 'triplet':
      // Triplet feel: lock to triplet subdivisions
      attackMid = (sub.quarter / 3) * 1000
      releaseLow = (sub.quarter / 3 * 2) * 1000
      releaseMid = sub.quarter * 1000 * 1.1
      break
    case 'straight':
    default:
      // Straight: balanced time constants
      break
  }

  // Clamp to reasonable ranges
  const clampMs = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  return {
    attackMs: {
      low: clampMs(attackLow, 0.1, 50),
      mid: clampMs(attackMid, 0.5, 80),
      high: clampMs(attackHigh, 0.1, 30),
    },
    releaseMs: {
      low: clampMs(releaseLow, 10, 500),
      mid: clampMs(releaseMid, 20, 800),
      high: clampMs(releaseHigh, 10, 300),
    },
  }
}

// ---------------------------------------------------------------------------
// 4. TRANSIENT ENHANCEMENT - genre-aware beat emphasis
// ---------------------------------------------------------------------------

/**
 * Genre-specific beat emphasis rules.
 * For 4/4 genres: kick on 1&3, snare on 2&4
 * For shuffle: enhance the swung off-beat
 * For half-time: kick on 1, snare on 3
 */
const GENRE_BEAT_RULES: Record<string, {
  kickBeats: number[]    // which beats in a 4-beat bar get kick emphasis
  snareBeats: number[]   // which beats get snare emphasis
  offbeatBoost: number   // extra dB for offbeat transients
  hihatPattern: 'eighth' | 'sixteenth' | 'offbeat'
}> = {
  house:       { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'offbeat' },
  techno:      { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.5, hihatPattern: 'sixteenth' },
  electronic:  { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'offbeat' },
  edm:         { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'offbeat' },
  hiphop:      { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.5, hihatPattern: 'sixteenth' },
  trap:        { kickBeats: [0], snareBeats: [1.5], offbeatBoost: 1.0, hihatPattern: 'sixteenth' },
  rnb:         { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.3, hihatPattern: 'sixteenth' },
  afrobeats:   { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.7, hihatPattern: 'sixteenth' },
  amapiano:    { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.4, hihatPattern: 'sixteenth' },
  afro_house:  { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'offbeat' },
  gqom:        { kickBeats: [0, 1.5, 2], snareBeats: [1, 3], offbeatBoost: 0.8, hihatPattern: 'offbeat' },
  rock:        { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'eighth' },
  pop:         { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'eighth' },
  metal:       { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'eighth' },
  reggae:      { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0.3, hihatPattern: 'offbeat' },
  jazz:        { kickBeats: [0, 2], snareBeats: [1, 3], offbeatBoost: 0, hihatPattern: 'eighth' },
}

/**
 * Classify beat position for a given onset time within a bar.
 * Bar is divided into 16th-note slots (0-15).
 */
export function classifyBeatPosition(
  onsetTimeS: number,
  barStartS: number,
  barDurationS: number,
  bpm: number,
  grooveType: GrooveType,
): BeatPosition {
  const relativeS = onsetTimeS - barStartS
  const sixthNote = barDurationS / 16

  // Quantize to nearest 16th note
  const slot = Math.round(relativeS / sixthNote) % 16
  if (slot < 0 || slot >= 16) return 'none'

  // Determine beat position based on groove type
  switch (grooveType) {
    case 'shuffle':
    case 'triplet': {
      // In shuffle/triplet, the "swung" 16th notes are at slots 0, 3, 6, 9, 12
      const tripletSlot = slot % 3
      if (tripletSlot === 0) {
        return slot % 6 === 0 ? 'downbeat' : 'backbeat'
      }
      return 'offbeat'
    }
    case 'swing': {
      // In swing, the 2nd eighth note of each pair is delayed
      const eighthSlot = Math.floor(slot / 2)
      if (slot % 2 === 0) {
        return eighthSlot % 2 === 0 ? 'downbeat' : 'backbeat'
      }
      return 'offbeat'
    }
    case 'half-time': {
      // Half-time: only beats 0 and 2 (of 4) are strong
      if (slot === 0 || slot === 8) return 'downbeat'
      if (slot === 4 || slot === 12) return 'backbeat'
      return 'offbeat'
    }
    case 'double-time': {
      // Double-time: every 8th note feels like a beat
      if (slot % 2 === 0) {
        return (slot % 4 === 0) ? 'downbeat' : 'backbeat'
      }
      return 'sixteenth'
    }
    case 'straight':
    default: {
      // Straight 4/4: slots 0,4,8,12 are beats
      if (slot === 0 || slot === 8) return 'downbeat'
      if (slot === 4 || slot === 12) return 'backbeat'
      if (slot % 2 === 0) return 'offbeat'
      return 'sixteenth'
    }
  }
}

/**
 * Compute transient enhancement gain for a given onset based on genre rules.
 * Returns a gain multiplier (1.0 = no change, >1.0 = enhance).
 */
export function computeTransientEnhancement(
  beatPosition: BeatPosition,
  genre: string,
  onsetEnergy: number,
  meanEnergy: number,
): number {
  const rules = GENRE_BEAT_RULES[genre] ?? GENRE_BEAT_RULES.pop! // fallback to pop

  const relativeEnergy = meanEnergy > 1e-10 ? onsetEnergy / meanEnergy : 1.0

  switch (beatPosition) {
    case 'downbeat':
      // Kick emphasis - enhance if it's already prominent
      if (relativeEnergy > 1.2) return 1.0 + 0.15 * Math.min(1, relativeEnergy - 1)
      return 1.05 // gentle boost if kick is weak
    case 'backbeat':
      // Snare emphasis - enhance the backbeat
      if (relativeEnergy > 1.0) return 1.0 + 0.12 * Math.min(1, relativeEnergy - 1)
      return 1.03
    case 'offbeat':
      // Offbeat emphasis for shuffle/house
      return 1.0 + rules.offbeatBoost * 0.05 * Math.min(1, relativeEnergy)
    case 'sixteenth':
      // Subtle enhancement for hi-hats
      if (rules.hihatPattern === 'sixteenth') {
        return 1.0 + 0.03 * Math.min(1, relativeEnergy)
      }
      return 1.0
    case 'none':
      return 1.0
  }
}

// ---------------------------------------------------------------------------
// 5. DYNAMICS MAP - per-bar energy contour + section detection
// ---------------------------------------------------------------------------

/**
 * Build a per-bar energy contour from the audio channel.
 * Returns array of { startS, energyDb, transientCount } for each bar.
 */
export function buildBarEnergyMap(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  onsetEnv: Float32Array,
  hopRate: number,
): Array<{ startS: number; energyDb: number; transientCount: number }> {
  const barDurationS = (60 / bpm) * 4 // assume 4/4
  const numBars = Math.floor(samples.length / sampleRate / barDurationS)
  if (numBars < 1) return []

  const bars: Array<{ startS: number; energyDb: number; transientCount: number }> = []

  // Detect onsets from onset envelope
  const threshold = computeAdaptiveThreshold(onsetEnv)
  const onsetTimes: number[] = []
  for (let i = 1; i < onsetEnv.length - 1; i++) {
    if (
      onsetEnv[i] > threshold &&
      onsetEnv[i] > onsetEnv[i - 1] &&
      onsetEnv[i] >= onsetEnv[i + 1]
    ) {
      onsetTimes.push(i / hopRate)
    }
  }

  for (let bar = 0; bar < numBars; bar++) {
    const startS = bar * barDurationS
    const endS = startS + barDurationS
    const startSample = Math.floor(startS * sampleRate)
    const endSample = Math.min(samples.length, Math.floor(endS * sampleRate))

    // Compute RMS energy for this bar
    let sumSq = 0
    let count = 0
    for (let i = startSample; i < endSample; i++) {
      sumSq += samples[i] * samples[i]
      count++
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0
    const energyDb = 20 * Math.log10(Math.max(rms, 1e-10))

    // Count onsets in this bar
    let transientCount = 0
    for (const t of onsetTimes) {
      if (t >= startS && t < endS) transientCount++
    }

    bars.push({ startS, energyDb, transientCount })
  }

  return bars
}

/**
 * Detect musical sections from the bar energy contour.
 * Uses energy changes + transient density changes to find boundaries.
 */
export function detectSections(
  barEnergies: Array<{ startS: number; energyDb: number; transientCount: number }>,
  bpm: number,
): Section[] {
  if (barEnergies.length < 8) return []

  const barDurationS = (60 / bpm) * 4
  const sections: Section[] = []

  // Compute smoothed energy contour (3-bar moving average)
  const smoothed = new Float32Array(barEnergies.length)
  for (let i = 0; i < barEnergies.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - 1); j <= Math.min(barEnergies.length - 1, i + 1); j++) {
      sum += barEnergies[j].energyDb
      count++
    }
    smoothed[i] = count > 0 ? sum / count : barEnergies[i].energyDb
  }

  // Find energy peaks and valleys as section boundaries
  const boundaries: number[] = [0] // always start at bar 0

  // Compute overall energy range
  const allEnergies = barEnergies.map(b => b.energyDb)
  const maxEnergy = Math.max(...allEnergies)
  const minEnergy = Math.min(...allEnergies)
  const energyRange = maxEnergy - minEnergy

  // Find significant energy changes
  for (let i = 2; i < smoothed.length - 2; i++) {
    const prevEnergy = (smoothed[i - 2] + smoothed[i - 1]) / 2
    const nextEnergy = (smoothed[i + 1] + smoothed[i + 2]) / 2
    const energyChange = nextEnergy - prevEnergy

    // Significant rise or drop
    if (Math.abs(energyChange) > ENERGY_DROP_THRESHOLD * 0.5) {
      // Check for transient density change too
      const prevTransient = (barEnergies[i - 2].transientCount + barEnergies[i - 1].transientCount) / 2
      const nextTransient = (barEnergies[i + 1].transientCount + barEnergies[i + 2].transientCount) / 2
      const transientRatio = Math.max(prevTransient, nextTransient) / (Math.min(prevTransient, nextTransient) + 1)

      if (transientRatio > TRANSIENT_CHANGE_THRESHOLD) {
        // Confirmed boundary
        if (boundaries[boundaries.length - 1] < i - SECTION_MIN_BARS) {
          boundaries.push(i)
        }
      }
    }
  }

  // Add final boundary
  if (boundaries[boundaries.length - 1] < barEnergies.length - SECTION_MIN_BARS) {
    boundaries.push(barEnergies.length)
  }

  // Classify each section
  for (let s = 0; s < boundaries.length - 1; s++) {
    const startBar = boundaries[s]
    const endBar = boundaries[s + 1]
    const sectionBars = barEnergies.slice(startBar, endBar)

    const meanEnergy = sectionBars.reduce((sum, b) => sum + b.energyDb, 0) / sectionBars.length
    const meanTransient = sectionBars.reduce((sum, b) => sum + b.transientCount, 0) / sectionBars.length

    // Energy trend: compare first half to second half
    const half = Math.floor(sectionBars.length / 2)
    const firstHalf = sectionBars.slice(0, half).reduce((sum, b) => sum + b.energyDb, 0) / half
    const secondHalf = sectionBars.slice(half).reduce((sum, b) => sum + b.energyDb, 0) / (sectionBars.length - half)
    const energyTrend = secondHalf - firstHalf > 2 ? 1 : secondHalf - firstHalf < -2 ? -1 : 0

    // Classify section type
    const type = classifySection(
      s,
      boundaries.length - 1,
      meanEnergy,
      meanTransient,
      energyTrend,
      energyRange,
      maxEnergy,
    )

    sections.push({
      type,
      startS: startBar * barDurationS,
      endS: endBar * barDurationS,
      meanEnergyDb: meanEnergy,
      transientDensity: meanTransient,
      energyTrend,
    })
  }

  return sections
}

function classifySection(
  index: number,
  totalSections: number,
  meanEnergy: number,
  meanTransient: number,
  energyTrend: number,
  energyRange: number,
  maxEnergy: number,
): SectionType {
  const isFirst = index === 0
  const isLast = index === totalSections - 1
  const energyRatio = (meanEnergy + 60) / (maxEnergy + 60) // normalize to ~0-1

  // Intro: first section, low energy, rising
  if (isFirst && energyRatio < 0.5 && energyTrend > 0) return 'intro'

  // Outro: last section, energy falling, lower than peak
  if (isLast && energyRatio < 0.7 && energyTrend < 0) return 'outro'

  // Chorus: high energy, high transient density
  if (energyRatio > 0.75 && meanTransient > 2) return 'chorus'

  // Drop: very high energy with density spike
  if (energyRatio > 0.85 && meanTransient > 3) return 'drop'

  // Bridge: moderate energy with low transient density (spacious)
  if (energyRatio > 0.4 && energyRatio < 0.7 && meanTransient < 2 && energyTrend < 0) return 'bridge'

  // Pre-chorus: building energy
  if (energyTrend > 0 && energyRatio > 0.5 && energyRatio < 0.8) return 'pre-chorus'

  // Verse: moderate energy
  if (energyRatio < 0.75) return 'verse'

  return 'unknown'
}

// ---------------------------------------------------------------------------
// 6. VALENCE / AROUSAL ESTIMATION - simplified MERT-style
// ---------------------------------------------------------------------------

/**
 * Estimate valence (happy/sad) and arousal (energy/calm) from spectral features
 * and audio channel data.
 *
 * Valence correlates with:
 *  - Higher spectral centroid → brighter → happier
 *  - Higher harmonic-to-noise ratio → more tonal → happier
 *  - Major/minor key energy ratio → major thirds → happier
 *
 * Arousal correlates with:
 *  - Higher RMS energy → more intense
 *  - Higher transient density → more energetic
 *  - Higher spectral flux → more dynamic → more energetic
 */
export function estimateValenceArousal(
  channels: Float32Array[],
  sampleRate: number,
  spectralFeatures: SpectralFeatures,
  transientDensity: number,
  rmsDb: number,
): { valence: number; arousal: number; harmonicity: number; spectralCentroidRatio: number } {
  const left = channels[0]
  const right = channels[1] ?? channels[0]

  // --- Harmonic-to-noise ratio (HNR) estimate ---
  // Simplified: ratio of autocorrelation peak to total energy
  const hnr = estimateHNR(left, sampleRate)

  // --- Spectral centroid ratio ---
  // How much energy is in the central region (500-4000 Hz) vs total
  // Higher centroid ratio = brighter, more present
  const centroidRatio = spectralFeatures.centroid > 0
    ? Math.tanh(spectralFeatures.centroid / 4000)
    : 0.5

  // --- Major/minor key energy ratio ---
  // Simplified: check energy in major 3rd (4 semitones) vs minor 3rd (3 semitones)
  // We use the spectral flatness as a proxy - more tonal = less flat
  const tonality = spectralFeatures.flatness < 0.3 ? 1 - spectralFeatures.flatness * 3 : 0

  // --- VALENCE computation ---
  // High centroid (bright) → happier
  // High HNR (tonal) → happier
  // High tonality → happier
  // Low flatness → more musical → happier
  let valence = (
    centroidRatio * 0.4 +
    hnr * 0.35 +
    tonality * 0.25
  )
  valence = Math.max(-1, Math.min(1, valence * 2 - 0.5))

  // --- AROUSAL computation ---
  // Normalize RMS to a 0-1 scale (typical RMS range: -40 to 0 dBFS)
  const rmsNorm = Math.max(0, Math.min(1, (rmsDb + 40) / 40))
  // Normalize transient density (typical: 0-8 onsets/sec)
  const transientNorm = Math.max(0, Math.min(1, transientDensity / 8))
  // Normalize spectral flux (typical: 0-0.5)
  const fluxNorm = Math.max(0, Math.min(1, spectralFeatures.flux / 0.5))

  let arousal = (
    rmsNorm * 0.5 +
    transientNorm * 0.3 +
    fluxNorm * 0.2
  )
  arousal = Math.max(-1, Math.min(1, arousal * 2 - 0.5))

  return {
    valence,
    arousal,
    harmonicity: hnr,
    spectralCentroidRatio: centroidRatio,
  }
}

/**
 * Simplified harmonic-to-noise ratio estimation via autocorrelation.
 * Returns value in [0, 1] where 1 = perfectly harmonic.
 */
function estimateHNR(samples: Float32Array, sampleRate: number): number {
  const n = Math.min(samples.length, sampleRate * 2) // 2 seconds max
  const maxLag = Math.floor(sampleRate / 50) // 50 Hz = lowest pitch
  if (n < maxLag * 2) return 0.5

  // Compute autocorrelation
  let bestCorr = 0
  let totalEnergy = 0
  for (let i = 0; i < n; i++) totalEnergy += samples[i] * samples[i]

  if (totalEnergy < 1e-10) return 0

  for (let lag = maxLag; lag < maxLag * 2; lag++) {
    let c = 0
    for (let i = 0; i + lag < n; i++) {
      c += samples[i] * samples[i + lag]
    }
    c /= totalEnergy
    if (c > bestCorr) bestCorr = c
  }

  return Math.max(0, Math.min(1, bestCorr))
}

/**
 * Determine the emotion quadrant from valence and arousal.
 */
export function emotionQuadrant(valence: number, arousal: number): EmotionProfile['quadrant'] {
  if (valence >= 0 && arousal >= 0) return 'energetic-happy'
  if (valence >= 0 && arousal < 0) return 'calm-happy'
  if (valence < 0 && arousal >= 0) return 'energetic-sad'
  return 'calm-sad'
}

// ---------------------------------------------------------------------------
// 7. EMOTION-PRESERVING SETTINGS
// ---------------------------------------------------------------------------

/**
 * Compute emotion-tempered settings overrides.
 *
 * Principles:
 *  - High arousal → slightly more compression (energy needs control)
 *  - Low valence → slightly less high-shelf EQ (darkness is intentional)
 *  - Mid-high arousal + high valence → maximum stereo width (joy + energy = wide)
 *  - Low arousal + low valence → narrower, more intimate (sad + calm = close)
 *  - High tension → more compression, narrower width (build-up intensity)
 */
export function computeEmotionTemper(
  valence: number,
  arousal: number,
  tension: number,
): {
  eqTemper: number[]              // 8 EQ band adjustments
  stereoWidthMultiplier: number
  saturationDriveMultiplier: number
  compressionRatioAdjust: number
} {
  // EQ band tempering (8 bands: 60, 200, 500, 1k, 2k, 4k, 8k, 16k)
  const eqTemper = new Array(8).fill(0)

  // Valence → high-shelf adjustment
  // High valence = brighter = slightly boost highs
  // Low valence = darker = slightly cut highs
  const highShelfAdjust = valence * 1.5 // ±1.5 dB max
  eqTemper[6] = highShelfAdjust * 0.7 // 8 kHz
  eqTemper[7] = highShelfAdjust // 16 kHz

  // Arousal → mid emphasis
  // High arousal = more presence
  eqTemper[3] = arousal * 0.8  // 1 kHz
  eqTemper[4] = arousal * 1.0  // 2 kHz

  // Low arousal + low valence → warmth boost
  if (arousal < 0 && valence < 0) {
    eqTemper[0] = -valence * 1.0  // 60 Hz - add warmth for sad/calm
    eqTemper[1] = -valence * 0.8  // 200 Hz
  }

  // High valence + high arousal → sparkle
  if (valence > 0.3 && arousal > 0.3) {
    eqTemper[5] = valence * 1.0  // 4 kHz
  }

  // --- Stereo width ---
  // Joy + energy = wide; sad + calm = narrow
  let stereoWidthMultiplier = 1.0
  if (valence > 0.3 && arousal > 0.3) {
    stereoWidthMultiplier = 1.0 + (valence + arousal) * 0.15 // up to +30% width
  } else if (valence < -0.3 && arousal < -0.3) {
    stereoWidthMultiplier = 0.85 // -15% for intimate sadness
  } else if (arousal > 0.5) {
    stereoWidthMultiplier = 1.0 + arousal * 0.1 // energetic = wider
  }

  // High tension → slightly narrower to focus energy
  if (tension > 0.6) {
    stereoWidthMultiplier *= 0.95
  }

  // --- Saturation drive ---
  // High arousal = more saturation (energy/warmth)
  // Low arousal = cleaner
  let saturationDriveMultiplier = 1.0 + (arousal * 0.4)
  // Low valence = slightly more saturation (darkness/warmth)
  if (valence < 0) saturationDriveMultiplier += Math.abs(valence) * 0.2
  saturationDriveMultiplier = Math.max(0.5, Math.min(1.8, saturationDriveMultiplier))

  // --- Compression ratio ---
  // High arousal = more compression (control energy)
  let compressionRatioAdjust = arousal * 0.5
  // High tension = more compression
  compressionRatioAdjust += tension * 0.3
  compressionRatioAdjust = Math.max(-0.5, Math.min(1.0, compressionRatioAdjust))

  return {
    eqTemper,
    stereoWidthMultiplier,
    saturationDriveMultiplier,
    compressionRatioAdjust,
  }
}

// ---------------------------------------------------------------------------
// 8. TENSION ARC DETECTION
// ---------------------------------------------------------------------------

/**
 * Build a tension arc from the bar energy contour.
 * Tension = f(energy_change, energy_level, transient_density)
 *
 * Rising energy + increasing transient density = building tension
 * Sudden drop = release
 * Sustained high energy = plateau (drop section)
 */
export function buildTensionArc(
  barEnergies: Array<{ startS: number; energyDb: number; transientCount: number }>,
  bpm: number,
): { tensionArc: Array<{ timeS: number; tension: number; label: string }>; hasDrop: boolean; dropPositionS: number | null } {
  if (barEnergies.length < 4) {
    return { tensionArc: [], hasDrop: false, dropPositionS: null }
  }

  const energyValues = barEnergies.map(b => b.energyDb)
  const transientValues = barEnergies.map(b => b.transientCount)

  const maxEnergy = Math.max(...energyValues)
  const minEnergy = Math.min(...energyValues)
  const energyRange = maxEnergy - minEnergy

  const maxTransient = Math.max(...transientValues)
  const minTransient = Math.min(...transientValues)

  const barDurationS = (60 / bpm) * 4

  // Compute energy derivative (2-bar window)
  const energyDerivative: number[] = []
  for (let i = 0; i < barEnergies.length; i++) {
    if (i < 2) {
      energyDerivative.push(0)
    } else {
      energyDerivative.push(energyValues[i] - energyValues[i - 2])
    }
  }

  // Compute tension per bar
  const tensionArc: Array<{ timeS: number; tension: number; label: string }> = []
  let hasDrop = false
  let dropPositionS: number | null = null
  let maxTension = 0
  let maxTensionBar = 0

  for (let i = 0; i < barEnergies.length; i++) {
    // Energy level contribution (0-1)
    const energyLevel = energyRange > 0
      ? (energyValues[i] - minEnergy) / energyRange
      : 0.5

    // Energy derivative contribution (rising = more tension)
    const energyDeriv = energyDerivative[i]
    const derivContribution = Math.tanh(energyDeriv / 3) * 0.3

    // Transient density contribution
    const transientLevel = (maxTransient - minTransient) > 0
      ? (transientValues[i] - minTransient) / (maxTransient - minTransient)
      : 0.5

    // Tension = base energy + rising energy + transient density
    let tension = energyLevel * 0.5 + derivContribution + transientLevel * 0.2
    tension = Math.max(0, Math.min(1, tension))

    if (tension > maxTension) {
      maxTension = tension
      maxTensionBar = i
    }

    // Label the tension phase
    let label = 'stable'
    if (energyDeriv > 1.5) label = 'building'
    else if (energyDeriv < -1.5 && tension > 0.3) label = 'release'
    else if (tension > 0.7) label = 'peak'
    else if (tension < 0.3) label = 'valley'

    tensionArc.push({
      timeS: barEnergies[i].startS,
      tension,
      label,
    })
  }

  // Detect drop: sudden tension release after peak
  for (let i = maxTensionBar + 1; i < tensionArc.length - 1; i++) {
    if (
      tensionArc[i].tension < maxTension * 0.5 &&
      tensionArc[i].label === 'release' &&
      maxTension > 0.5
    ) {
      hasDrop = true
      dropPositionS = tensionArc[i].timeS
      break
    }
  }

  // If no classic drop, check for energy build-and-release
  if (!hasDrop) {
    for (let i = 2; i < tensionArc.length - 2; i++) {
      const prev = tensionArc[i - 2].tension
      const curr = tensionArc[i].tension
      const next = tensionArc[i + 2].tension
      if (prev > 0.5 && curr < prev * 0.6 && next < curr) {
        hasDrop = true
        dropPositionS = tensionArc[i].timeS
        break
      }
    }
  }

  return { tensionArc, hasDrop, dropPositionS }
}

// ---------------------------------------------------------------------------
// 9. SECTION-AWARE PROCESSING
// ---------------------------------------------------------------------------

/**
 * Generate section-specific processing hints.
 *
 * Verses: clarity/detail - slightly brighter, moderate width, light compression
 * Choruses: power/density - wider, more compression, saturation
 * Bridges: space/atmosphere - extra width, less compression, more reverb-feel
 * Drops: maximum impact - extra compression, width, sub emphasis
 */
export function buildSectionHints(
  sections: Section[],
  valence: number,
  arousal: number,
): Map<SectionType, { eq_brighten: number; width: number; compression: number }> {
  const hints = new Map<SectionType, { eq_brighten: number; width: number; compression: number }>()

  // Base hints per section type, adjusted by emotion
  const sectionDefaults: Record<SectionType, { eq_brighten: number; width: number; compression: number }> = {
    intro:  { eq_brighten: -0.5, width: 0.9,  compression: -0.3 },
    verse:  { eq_brighten: 0.0,  width: 1.0,  compression: 0.0 },
    'pre-chorus': { eq_brighten: 0.3, width: 1.05, compression: 0.2 },
    chorus: { eq_brighten: 0.5,  width: 1.15, compression: 0.4 },
    bridge: { eq_brighten: -0.3, width: 1.1,  compression: -0.2 },
    drop:   { eq_brighten: 0.3,  width: 1.2,  compression: 0.6 },
    outro:  { eq_brighten: -0.5, width: 0.85, compression: -0.3 },
    unknown:{ eq_brighten: 0.0,  width: 1.0,  compression: 0.0 },
  }

  for (const section of sections) {
    const base = sectionDefaults[section.type]
    // Emotion tempering
    const eqAdjust = base.eq_brighten + arousal * 0.2
    const widthAdjust = base.width * (1 + valence * 0.1)
    const compAdjust = base.compression + arousal * 0.3

    hints.set(section.type, {
      eq_brighten: Math.max(-2, Math.min(2, eqAdjust)),
      width: Math.max(0.7, Math.min(1.5, widthAdjust)),
      compression: Math.max(-0.6, Math.min(1.0, compAdjust)),
    })
  }

  return hints
}

// ---------------------------------------------------------------------------
// Beat grid construction
// ---------------------------------------------------------------------------

/**
 * Build a beat grid from detected onsets and BPM.
 * Returns array of beat times in seconds.
 */
function buildBeatGrid(
  onsetTimes: number[],
  bpm: number,
  totalDurationS: number,
): number[] {
  const quarterNote = 60 / bpm
  const beatGrid: number[] = []

  // Phase-align: find the closest onset to the expected beat grid
  // and use that as the reference
  let bestPhase = 0
  let bestScore = 0

  for (let phase = 0; phase < quarterNote; phase += quarterNote / 16) {
    let score = 0
    for (let beat = 0; beat * quarterNote + phase < totalDurationS; beat++) {
      const expectedTime = beat * quarterNote + phase
      // Check if any onset is close to this expected beat time
      for (const onset of onsetTimes) {
        const dist = Math.abs(onset - expectedTime)
        if (dist < quarterNote * 0.15) {
          score += 1 - dist / quarterNote
          break
        }
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }

  // Generate grid
  for (let beat = 0; beat * quarterNote + bestPhase < totalDurationS; beat++) {
    beatGrid.push(beat * quarterNote + bestPhase)
  }

  return beatGrid
}

// ---------------------------------------------------------------------------
// MAIN ENTRY POINTS
// ---------------------------------------------------------------------------

/**
 * Detect groove profile from audio channels.
 * This is the primary groove analysis function.
 *
 * @param channels - Array of Float32Array audio channels
 * @param sampleRate - Sample rate in Hz
 * @returns GrooveProfile with BPM, groove type, time constants, etc.
 */
export function detectGroove(
  channels: Float32Array[],
  sampleRate: number,
): GrooveProfile {
  const left = channels[0]
  const totalDurationS = left.length / sampleRate
  const hopRate = sampleRate / HOP_SIZE

  // 1. Compute onset envelope
  const onsetEnv = computeOnsetEnvelope(left, sampleRate)

  // 2. Detect BPM
  const { bpm, confidence: bpmConfidence } = detectBpm(onsetEnv, hopRate)
  const effectiveBpm = bpm ?? 120

  // 3. Extract IOIs and classify groove
  const iois = extractIOIs(onsetEnv, hopRate)
  const { grooveType, confidence: grooveConfidence, swingRatio } = classifyGroove(iois, bpm)

  // 4. Compute time constants
  const { attackMs, releaseMs } = computeGrooveTimeConstants(effectiveBpm, grooveType)

  // 5. Build bar energy map
  const barEnergies = buildBarEnergyMap(left, sampleRate, effectiveBpm, onsetEnv, hopRate)

  // 6. Detect sections
  const sections = detectSections(barEnergies, effectiveBpm)

  // 7. Build beat grid
  const threshold = computeAdaptiveThreshold(onsetEnv)
  const onsetTimes: number[] = []
  for (let i = 1; i < onsetEnv.length - 1; i++) {
    if (
      onsetEnv[i] > threshold &&
      onsetEnv[i] > onsetEnv[i - 1] &&
      onsetEnv[i] >= onsetEnv[i + 1]
    ) {
      onsetTimes.push(i / hopRate)
    }
  }
  const beatGrid = buildBeatGrid(onsetTimes, effectiveBpm, totalDurationS)

  // 8. Detect time signature (simplified: check for 3/4 or 4/4)
  // 3/4 has strong beat every 3 beats, 4/4 every 4
  let timeSignature = 4
  if (iois.length > 16) {
    // Check if IOIs cluster in groups of 3 or 4
    const quarterNote = 60 / effectiveBpm
    let threeGroup = 0
    let fourGroup = 0
    for (let i = 0; i < onsetTimes.length - 1; i++) {
      const ioi = onsetTimes[i + 1] - onsetTimes[i]
      if (Math.abs(ioi - quarterNote * 3) < quarterNote * 0.2) threeGroup++
      if (Math.abs(ioi - quarterNote * 4) < quarterNote * 0.2) fourGroup++
    }
    if (threeGroup > fourGroup * 1.5) timeSignature = 3
  }

  return {
    bpm,
    bpmConfidence,
    grooveType,
    grooveConfidence,
    swingRatio,
    timeSignature,
    barEnergies,
    sections,
    beatGrid,
    subdivisions: computeSubdivisions(effectiveBpm),
    grooveAttackMs: attackMs,
    grooveReleaseMs: releaseMs,
  }
}

/**
 * Estimate emotional profile from audio channels and spectral features.
 * This is the primary emotion analysis function.
 *
 * @param channels - Array of Float32Array audio channels
 * @param sampleRate - Sample rate in Hz
 * @param spectralFeatures - Pre-computed spectral features (from dsp.ts)
 * @param barEnergies - Optional pre-computed bar energy map (from detectGroove)
 * @param bpm - Optional BPM (from detectGroove)
 * @returns EmotionProfile
 */
export function estimateEmotion(
  channels: Float32Array[],
  sampleRate: number,
  spectralFeatures: SpectralFeatures,
  barEnergies?: Array<{ startS: number; energyDb: number; transientCount: number }>,
  bpm?: number | null,
): EmotionProfile {
  const left = channels[0]
  const right = channels[1] ?? channels[0]

  // Compute RMS (averaged across channels)
  let sumSq = 0
  const n = left.length
  for (let i = 0; i < n; i++) {
    const m = (left[i] + right[i]) * 0.5
    sumSq += m * m
  }
  const rmsLin = n > 0 ? Math.sqrt(sumSq / n) : 0
  const rmsDb = 20 * Math.log10(Math.max(rmsLin, 1e-7))

  // Estimate transient density from onset envelope
  const hopRate = sampleRate / HOP_SIZE
  const onsetEnv = computeOnsetEnvelope(left, sampleRate)
  const threshold = computeAdaptiveThreshold(onsetEnv)
  let transientCount = 0
  const refractoryFrames = Math.max(1, Math.floor(sampleRate * 0.01 / HOP_SIZE))
  let lastOnsetFrame = -refractoryFrames
  for (let i = 2; i < onsetEnv.length - 1; i++) {
    if (
      onsetEnv[i] > threshold &&
      onsetEnv[i] > onsetEnv[i - 1] &&
      onsetEnv[i] >= onsetEnv[i + 1] &&
      i - lastOnsetFrame >= refractoryFrames
    ) {
      transientCount++
      lastOnsetFrame = i
    }
  }
  const durationS = left.length / sampleRate
  const transientDensity = durationS > 0 ? transientCount / durationS : 0

  // Estimate valence/arousal
  const { valence, arousal, harmonicity, spectralCentroidRatio } = estimateValenceArousal(
    channels, sampleRate, spectralFeatures, transientDensity, rmsDb,
  )

  const quadrant = emotionQuadrant(valence, arousal)

  // Build tension arc
  let tension = 0.5
  let hasDrop = false
  let dropPositionS: number | null = null
  const tensionArc: Array<{ timeS: number; tension: number; label: string }> = []

  if (barEnergies && barEnergies.length >= 4) {
    const effectiveBpm = bpm ?? 120
    const arcResult = buildTensionArc(barEnergies, effectiveBpm)
    tension = arcResult.tensionArc.length > 0
      ? arcResult.tensionArc.reduce((s, a) => s + a.tension, 0) / arcResult.tensionArc.length
      : 0.5
    hasDrop = arcResult.hasDrop
    dropPositionS = arcResult.dropPositionS
    // Downsample tension arc to reduce data size (one point per ~4 bars)
    for (let i = 0; i < arcResult.tensionArc.length; i += 4) {
      tensionArc.push(arcResult.tensionArc[i])
    }
  }

  return {
    valence,
    arousal,
    quadrant,
    tension,
    tensionArc,
    hasDrop,
    dropPositionS,
    harmonicity,
    spectralCentroidRatio,
  }
}

/**
 * Build GrooveEmotionOverrides from groove and emotion profiles.
 * This is the integration point - produces ProcessingParams overrides
 * that can be merged into the base processing pipeline.
 *
 * @param genre - Genre slug (e.g., 'pop', 'rock', 'amapiano')
 * @param platform - Platform slug (e.g., 'spotify')
 * @param groove - Groove analysis result from detectGroove()
 * @param emotion - Emotion analysis result from estimateEmotion()
 * @returns GrooveEmotionOverrides for merging into ProcessingParams
 */
export function buildGrooveEmotionParams(
  _genre: string,
  _platform: string,
  groove: GrooveProfile,
  emotion: EmotionProfile,
): GrooveEmotionOverrides {
  // 1. Groove-locked time constants
  const mb_attack_override = {
    low: groove.grooveAttackMs.low,
    mid: groove.grooveAttackMs.mid,
    high: groove.grooveAttackMs.high,
  }
  const mb_release_override = {
    low: groove.grooveReleaseMs.low,
    mid: groove.grooveReleaseMs.mid,
    high: groove.grooveReleaseMs.high,
  }

  // 2. Emotion-tempered settings
  const { eqTemper, stereoWidthMultiplier, saturationDriveMultiplier, compressionRatioAdjust } =
    computeEmotionTemper(emotion.valence, emotion.arousal, emotion.tension)

  // 3. Section-aware processing hints
  const section_hints = buildSectionHints(
    groove.sections,
    emotion.valence,
    emotion.arousal,
  )

  return {
    mb_attack_override,
    mb_release_override,
    eq_emotion_temper: eqTemper,
    stereo_width_multiplier: stereoWidthMultiplier,
    saturation_drive_multiplier: saturationDriveMultiplier,
    compression_ratio_adjust: compressionRatioAdjust,
    section_hints,
    groove_type: groove.grooveType,
    bpm: groove.bpm,
    emotion_quadrant: emotion.quadrant,
    valence: emotion.valence,
    arousal: emotion.arousal,
  }
}

/**
 * Convenience: run the full groove + emotion pipeline on audio channels.
 * Returns a complete GrooveEmotionProfile with all analysis results and
 * processing overrides ready to merge into the pipeline.
 */
export function analyzeGrooveEmotion(
  channels: Float32Array[],
  sampleRate: number,
  spectralFeatures: SpectralFeatures,
  genre: string,
  platform: string,
): { profile: GrooveEmotionProfile; overrides: GrooveEmotionOverrides } {
  const groove = detectGroove(channels, sampleRate)
  const emotion = estimateEmotion(
    channels,
    sampleRate,
    spectralFeatures,
    groove.barEnergies,
    groove.bpm,
  )
  const profile: GrooveEmotionProfile = { groove, emotion }
  const overrides = buildGrooveEmotionParams(genre, platform, groove, emotion)
  return { profile, overrides }
}

/**
 * Merge GrooveEmotionOverrides into ProcessingParams.
 * Applies groove-locked time constants, emotion-tempered EQ, and
 * emotional adjustments to stereo width, saturation, and compression.
 */
export function applyGrooveEmotionOverrides(
  params: ProcessingParams,
  overrides: GrooveEmotionOverrides,
): ProcessingParams {
  const out = { ...params, eq_gains: [...params.eq_gains] }

  // Apply groove-locked attack times
  if (overrides.mb_attack_override) {
    out.mb_attack_low = overrides.mb_attack_override.low
    out.mb_attack_mid = overrides.mb_attack_override.mid
    out.mb_attack_high = overrides.mb_attack_override.high
  }

  // Apply groove-locked release times
  if (overrides.mb_release_override) {
    out.mb_release_low = overrides.mb_release_override.low
    out.mb_release_mid = overrides.mb_release_override.mid
    out.mb_release_high = overrides.mb_release_override.high
  }

  // Apply emotion-tempered EQ
  for (let i = 0; i < Math.min(8, overrides.eq_emotion_temper.length); i++) {
    out.eq_gains[i] = (out.eq_gains[i] ?? 0) + overrides.eq_emotion_temper[i]
  }

  // Apply emotion-tempered stereo width
  out.stereo_width *= overrides.stereo_width_multiplier
  out.stereo_width = Math.max(0.5, Math.min(2.0, out.stereo_width))

  // Apply emotion-tempered saturation
  out.saturation_drive *= overrides.saturation_drive_multiplier
  out.saturation_drive = Math.max(0, Math.min(1.0, out.saturation_drive))

  // Apply emotion-tempered compression ratios
  out.mb_ratio_low = Math.max(1.0, out.mb_ratio_low + overrides.compression_ratio_adjust * 0.5)
  out.mb_ratio_mid = Math.max(1.0, out.mb_ratio_mid + overrides.compression_ratio_adjust * 0.5)
  out.mb_ratio_high = Math.max(1.0, out.mb_ratio_high + overrides.compression_ratio_adjust * 0.4)

  return out
}