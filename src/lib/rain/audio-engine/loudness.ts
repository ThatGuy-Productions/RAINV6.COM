/**
 * RAIN V6 — Loudness Functions
 *
 * LUFS targeting and loudness normalization.
 * Extracted from Stage 11 of the render pipeline in audio-engine.ts
 * during Phase 7 architecture refactor.
 */

import type { ProcessingParams } from '../types'
import { analyzeAudio } from '../dsp'

/**
 * Apply make-up gain to reach the platform target LUFS.
 *
 * Computes the current LUFS of the rendered signal, then applies a linear
 * gain adjustment to bring it within 0.3 LUFS of the target. This is the
 * same logic that was inline in Stage 11 of the render pipeline.
 *
 * Deterministic — same input + same params → same output.
 */
export function applyLoudnessTargeting(
  inChannels: Float32Array[],
  params: ProcessingParams,
  sampleRate: number,
): void {
  const renderedAnalysis = analyzeAudio(inChannels, sampleRate)
  const lufsDelta = params.target_lufs - renderedAnalysis.lufs
  if (Math.abs(lufsDelta) > 0.3) {
    const gainLin = Math.pow(10, lufsDelta / 20)
    for (let ch = 0; ch < inChannels.length; ch++) {
      for (let i = 0; i < inChannels[ch].length; i++) inChannels[ch][i] *= gainLin
    }
  }
}
