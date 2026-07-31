/**
 * RAIN V6 — Dynamics Processing
 *
 * Multiband compression (3-band Linkwitz-Riley-ish crossover), per-band
 * compression, and per-stem spectral repair (Stage 8).
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

import type { ProcessingParams, StemKey } from '../types'
import { applyBiquad, designBiquad } from '../dsp'

// ---------------------------------------------------------------------------
// Multiband compression (3-band, simplified)
// ---------------------------------------------------------------------------

export function applyMultibandCompression(channels: Float32Array[], params: ProcessingParams, sampleRate: number) {
  if (channels.length < 2) return
  const lowXover = 200
  const midXover = 2000

  const lowLpf = designBiquad('lowpass', lowXover, sampleRate, 0.7071)
  const highHpf = designBiquad('highpass', midXover, sampleRate, 0.7071)
  const midBand1 = designBiquad('highpass', lowXover, sampleRate, 0.7071)
  const midBand2 = designBiquad('lowpass', midXover, sampleRate, 0.7071)

  for (let ch = 0; ch < channels.length; ch++) {
    const orig = channels[ch].slice()
    const low = orig.slice(); applyBiquad(low, lowLpf)
    const high = orig.slice(); applyBiquad(high, highHpf)
    const mid = orig.slice(); applyBiquad(mid, midBand1); applyBiquad(mid, midBand2)

    // Apply compression per band
    compressBand(low, params.mb_threshold_low, params.mb_ratio_low, params.mb_attack_low, params.mb_release_low, sampleRate)
    compressBand(mid, params.mb_threshold_mid, params.mb_ratio_mid, params.mb_attack_mid, params.mb_release_mid, sampleRate)
    compressBand(high, params.mb_threshold_high, params.mb_ratio_high, params.mb_attack_high, params.mb_release_high, sampleRate)

    // Sum back
    for (let i = 0; i < channels[ch].length; i++) {
      channels[ch][i] = low[i] + mid[i] + high[i]
    }
  }
}

function compressBand(samples: Float32Array, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, sampleRate: number) {
  const attackCoef = Math.exp(-1 / (attackMs * 0.001 * sampleRate))
  const releaseCoef = Math.exp(-1 / (releaseMs * 0.001 * sampleRate))
  const thresholdLin = Math.pow(10, thresholdDb / 20)
  let gainReduction = 1
  for (let i = 0; i < samples.length; i++) {
    const x = Math.abs(samples[i])
    let target = 1
    if (x > thresholdLin) {
      const overDb = 20 * Math.log10(x / thresholdLin)
      const reducedDb = overDb * (1 - 1 / ratio)
      target = Math.pow(10, -reducedDb / 20)
    }
    const coef = target < gainReduction ? attackCoef : releaseCoef
    gainReduction = gainReduction * coef + target * (1 - coef)
    samples[i] *= gainReduction
  }
}

// ---------------------------------------------------------------------------
// P3-PIPELINE-89 — Stage 8: Per-Stem Repair
// Lightweight per-stem spectral correction. Uses the existing designBiquad /
// applyBiquad primitives (no STFT — keeps the per-stem pass fast). For each
// stem category, applies a minimal set of corrective filters per the task
// spec. Deterministic — same input → same output. No Math.random, no
// Date.now in DSP path.
// ---------------------------------------------------------------------------

/**
 * Apply per-stem repair (Stage 8) to one separated stem.
 *
 * Returns a NEW Float32Array[] (does not mutate the separator's output — the
 * Stems tab needs the original measurements to remain stable for display
 * until the repaired results are emitted via onStemsReady).
 *
 * Per the P3-PIPELINE-89 task spec:
 *   - vocals / backing_vocals : de-ess peak cut @ 7 kHz, Q=2, -2 dB + HPF @ 80 Hz
 *   - bass                    : HPF @ 30 Hz + low-shelf trim if peak > -3 dBFS
 *   - drums / kick / snare / hats / percussion : DC offset verify only (preserve transients)
 *   - guitar / piano          : HPF @ 60 Hz + de-ess @ 8 kHz, Q=2, -1.5 dB
 *   - ambience                : no repair (preserve reverb tail)
 *   - other                   : HPF @ 40 Hz
 */
export function repairStem(
  key: StemKey,
  inputChannels: Float32Array[],
  sampleRate: number,
): Float32Array[] {
  // Always copy — never mutate the separator's output in place.
  const out: Float32Array[] = inputChannels.map((c) => c.slice())

  switch (key) {
    case 'vocals':
    case 'backing_vocals': {
      // Gentle de-ess @ 7 kHz, Q=2, -2 dB
      const deEss = designBiquad('peak', 7000, sampleRate, 2, -2)
      // HPF @ 80 Hz (remove rumble below vocal fundamental)
      const hpf = designBiquad('highpass', 80, sampleRate, 0.7071)
      for (const c of out) {
        applyBiquad(c, deEss)
        applyBiquad(c, hpf)
      }
      break
    }
    case 'bass': {
      // HPF @ 30 Hz (remove subsonic rumble below bass fundamental)
      const hpf = designBiquad('highpass', 30, sampleRate, 0.7071)
      for (const c of out) applyBiquad(c, hpf)
      // Gentle low-shelf trim if peak > -3 dBFS (tames excessive sub-bass)
      let peak = 0
      for (const c of out) {
        for (let i = 0; i < c.length; i++) {
          const a = c[i] < 0 ? -c[i] : c[i]
          if (a > peak) peak = a
        }
      }
      const peakDb = 20 * Math.log10(Math.max(peak, 1e-7))
      if (peakDb > -3) {
        const shelf = designBiquad('lowshelf', 100, sampleRate, 0.7071, -1.0)
        for (const c of out) applyBiquad(c, shelf)
      }
      break
    }
    case 'drums':
    case 'kick':
    case 'snare':
    case 'hats':
    case 'percussion': {
      // Transient preservation: no repair, just verify no DC offset.
      // Drums are transient-driven — any spectral repair would smear attacks.
      for (const c of out) {
        let sum = 0
        for (let i = 0; i < c.length; i++) sum += c[i]
        const dc = sum / c.length
        if (Math.abs(dc) > 1e-4) {
          for (let i = 0; i < c.length; i++) c[i] -= dc
        }
      }
      break
    }
    case 'guitar':
    case 'piano': {
      // HPF @ 60 Hz + de-ess @ 8 kHz, Q=2, -1.5 dB
      const hpf = designBiquad('highpass', 60, sampleRate, 0.7071)
      const deEss = designBiquad('peak', 8000, sampleRate, 2, -1.5)
      for (const c of out) {
        applyBiquad(c, hpf)
        applyBiquad(c, deEss)
      }
      break
    }
    case 'ambience': {
      // No repair — preserve the reverb tail (any filtering would chop it).
      break
    }
    case 'other':
    default: {
      // HPF @ 40 Hz (gentle rumble removal)
      const hpf = designBiquad('highpass', 40, sampleRate, 0.7071)
      for (const c of out) applyBiquad(c, hpf)
      break
    }
  }

  return out
}
