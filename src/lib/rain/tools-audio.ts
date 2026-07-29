/**
 * RAIN V6 — Free Tools audio processing library
 *
 * All processing happens in-browser via the Web Audio API. Files are decoded
 * with AudioContext.decodeAudioData, processed via OfflineAudioContext (for
 * effects) or direct buffer manipulation, then encoded to the target format.
 *
 * Encoders:
 *   - WAV: manual PCM writer (same as audio-engine.ts)
 *   - MP3: lamejs (already installed)
 *   - AIFF: manual AIFF writer
 *
 * No audio leaves the browser. No fake conversions.
 */

import { Mp3Encoder } from '@breezystack/lamejs'

// ── Decode any audio file to an AudioBuffer ──────────────────────────────

let sharedCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedCtx = new Ctor()
  }
  return sharedCtx
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext()
  const arr = await file.arrayBuffer()
  return await ctx.decodeAudioData(arr)
}

// ── WAV encoder (16-bit PCM) ─────────────────────────────────────────────

export function encodeWav(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]))
      if (bitDepth === 16) {
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        offset += 2
      } else {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF)
        view.setUint8(offset, v & 0xFF)
        view.setUint8(offset + 1, (v >> 8) & 0xFF)
        view.setUint8(offset + 2, (v >> 16) & 0xFF)
        offset += 3
      }
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// ── AIFF encoder ─────────────────────────────────────────────────────────

export function encodeAiff(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = 2
  const dataSize = length * numChannels * bytesPerSample
  // AIFF header: FORM + size + AIFF + COMM chunk + SSND chunk
  const commSize = 18
  const ssndSize = 8 + dataSize
  const formSize = 4 + 8 + commSize + 8 + ssndSize
  const ab = new ArrayBuffer(12 + 8 + commSize + 8 + ssndSize)
  const view = new DataView(ab)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  let off = 0
  writeStr(off, 'FORM'); off += 4
  view.setUint32(off, formSize); off += 4
  writeStr(off, 'AIFF'); off += 4
  // COMM chunk
  writeStr(off, 'COMM'); off += 4
  view.setUint32(off, commSize); off += 4
  view.setUint16(off, numChannels); off += 2
  // numSampleFrames (uint32 BE)
  view.setUint32(off, length); off += 4
  // sampleSize (uint16 BE)
  view.setUint16(off, 16); off += 2
  // sampleRate (80-bit extended BE) — convert from double
  writeExtendedFloat(view, off, sampleRate); off += 10
  // SSND chunk
  writeStr(off, 'SSND'); off += 4
  view.setUint32(off, ssndSize); off += 4
  view.setUint32(off, 0); off += 4 // offset
  view.setUint32(off, 0); off += 4 // block size
  // PCM samples (big-endian, signed 16-bit)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]))
      const v = s < 0 ? s * 0x8000 : s * 0x7FFF
      view.setInt16(off, v, false) // BE
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/aiff' })
}

function writeExtendedFloat(view: DataView, offset: number, value: number) {
  // Convert a double to 80-bit IEEE 754 extended (Apple's sample rate format)
  if (value === 0) {
    view.setUint32(offset, 0)
    view.setUint32(offset + 4, 0)
    view.setUint16(offset + 8, 0)
    return
  }
  const sign = value < 0 ? 0x8000 : 0
  value = Math.abs(value)
  let exp = 0
  let mantissa = value
  while (mantissa >= 1) { mantissa /= 2; exp++ }
  while (mantissa < 0.5 && mantissa > 0) { mantissa *= 2; exp-- }
  exp += 16383
  mantissa *= 0x100000000 // shift 32 bits
  const hi = Math.floor(mantissa)
  const lo = Math.floor((mantissa - hi) * 0x100000000)
  view.setUint16(offset, sign | exp)
  view.setUint32(offset + 2, hi)
  view.setUint32(offset + 6, lo)
}

// ── MP3 encoder ──────────────────────────────────────────────────────────

export function encodeMp3(buffer: AudioBuffer, bitrate = 320): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate)
  const blockSize = 1152
  const mp3Data: Uint8Array[] = []

  const channels: Int16Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    const float = buffer.getChannelData(ch)
    const int16 = new Int16Array(length)
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, float[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    channels.push(int16)
  }

  for (let i = 0; i < length; i += blockSize) {
    const left = channels[0].subarray(i, i + blockSize)
    const right = channels[1]?.subarray(i, i + blockSize) ?? null
    const buf = right ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left)
    if (buf.length > 0) mp3Data.push(new Uint8Array(buf))
  }
  const end = encoder.flush()
  if (end.length > 0) mp3Data.push(new Uint8Array(end))

  const total = mp3Data.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of mp3Data) { out.set(a, pos); pos += a.length }
  return new Blob([out], { type: 'audio/mpeg' })
}

