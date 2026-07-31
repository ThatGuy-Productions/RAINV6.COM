/**
 * RAIN V6 — Limiter Functions
 *
 * SAIL v2 per-stem limiting (Stage 9): stem-aware limiter settings,
 * per-stem gain faders from the session store, and stereo bus summation.
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

import type { StemKey } from '../types'
import { applyLimiter } from '../dsp'
import { useSessionStore } from '../store'

// ---------------------------------------------------------------------------
// P3-PIPELINE-89 — Stage 9: SAIL v2 Per-Stem Processing
// Stem-Aware Iterative Limiter. For each stem: apply a stem-aware limiter
// (per-category ceiling + release), apply per-stem gain faders from the
// session store (with mute/solo handling), then sum all stems back to a
// stereo bus that becomes the input to Stage 10 (Master Bus).
// ---------------------------------------------------------------------------

/**
 * SAIL v2 limiter settings per stem category (P3-PIPELINE-89 task spec):
 *   vocals / backing_vocals  : -3 dBFS ceiling, 50 ms release (vocal protection)
 *   drums / kick / snare / hats / percussion : -1 dBFS, 10 ms release (drums louder)
 *   bass                     : -2 dBFS, 30 ms release (control + transient preservation)
 *   guitar / piano           : -3 dBFS, 40 ms release
 *   ambience / other         : no limiting (preserve dynamic range)
 *
 * Returns null when no limiting should be applied.
 */
export function getSailLimiterSettings(key: StemKey): { ceiling: number; releaseMs: number } | null {
  switch (key) {
    case 'vocals':
    case 'backing_vocals':
      return { ceiling: -3, releaseMs: 50 }
    case 'drums':
    case 'kick':
    case 'snare':
    case 'hats':
    case 'percussion':
      return { ceiling: -1, releaseMs: 10 }
    case 'bass':
      return { ceiling: -2, releaseMs: 30 }
    case 'guitar':
    case 'piano':
      return { ceiling: -3, releaseMs: 40 }
    case 'ambience':
    case 'other':
      return null
    default:
      return null
  }
}

/**
 * Run SAIL v2 per-stem processing (Stage 9) on the separated stems.
 *
 * For each stem:
 *   1. Apply a stem-aware look-ahead limiter (per-category ceiling/release).
 *      Uses sample-peak applyLimiter (fast) — inter-sample peaks are caught
 *      by the master bus true-peak limiter in Stage 12.
 *   2. Read the per-stem gain (dB) from useSessionStore.getState().stems.
 *      Convert to linear and apply as a gain fader.
 *   3. Honor mute (zero contribution) and solo (only soloed stem contributes).
 *   4. Sum the limited + gained stem into the stereo output bus.
 *
 * Returns a stereo Float32Array[] (always 2 channels) of length `targetLength`.
 * Deterministic — same input + same store state → same output.
 */
export function sailProcessStems(
  stems: import('../stems').StemResult[],
  sampleRate: number,
  targetLength: number,
): Float32Array[] {
  // Read stem gains + mute/solo state from the session store.
  // This is the Zustand pattern for reading state outside React components.
  const sessionStems = useSessionStore.getState().stems
  const soloed = sessionStems.find((s) => s.solo)

  const leftSum = new Float32Array(targetLength)
  const rightSum = new Float32Array(targetLength)

  for (const stem of stems) {
    const sessionStem = sessionStems.find((s) => s.key === stem.key)
    if (!sessionStem) continue

    // Mute/solo handling: muted stems contribute nothing; if any stem is
    // soloed, only soloed stems contribute.
    const audible = !sessionStem.muted && (!soloed || sessionStem.solo)
    if (!audible) continue

    // Per-stem gain fader (dB → linear)
    const gainLin = Math.pow(10, sessionStem.gain / 20)

    // Apply per-stem limiter to a copy of the stem channels (do NOT mutate
    // the separator's output — the Stems tab still holds those references).
    const limiterSettings = getSailLimiterSettings(stem.key)
    const processed: Float32Array[] = stem.channels.map((c) => c.slice())
    if (limiterSettings) {
      const { ceiling, releaseMs } = limiterSettings
      const threshold = ceiling - 0.5
      for (let ch = 0; ch < processed.length; ch++) {
        processed[ch] = applyLimiter(processed[ch], {
          ceiling,
          threshold,
          releaseMs,
          lookAheadMs: 5,
          sampleRate,
        })
      }
    }

    // Sum into the stereo bus with per-stem gain applied
    const stemL = processed[0]
    const stemR = processed[1] ?? processed[0]
    const len = Math.min(stemL.length, targetLength)
    for (let i = 0; i < len; i++) {
      leftSum[i] += stemL[i] * gainLin
      rightSum[i] += stemR[i] * gainLin
    }
  }

  return [leftSum, rightSum]
}
