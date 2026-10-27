import { describe, expect, it } from 'bun:test'
import { computeLufs, computeTruePeak } from '../../src/lib/rain/dsp'

function sine(frequency: number, sampleRate: number, seconds: number, amplitude: number): Float32Array {
  const output = new Float32Array(Math.floor(sampleRate * seconds))
  for (let i = 0; i < output.length; i++) {
    output[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate)
  }
  return output
}

describe('DSP regression — measured signal behaviour', () => {
  it('returns the silence floor for silent audio', () => {
    expect(computeLufs([new Float32Array(48000)], 48000)).toBe(-70)
    expect(computeTruePeak(new Float32Array(48000))).toBeLessThanOrEqual(-190)
  })

  it('returns finite, repeatable loudness for a known sine fixture', () => {
    const fixture = sine(1000, 48000, 2, 0.1)
    const first = computeLufs([fixture], 48000)
    const second = computeLufs([fixture], 48000)
    expect(Number.isFinite(first)).toBe(true)
    expect(first).toBeGreaterThan(-30)
    expect(first).toBeLessThan(-15)
    expect(second).toBe(first)
  })

  it('increases integrated loudness by approximately 6 dB when amplitude doubles', () => {
    const quiet = computeLufs([sine(1000, 48000, 2, 0.1)], 48000)
    const loud = computeLufs([sine(1000, 48000, 2, 0.2)], 48000)
    expect(loud - quiet).toBeGreaterThan(5.8)
    expect(loud - quiet).toBeLessThan(6.2)
  })

  it('measures a non-silent sine true peak near its sample peak', () => {
    const peak = computeTruePeak(sine(1000, 48000, 1, 0.5))
    expect(Number.isFinite(peak)).toBe(true)
    expect(peak).toBeGreaterThan(-8)
    expect(peak).toBeLessThan(-4)
  })
})