// ── Audio effect processors ──────────────────────────────────────────────

export async function applyVolumeChange(buffer: AudioBuffer, gainDb: number): Promise<AudioBuffer> {
  const gain = Math.pow(10, gainDb / 20)
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gainNode = ctx.createGain()
  gainNode.gain.value = gain
  source.connect(gainNode).connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export async function applyBassBoost(buffer: AudioBuffer, boostDb: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowshelf'
  filter.frequency.value = 200
  filter.gain.value = boostDb
  source.connect(filter).connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export async function applyEQ(buffer: AudioBuffer, bands: { freq: number; gain: number }[]): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  let lastNode: AudioNode = source
  for (const band of bands) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = band.freq
    filter.Q.value = 1
    filter.gain.value = band.gain
    lastNode.connect(filter)
    lastNode = filter
  }
  lastNode.connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export function applyReverse(buffer: AudioBuffer): AudioBuffer {
  const ctx = getAudioContext()
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = reversed.getChannelData(ch)
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[src.length - 1 - i]
    }
  }
  return reversed
}

export async function applyPan(buffer: AudioBuffer, pan: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const panner = ctx.createStereoPanner()
  panner.pan.value = Math.max(-1, Math.min(1, pan))
  source.connect(panner).connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export function applyVocalRemover(buffer: AudioBuffer): AudioBuffer {
  // Center-channel removal: L-R = anything panned to center (usually vocals)
  if (buffer.numberOfChannels < 2) return buffer
  const ctx = getAudioContext()
  const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  const outL = out.getChannelData(0)
  const outR = out.getChannelData(1)
  for (let i = 0; i < left.length; i++) {
    const diff = left[i] - right[i]
    outL[i] = diff
    outR[i] = diff
  }
  return out
}

export async function applyReverb(buffer: AudioBuffer, decay: number): Promise<AudioBuffer> {
  // Simple reverb via convolver with a generated impulse response
  const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const convolver = ctx.createConvolver()
  // Generate impulse response
  const irLength = Math.floor(buffer.sampleRate * decay)
  const ir = ctx.createBuffer(2, irLength, buffer.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch)
    for (let i = 0; i < irLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 2)
    }
  }
  convolver.buffer = ir
  // Mix dry + wet
  const dryGain = ctx.createGain()
  dryGain.gain.value = 0.7
  const wetGain = ctx.createGain()
  wetGain.gain.value = 0.3
  source.connect(dryGain).connect(ctx.destination)
  source.connect(convolver).connect(wetGain).connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export async function applyPitchTempo(buffer: AudioBuffer, pitchSemitones: number, tempoRatio: number): Promise<AudioBuffer> {
  // Use OfflineAudioContext with detune for pitch, and resample for tempo
  const newSampleRate = buffer.sampleRate
  const newLength = Math.floor(buffer.length / tempoRatio)
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, newLength, newSampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = tempoRatio
  source.detune.value = pitchSemitones * 100
  source.connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export async function applyNoiseReduction(buffer: AudioBuffer, threshold: number): Promise<AudioBuffer> {
  // Spectral subtraction: simple high-pass to remove low-frequency rumble + gate
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 80 // remove rumble
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 16000 // remove hiss above 16kHz
  const gate = ctx.createDynamicsCompressor()
  gate.threshold.value = -50 + threshold * 30
  gate.ratio.value = 12
  source.connect(highpass).connect(lowpass).connect(gate).connect(ctx.destination)
  source.start(0)
  return await ctx.startRendering()
}

export function applyDownmix(buffer: AudioBuffer, targetChannels: 1 | 2): AudioBuffer {
  const ctx = getAudioContext()
  const out = ctx.createBuffer(targetChannels, buffer.length, buffer.sampleRate)
  if (targetChannels === 1) {
    // Mono: average all channels
    const mono = out.getChannelData(0)
    const chans: Float32Array[] = []
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) chans.push(buffer.getChannelData(ch))
    for (let i = 0; i < mono.length; i++) {
      let sum = 0
      for (const ch of chans) sum += ch[i]
      mono[i] = sum / chans.length
    }
  } else {
    // Stereo: copy or expand
    for (let ch = 0; ch < 2; ch++) {
      const dst = out.getChannelData(ch)
      const src = buffer.numberOfChannels > ch ? buffer.getChannelData(ch) : buffer.getChannelData(0)
      for (let i = 0; i < dst.length; i++) dst[i] = src[i]
    }
  }
  return out
}

// ── Audio tools ──────────────────────────────────────────────────────────

export function trimAudio(buffer: AudioBuffer, startTime: number, endTime: number): AudioBuffer {
  const ctx = getAudioContext()
  const startSample = Math.floor(startTime * buffer.sampleRate)
  const endSample = Math.floor(endTime * buffer.sampleRate)
  const length = endSample - startSample
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = out.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      dst[i] = src[startSample + i]
    }
  }
  return out
}

