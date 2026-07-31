/**
 * RAIN V6 — Filter Configuration
 *
 * Genre tilt curves, reference band constants, and EQ presets used by
 * the render pipeline (Stage 5 — Genre Profile Match).
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

/** ISO 1/3-octave center frequencies used by the reference match curve.
 *  The bands are the ISO centers exported by reference-match.ts. */
export const REF_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
  20000,
] as const

/** Q factor for 1/3-octave bandwidth filters. */
export const THIRD_OCTAVE_Q = 4.318

/** Genre-specific EQ tilt curves for broad-stroke tonal balance.
 *  Each entry provides a high-shelf or low-shelf gain at a given frequency
 *  to match the genre's typical spectral balance. */
export const GENRE_TILT: Record<string, { freq: number; gain: number; type: 'highshelf' | 'lowshelf' }> = {
  pop: { freq: 8000, gain: 0.5, type: 'highshelf' },
  rock: { freq: 200, gain: 0.8, type: 'lowshelf' },
  electronic: { freq: 8000, gain: 1.0, type: 'highshelf' },
  classical: { freq: 200, gain: -0.3, type: 'lowshelf' },
  jazz: { freq: 1000, gain: 0.3, type: 'highshelf' },
  hip_hop: { freq: 100, gain: 1.2, type: 'lowshelf' },
  country: { freq: 4000, gain: 0.5, type: 'highshelf' },
}
