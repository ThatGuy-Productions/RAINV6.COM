import { describe, expect, it } from 'bun:test'
import { audioBufferToMp3, audioBufferToWav } from '../../src/lib/rain/audio-engine'

function makeAudioBuffer(seconds = 1, sampleRate = 48000): AudioBuffer {
  const length = Math.floor(seconds * sampleRate)
  const channels = [new Float32Array(length), new Float32Array(length)]
  for (let i = 0; i < length; i++) {
    const sample = 0.25 * Math.sin(2 * Math.PI * 440 * i / sampleRate)
    channels[0][i] = sample
    channels[1][i] = sample
  }
  return {
    numberOfChannels: 2,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData(channel: number) {
      if (!channels[channel]) throw new RangeError('Invalid channel')
      return channels[channel]
    },
  } as unknown as AudioBuffer
}

describe('Audio export integrity', () => {
  it('produces a structurally valid 24-bit PCM WAV', async () => {
    const source = makeAudioBuffer()
    const blob = audioBufferToWav(source, 24, null, null)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(blob.type).toBe('audio/wav')
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('fmt ')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(24)
    expect(String.fromCharCode(...bytes.slice(36, 40))).toBe('data')
    expect(view.getUint32(40, true)).toBe(source.length * 2 * 3)
    expect(bytes.byteLength).toBe(44 + source.length * 2 * 3)
  })

  it('produces a non-empty MPEG audio stream at the requested bitrate', async () => {
    const blob = audioBufferToMp3(makeAudioBuffer(), 320, null, null)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    expect(blob.type).toBe('audio/mpeg')
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // No ID3 options were requested, so the output starts with an MPEG frame.
    expect(bytes[0]).toBe(0xff)
    expect((bytes[1] & 0xe0) === 0xe0).toBe(true)
  })
})
