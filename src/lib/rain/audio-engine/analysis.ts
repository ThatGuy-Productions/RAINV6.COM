/**
 * RAIN V6 — Audio Analysis Functions
 *
 * Stem measurement helpers for RMS and peak dB.
 * Re-compute RMS + peak dB on the repaired stem channels so the Stems tab
 * shows accurate post-repair measurements after Stage 8 re-emits via
 * onStemsReady. Matches the measurement logic in stems.ts.
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

export function measureStemRmsDb(channels: Float32Array[]): number {
  if (channels.length === 0 || channels[0].length === 0) return -120
  let maxRms = -Infinity
  for (const c of channels) {
    let sum = 0
    for (let i = 0; i < c.length; i++) sum += c[i] * c[i]
    const rms = Math.sqrt(sum / c.length)
    const db = 20 * Math.log10(Math.max(rms, 1e-7))
    if (db > maxRms) maxRms = db
  }
  return maxRms === -Infinity ? -120 : maxRms
}

export function measureStemPeakDb(channels: Float32Array[]): number {
  if (channels.length === 0) return -120
  let peak = 0
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i] < 0 ? -c[i] : c[i]
      if (a > peak) peak = a
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-7))
}
