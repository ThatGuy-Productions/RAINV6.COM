/**
 * RAIN V6 — Simple Mode Macro Mapper (Wave 3 P2-4)
 *
 * Deterministic function that maps a single 0–100 "Intensity" slider (plus
 * the active genre) to the full 7-macro state. Used by MasteringTab when
 * Simple Mode is ON. The mapping is intentionally pure — same (intensity,
 * genre) always produces the same macros — so renders are reproducible
 * across reloads.
 *
 * Mapping rules (per spec):
 *   - At intensity 0, all macros = their DEFAULT_MACROS values.
 *   - At intensity 100, all macros = 10 (their max) — EXCEPT warmth and
 *     space, which are capped (warmth=6.5, space=5.5) because they sound
 *     bad at extreme settings.
 *   - Linear interpolation between 0 and 100.
 *   - Genre tilts the result with additive offsets (clamped to [0, 10]).
 *
 * The genre tilts are small (typically ±0.5 to ±1.5) and additive on top
 * of the intensity-mapped value, so even at intensity 0 a genre preset
 * produces a visible (but conservative) deviation from defaults.
 */

import { DEFAULT_MACROS, MACROS } from './constants'
import type { MacroKey, MacroValues } from './types'

/** Capped maximum for macros that sound bad at the extreme. */
const WARMTH_MAX = 6.5
const SPACE_MAX = 5.5
/** Hard ceiling for every macro. */
const MACRO_MAX = 10
const MACRO_MIN = 0

/** Per-genre additive tilt. Applied AFTER intensity mapping. */
const GENRE_TILTS: Record<string, Partial<Record<MacroKey, number>>> = {
  pop:         { brighten: 0.8, glue: 0.4 },
  rock:        { punch: 1.2, glue: 0.4, brighten: -0.3 },
  hiphop:      { punch: 1.5, width: 0.6, brighten: -0.4 },
  electronic:  { brighten: 1.0, width: 0.8, punch: 0.6 },
  classical:   { space: 1.4, glue: -1.0, punch: -0.6 },
  jazz:        { warmth: 0.6, space: 0.4, glue: -0.4 },
  metal:       { punch: 1.6, glue: 0.8, brighten: 0.4 },
  folk:        { warmth: 0.8, glue: -0.2, space: 0.2 },
  rnb:         { warmth: 0.6, width: 0.4, brighten: 0.2 },
  country:     { brighten: 0.4, warmth: 0.4, punch: 0.2 },
  reggae:      { width: 0.6, warmth: 0.6, space: 0.4 },
  ambient:     { space: 1.6, width: 0.8, glue: -0.8, punch: -0.8 },
}

const MACRO_KEYS: MacroKey[] = MACROS.map((m) => m.key)

/** Cap applied to warmth/space so they never reach the unpleasant 10. */
function maxFor(key: MacroKey): number {
  if (key === 'warmth') return WARMTH_MAX
  if (key === 'space') return SPACE_MAX
  return MACRO_MAX
}

/**
 * Compute the macro state from a Simple Mode (intensity, genre) pair.
 *
 * @param intensity 0..100 (clamped internally)
 * @param genre one of GENRES; unknown genres default to no tilt
 * @returns the 7-macro state, each value clamped to [0, 10]
 *
 * Spec endpoints:
 *   - intensity 0  → every macro equals its DEFAULT_MACROS value
 *                    (genre tilt is intensity-scaled, so it vanishes at 0).
 *   - intensity 100 → every macro reaches its cap (10, or the reduced
 *                     warmth/space cap). Genre tilt is applied in full and
 *                     may push warmth/space above their default cap (e.g.
 *                     classical +space lets space reach 6.9 instead of 5.5).
 */
export function mapSimpleModeToMacros(intensity: number, genre: string): MacroValues {
  const t = clamp(intensity, 0, 100) / 100 // 0..1
  const tilt = GENRE_TILTS[genre] ?? {}
  const out = {} as MacroValues
  for (const key of MACRO_KEYS) {
    const def = DEFAULT_MACROS[key]
    const max = maxFor(key)
    // Linear interpolation from default (at t=0) to capped max (at t=1).
    const base = def + (max - def) * t
    // Genre tilt is intensity-scaled so the intensity=0 endpoint is exactly
    // the defaults (per spec). At intensity=100 the full tilt is applied.
    const delta = (tilt[key] ?? 0) * t
    out[key] = round1(clamp(base + delta, MACRO_MIN, MACRO_MAX))
  }
  return out
}

/**
 * Apply a Simple Mode (intensity, genre) update to the session store.
 * Computes the macros and routes them through `setMacros` so the change
 * is undoable (consistent with the existing preset-apply flow). Also
 * stamps `macroSource = 'HEURISTIC'` so the badge in CreativeMacros
 * reflects the deterministic mapping.
 */
export function applySimpleMode(
  intensity: number,
  genre: string,
  setMacros: (partial: Partial<MacroValues>) => void,
  setMacroSource: (src: 'MODEL' | 'HEURISTIC' | 'MANUAL', confidence?: number) => void,
): void {
  const macros = mapSimpleModeToMacros(intensity, genre)
  setMacros({ ...macros })
  // Simple Mode mapping is deterministic (not LLM, not user-knob) → HEURISTIC
  // with confidence 100 so the source badge reads "HEURISTIC 100%".
  setMacroSource('HEURISTIC', 100)
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