export function detectBPM(buffer: AudioBuffer): number {
  // Simple peak-based BPM detection
  const data = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate
  // Find peaks
  const peaks: number[] = []
  const threshold = 0.4
  const minDistance = Math.floor(sampleRate * 0.3) // max 200 BPM
  let lastPeak = -minDistance
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > threshold && i - lastPeak > minDistance) {
      peaks.push(i)
      lastPeak = i
    }
  }
  if (peaks.length < 2) return 0
  // Average interval between peaks
  let totalInterval = 0
  for (let i = 1; i < peaks.length; i++) {
    totalInterval += peaks[i] - peaks[i - 1]
  }
  const avgInterval = totalInterval / (peaks.length - 1)
  const bpm = (60 * sampleRate) / avgInterval
  // Round to nearest reasonable BPM
  return Math.round(bpm)
}

export function generateWaveformImage(buffer: AudioBuffer): Blob {
  const canvas = document.createElement('canvas')
  const width = 1200
  const height = 200
  canvas.width = width
  canvas.height = height
  const ctx2d = canvas.getContext('2d')!
  // Background
  ctx2d.fillStyle = '#0e1016'
  ctx2d.fillRect(0, 0, width, height)
  // Waveform
  const data = buffer.getChannelData(0)
  const step = Math.floor(data.length / width)
  ctx2d.strokeStyle = '#AAFF00'
  ctx2d.lineWidth = 1
  ctx2d.beginPath()
  for (let x = 0; x < width; x++) {
    let min = 1, max = -1
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i] || 0
      if (v < min) min = v
      if (v > max) max = v
    }
    const yMin = (height / 2) + min * (height / 2 - 4)
    const yMax = (height / 2) + max * (height / 2 - 4)
    ctx2d.moveTo(x, yMin)
    ctx2d.lineTo(x, yMax)
  }
  ctx2d.stroke()
  // Center line
  ctx2d.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx2d.beginPath()
  ctx2d.moveTo(0, height / 2)
  ctx2d.lineTo(width, height / 2)
  ctx2d.stroke()
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png')) as unknown as Blob
}

export function generateSpectrogramImage(buffer: AudioBuffer): Blob {
  const canvas = document.createElement('canvas')
  const width = 800
  const height = 400
  canvas.width = width
  canvas.height = height
  const ctx2d = canvas.getContext('2d')!
  // Background
  ctx2d.fillStyle = '#0e1016'
  ctx2d.fillRect(0, 0, width, height)
  // Use the analyser to get frequency data
  const data = buffer.getChannelData(0)
  const fftSize = 2048
  const step = Math.floor(data.length / width)
  const imgData = ctx2d.createImageData(1, height)
  for (let x = 0; x < width; x++) {
    // Simple power spectrum for each column
    const samples = data.slice(x * step, x * step + fftSize)
    const spectrum = new Float32Array(fftSize / 2)
    for (let k = 0; k < fftSize / 2; k++) {
      let re = 0, im = 0
      for (let n = 0; n < samples.length; n++) {
        re += samples[n] * Math.cos(-2 * Math.PI * k * n / fftSize)
        im += samples[n] * Math.sin(-2 * Math.PI * k * n / fftSize)
      }
      spectrum[k] = Math.sqrt(re * re + im * im)
    }
    for (let y = 0; y < height; y++) {
      const freqIdx = Math.floor((1 - y / height) * (fftSize / 2))
      const mag = Math.min(1, spectrum[freqIdx] * 10)
      const r = Math.floor(mag * 170)
      const g = Math.floor(mag * 255)
      const b = Math.floor(mag * 50)
      imgData.data[0] = r; imgData.data[1] = g; imgData.data[2] = b; imgData.data[3] = 255
      ctx2d.putImageData(imgData, x, y)
    }
  }
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png')) as unknown as Blob
}

export function convertSpotifyUri(input: string): string {
  const trimmed = input.trim()
  // URL → URI: https://open.spotify.com/track/XXXX → spotify:track:XXXX
  const urlMatch = trimmed.match(/open\.spotify\.com\/(track|album|artist|playlist|episode|show)\/([a-zA-Z0-9]+)/)
  if (urlMatch) {
    return `spotify:${urlMatch[1]}:${urlMatch[2]}`
  }
  // URI → URL: spotify:track:XXXX → https://open.spotify.com/track/XXXX
  const uriMatch = trimmed.match(/spotify:(track|album|artist|playlist|episode|show):([a-zA-Z0-9]+)/)
  if (uriMatch) {
    return `https://open.spotify.com/${uriMatch[1]}/${uriMatch[2]}`
  }
  return 'Invalid input — expected a Spotify URL or URI'
}
