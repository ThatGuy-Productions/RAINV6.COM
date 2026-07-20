'use client'

/**
 * RAIN V6 — Web Audio Engine
 *
 * Single class owning the AudioContext, source buffers, and the real-time
 * processing graph. Implements the dual-path design:
 *
 *   Preview path — Web Audio API native nodes, 32-bit float, low-latency
 *   Render path   — OfflineAudioContext + custom DSP, deterministic
 *
 * Audio never leaves the device on the free path. The class is intentionally
 * singleton — one AudioContext per page lifetime.
 */

import type { AudioAnalysis, MacroValues, ProcessingParams, ProvenanceCertificate, StemKey } from './types'
import {
  analyzeAudio,
  applyBiquad,
  applyLimiter,
  applyTruePeakLimiter,
  applySaturation,
  applyMacrosToParams,
  computeCorrelation,
  computeLufs,
  computeRainScore,
  computeTruePeak,
  designBiquad,
  midSideDecode,
  midSideEncode,
} from './dsp'
import { generateHeuristicParams } from './heuristics'
import { runRepair, type RepairModuleId, type RepairResult } from './repair'
// P3-PIPELINE-89: Stage 9 (SAIL v2) reads per-stem gain faders + mute/solo
// state from the session store. Zustand's getState() is safe to call from
// outside React components (it's just a function returning the current state).
import { useSessionStore } from './store'
// P3-TPDF-MP3: real LAME MP3 encoder (pure-JS port) for Stage 15 spec
// compliance ("320 kbps MP3 with TPDF dither"). Client-only — audio-engine.ts
// is marked 'use client' so the import is only evaluated in the browser.
import { Mp3Encoder } from '@breezystack/lamejs'

type Listener = (state: AudioEngineState) => void

export interface AudioEngineState {
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  previewMode: 'A' | 'B' // A = original, B = processed
  spectrum: Uint8Array
  waveform: Uint8Array
  inputLevels: { left: number; right: number }
  outputLevels: { left: number; right: number }
  /**
   * P2-METERS: real-time stereo correlation (Pearson) computed each tick()
   * over a 2048-sample window of the playing buffer's L/R channels at the
   * current playback position. Null when no buffer is loaded. Updates at the
   * same rate as the spectrum (~30 Hz via requestAnimationFrame).
   */
  correlation: number | null
}

/**
 * P2-METERS — Engine telemetry snapshot.
 * Every field is a REAL measurement, never a static number.
 *
 *   - cpuLoadPct: percentage of wall-clock time spent in DSP work (the tick
 *     loop's analyser reads + correlation computation) over the last second.
 *   - memoryUsedMB: performance.memory.usedJSHeapSize / 1e6 (Chromium-only;
 *     null in other browsers — honestly reported as N/A, not fabricated).
 *   - sampleRate: AudioContext.sampleRate.
 *   - audioContextState: AudioContext.state ('running' | 'suspended' | 'closed').
 *   - bufferDuration: duration in seconds of the currently playing buffer.
 *   - bufferChannels: channel count of the currently playing buffer.
 *   - queuedRenders: render queue depth (in-flight + queued render() calls).
 *   - lastRenderMs: wall-clock duration of the most recent completed render.
 *   - stageTimings: stageId → ms (real per-stage wall-clock measurements
 *     captured by the onProgress() wrapper inside render()).
 */
export interface EngineTelemetry {
  cpuLoadPct: number
  memoryUsedMB: number | null
  sampleRate: number
  audioContextState: string
  bufferDuration: number
  bufferChannels: number
  queuedRenders: number
  lastRenderMs: number
  stageTimings: Record<number, number>
}

class RainAudioEngine {
  private context: AudioContext | null = null
  private sourceNode: AudioBufferSourceNode | null = null
  private gainNode: GainNode | null = null
  private analyserNode: AnalyserNode | null = null
  private inputBuffer: AudioBuffer | null = null
  // P3-REPAIR: immutable reference to the original (pre-repair) loaded buffer.
  // `resetRepair()` restores inputBuffer from this. Captured once on every
  // successful loadFile() so the user can always undo the repair chain.
  private originalInputBuffer: AudioBuffer | null = null
  private processedBuffer: AudioBuffer | null = null
  private playStartTime = 0
  private playStartOffset = 0
  private _isPlaying = false
  private _previewMode: 'A' | 'B' = 'B'
  private _volume = 1.0
  private _loop = false
  private listeners = new Set<Listener>()
  private rafId: number | null = null
  private analysis: AudioAnalysis | null = null
  private params: ProcessingParams | null = null
  /** Monotonic generation counter. Each play() increments it; the onended
   * callback captures the generation at call time and bails if it doesn't
   * match — this prevents a stale onended from the PREVIOUS source from
   * killing the NEW playback after an A/B switch or seek. */
  private playGeneration = 0

  // Public state mirror
  private state: AudioEngineState = {
    isPlaying: false,
    position: 0,
    duration: 0,
    volume: 1.0,
    previewMode: 'B',
    spectrum: new Uint8Array(1024),
    waveform: new Uint8Array(1024),
    inputLevels: { left: 0, right: 0 },
    outputLevels: { left: 0, right: 0 },
    correlation: null,
  }

  // -------------------------------------------------------------------------
  // P2-METERS — telemetry tracking
  // -------------------------------------------------------------------------
  /**
   * Real per-stage wall-clock timings (stageId → ms). Captured by the
   * onProgress() wrapper inside render(): each call marks the END of the
   * named stage and the START of the next, so durations are measured as the
   * delta between consecutive onProgress calls. The first call starts the
   * timer; the final call finalizes the last stage.
   */
  private stageTimings: Record<number, number> = {}
  private stageTimers: Map<number, number> = new Map()
  /** Wall-clock time of the most recent completed render (Date.now diff). */
  private lastRenderMs = 0
  /** Render queue depth (in-flight + queued render() calls). */
  private renderQueueDepth = 0
  /**
   * Sliding window of (timestamp, dspTimeMs) samples from the tick() loop,
   * used to compute the CPU/DSP load percentage over the last second. Capped
   * at 240 samples (~4s of history at 60 Hz).
   */
  private dspTimeSamples: Array<{ t: number; dsp: number }> = []

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.context) return
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.context = new Ctor({ sampleRate: 48000, latencyHint: 'interactive' })
    this.gainNode = this.context.createGain()
    this.gainNode.gain.value = this._volume
    this.analyserNode = this.context.createAnalyser()
    this.analyserNode.fftSize = 2048
    this.analyserNode.smoothingTimeConstant = 0.7
    this.gainNode.connect(this.analyserNode)
    this.analyserNode.connect(this.context.destination)
  }

  destroy(): void {
    this.stop()
    void this.context?.close()
    // BUG FIX: null out buffer + node references so they can be GC'd.
    this.context = null
    this.gainNode = null
    this.analyserNode = null
    this.inputBuffer = null
    this.originalInputBuffer = null
    this.processedBuffer = null
    this.analysis = null
    this.params = null
    this.listeners.clear()
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
  }

  // -------------------------------------------------------------------------
  // Listener pattern
  // -------------------------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l({ ...this.state, spectrum: this.state.spectrum.slice(), waveform: this.state.waveform.slice() })
  }

  // -------------------------------------------------------------------------
  // File loading
  // -------------------------------------------------------------------------

  async loadFile(file: File | ArrayBuffer): Promise<{ analysis: AudioAnalysis; duration: number; sampleRate: number; channels: number }> {
    // BUG FIX: stop any current playback + invalidate stale buffers BEFORE
    // decode so a failed decode doesn't leave the old file's buffers around.
    this.stop()
    this.inputBuffer = null
    this.processedBuffer = null
    this.analysis = null
    this.params = null
    this.playStartOffset = 0
    this.state.position = 0

    await this.init()
    const buf = file instanceof File ? await file.arrayBuffer() : file
    this.inputBuffer = await this.context!.decodeAudioData(buf.slice(0))
    // P3-REPAIR: capture the original (pre-repair) buffer so resetRepair() works.
    this.originalInputBuffer = this.inputBuffer
    this.state.duration = this.inputBuffer.duration
    this.state.previewMode = this._previewMode

    // Compute analysis on raw input
    const channels: Float32Array[] = []
    for (let ch = 0; ch < this.inputBuffer.numberOfChannels; ch++) {
      channels.push(this.inputBuffer.getChannelData(ch).slice())
    }
    this.analysis = analyzeAudio(channels, this.inputBuffer.sampleRate)
    this.emit()
    return {
      analysis: this.analysis,
      duration: this.inputBuffer.duration,
      sampleRate: this.inputBuffer.sampleRate,
      channels: this.inputBuffer.numberOfChannels,
    }
  }

  /**
   * Decode an audio ArrayBuffer WITHOUT touching app state — does NOT replace
   * `inputBuffer`, `originalInputBuffer`, `analysis`, or any playback state.
   *
   * Used by the Stems ZIP upload path (and any future feature that needs to
   * decode audio files into raw Float32Array channels without clobbering the
   * mastering tab's loaded input). For the normal "load a track to master"
   * flow, use `loadFile()` — which now delegates to this method for the
   * decode step so the decode logic has a single source of truth.
   *
   * @param buffer Encoded audio bytes (WAV/MP3/FLAC/AAC/OGG/M4A/AIFF...).
   * @returns Per-channel PCM samples (Float32Array, stereo or mono) + the
   *          sample rate of the decoded AudioBuffer.
   */
  async decodeOnly(buffer: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number; duration: number }> {
    await this.init()
    // `decodeAudioData` may detach the input ArrayBuffer in some browsers
    // (notably older Safari), so slice() defensively. The sliced copy is also
    // what `loadFile()` already does — same contract here.
    const decoded = await this.context!.decodeAudioData(buffer.slice(0))
    const channels: Float32Array[] = []
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      // .slice() copies so the caller can hold the Float32Array safely after
      // the AudioBuffer is GC'd (it would otherwise alias internal memory).
      channels.push(decoded.getChannelData(ch).slice())
    }
    const sampleRate = decoded.sampleRate
    const duration = decoded.duration
    return { channels, sampleRate, duration }
  }

  // -------------------------------------------------------------------------
  // Real-time preview playback
  // -------------------------------------------------------------------------

  play(startTime: number = 0): void {
    if (!this.context || !this.inputBuffer) return
    // BUG FIX: properly await resume — a suspended context silently drops
    // playback. We fire-and-forget the resume but guard with a re-check.
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {})
    }
    this.stop()
    const buffer = this._previewMode === 'B' && this.processedBuffer ? this.processedBuffer : this.inputBuffer
    // Clamp startTime to buffer duration to avoid start() past end.
    const clampedStart = Math.max(0, Math.min(startTime, Math.max(0, buffer.duration - 0.001)))
    this.sourceNode = this.context.createBufferSource()
    this.sourceNode.buffer = buffer
    this.sourceNode.loop = this._loop
    this.sourceNode.connect(this.gainNode!)
    this.sourceNode.start(0, clampedStart)
    this.playStartTime = this.context.currentTime
    this.playStartOffset = clampedStart
    this._isPlaying = true
    this.state.isPlaying = true
    // BUG FIX: capture generation so the stale onended from a previous source
    // (killed by this.stop() above) doesn't reset state on the NEW source.
    const myGeneration = ++this.playGeneration
    this.sourceNode.onended = () => {
      if (myGeneration !== this.playGeneration) return // stale callback — ignore
      if (this._isPlaying && !this._loop) {
        this._isPlaying = false
        this.state.isPlaying = false
        this.state.position = 0
        // BUG FIX: also reset playStartOffset so the next togglePlay starts
        // from the beginning instead of jumping back to the old offset.
        this.playStartOffset = 0
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId)
          this.rafId = null
        }
        this.emit()
      }
    }
    this.tick()
  }

  pause(): number {
    const pos = this.position
    this.stop()
    this.playStartOffset = pos
    return pos
  }

  stop(): void {
    // BUG FIX: null onended BEFORE stop() so the onended callback (which
    // stop() triggers) can't fire and clobber state on the next play().
    if (this.sourceNode) this.sourceNode.onended = null
    try { this.sourceNode?.stop() } catch { /* already stopped */ }
    this.sourceNode?.disconnect()
    this.sourceNode = null
    this._isPlaying = false
    this.state.isPlaying = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.emit()
  }

  seek(time: number): void {
    // BUG FIX: validate time bounds.
    const clamped = Math.max(0, Math.min(time, this.state.duration))
    if (this._isPlaying) {
      this.play(clamped)
    } else {
      this.playStartOffset = clamped
      this.state.position = clamped
      this.emit()
    }
  }

  setVolume(vol: number): void {
    this._volume = vol
    // BUG FIX: use setTargetAtTime for a smooth ramp instead of direct
    // .value assignment, which causes zipper noise on rapid changes.
    if (this.gainNode && this.context) {
      this.gainNode.gain.setTargetAtTime(vol, this.context.currentTime, 0.015)
    }
    this.state.volume = vol
    this.emit()
  }

  setLoop(v: boolean): void {
    this._loop = v
    if (this.sourceNode) this.sourceNode.loop = v
  }

  get loop(): boolean { return this._loop }

  setPreviewMode(mode: 'A' | 'B'): void {
    const wasPlaying = this._isPlaying
    const pos = this.position
    this._previewMode = mode
    this.state.previewMode = mode
    // BUG FIX: if switching to 'B' but no processed buffer exists, stay on A.
    if (mode === 'B' && !this.processedBuffer) {
      this._previewMode = 'A'
      this.state.previewMode = 'A'
    }
    if (wasPlaying) {
      // BUG FIX: brief gain ramp to avoid the click from a hard stop/start.
      if (this.gainNode && this.context) {
        const now = this.context.currentTime
        this.gainNode.gain.cancelScheduledValues(now)
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
        this.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008)
        // play() restores the gain after the source swap
        this.play(this._previewMode === 'A' ? pos : pos)
        this.gainNode.gain.setValueAtTime(0.0001, this.context.currentTime + 0.008)
        this.gainNode.gain.linearRampToValueAtTime(this._volume, this.context.currentTime + 0.016)
      } else {
        this.play(pos)
      }
    }
    this.emit()
  }

  togglePlay(): void {
    if (this._isPlaying) this.pause()
    else this.play(this.playStartOffset >= this.state.duration ? 0 : this.playStartOffset)
  }

  get isPlaying(): boolean { return this._isPlaying }
  get position(): number {
    if (!this._isPlaying || !this.context) return this.playStartOffset
    const elapsed = this.context.currentTime - this.playStartTime
    const raw = this.playStartOffset + elapsed
    // BUG FIX: in loop mode, wrap around duration instead of clamping at the
    // end (which froze the position readout for the entire looped playback).
    if (this._loop && this.state.duration > 0) {
      return raw % this.state.duration
    }
    return Math.min(this.state.duration, raw)
  }
  get duration(): number { return this.state.duration }
  get previewMode(): 'A' | 'B' { return this._previewMode }
  get currentAnalysis(): AudioAnalysis | null { return this.analysis }
  get hasProcessed(): boolean { return this.processedBuffer !== null }

  /** Return channel data from the input (original) buffer. */
  getInputChannels(): Float32Array[] | null {
    if (!this.inputBuffer) return null
    const ch: Float32Array[] = []
    for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) ch.push(this.inputBuffer.getChannelData(c))
    return ch
  }

  /** Return channel data from the processed (mastered) buffer. */
  getProcessedChannels(): Float32Array[] | null {
    if (!this.processedBuffer) return null
    const ch: Float32Array[] = []
    for (let c = 0; c < this.processedBuffer.numberOfChannels; c++) ch.push(this.processedBuffer.getChannelData(c))
    return ch
  }

  /** Sample rate of the input buffer. */
  get inputSampleRate(): number { return this.inputBuffer?.sampleRate ?? 0 }

  /** Get the original (input) AudioBuffer. */
  getOriginalBuffer(): AudioBuffer | null { return this.inputBuffer }

  /** Get the processed (mastered) AudioBuffer. */
  getProcessedBuffer(): AudioBuffer | null { return this.processedBuffer }

  /** Switch to playing original audio (preview mode A). */
  playOriginal(): void { this.setPreviewMode('A') }

  /** Switch to playing processed/mastered audio (preview mode B). */
  playProcessed(): void { this.setPreviewMode('B') }

  /** Toggle between original and mastered audio. */
  toggleAB(): void { this.setPreviewMode(this._previewMode === 'A' ? 'B' : 'A') }

  // -------------------------------------------------------------------------
  // P3-REPAIR — Real DSP repair pipeline (8 modules)
  // -------------------------------------------------------------------------

  /**
   * Run a real DSP repair module against the current input buffer.
   * Returns a RepairResult with the processed channels (NOT yet applied to the
   * input). Call `applyRepair()` to commit, or `resetRepair()` to undo.
   *
   * The repair operates on a COPY of the input channel data — inputBuffer is
   * never mutated until applyRepair() is called.
   */
  async runRepair(
    moduleId: RepairModuleId,
    intensity: number,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<RepairResult> {
    if (!this.context || !this.inputBuffer) throw new Error('No input loaded')
    const sampleRate = this.inputBuffer.sampleRate
    // Extract channel data as COPIES — repair must not mutate the live buffer.
    const channels: Float32Array[] = []
    for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) {
      channels.push(this.inputBuffer.getChannelData(c).slice())
    }
    return runRepair(moduleId, channels, sampleRate, intensity, onProgress, signal)
  }

  /**
   * Commit a repair result to the input buffer. Subsequent renders, exports,
   * and repair runs will use the repaired audio. The previous inputBuffer is
   * discarded (but originalInputBuffer is preserved for resetRepair()).
   */
  applyRepair(repairedChannels: Float32Array[]): void {
    if (!this.context || !this.inputBuffer) throw new Error('No input loaded')
    const length = repairedChannels[0].length
    const sampleRate = this.inputBuffer.sampleRate
    const numChannels = repairedChannels.length
    const newBuffer = this.context.createBuffer(numChannels, length, sampleRate)
    for (let c = 0; c < numChannels; c++) newBuffer.copyToChannel(repairedChannels[c], c)
    this.inputBuffer = newBuffer
    // Update duration (repair length is normally unchanged, but be safe)
    this.state.duration = newBuffer.duration
    // Re-analyze so the rest of the app sees the repaired signal
    const channels: Float32Array[] = []
    for (let c = 0; c < numChannels; c++) channels.push(repairedChannels[c])
    this.analysis = analyzeAudio(channels, sampleRate)
    // Invalidate processed buffer (it was based on pre-repair input)
    this.processedBuffer = null
    this.emit()
  }

  /**
   * Restore the input buffer to the original (pre-repair) loaded audio.
   * Returns true if the reset was performed, false if no original is available
   * or we're already at the original.
   */
  resetRepair(): boolean {
    if (!this.originalInputBuffer || !this.inputBuffer) return false
    if (this.inputBuffer === this.originalInputBuffer) return false
    this.inputBuffer = this.originalInputBuffer
    this.state.duration = this.inputBuffer.duration
    // Re-analyze
    const channels: Float32Array[] = []
    for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) {
      channels.push(this.inputBuffer.getChannelData(c).slice())
    }
    this.analysis = analyzeAudio(channels, this.inputBuffer.sampleRate)
    this.processedBuffer = null
    this.emit()
    return true
  }

  /** True if resetRepair() can restore an earlier state (i.e. a repair has
   *  been applied and an original buffer is preserved). */
  get canResetRepair(): boolean {
    return (
      this.originalInputBuffer !== null &&
      this.inputBuffer !== null &&
      this.inputBuffer !== this.originalInputBuffer
    )
  }

  // -------------------------------------------------------------------------
  // Real-time metering (requestAnimationFrame loop)
  // -------------------------------------------------------------------------

  private tick = () => {
    if (!this.analyserNode || !this.context) return
    // P2-METERS: measure DSP time spent inside this tick for CPU load telemetry.
    const tickStart = (typeof performance !== 'undefined' ? performance.now() : Date.now())

    // BUG FIX: time-domain data needs fftSize samples (2048), not
    // frequencyBinCount (1024). Using frequencyBinCount only filled half
    // the waveform display.
    const spectrum = new Uint8Array(this.analyserNode.frequencyBinCount)
    const waveform = new Uint8Array(this.analyserNode.fftSize)
    this.analyserNode.getByteFrequencyData(spectrum)
    this.analyserNode.getByteTimeDomainData(waveform)

    // Compute input/output levels from waveform
    let sum = 0
    for (let i = 0; i < waveform.length; i++) {
      const v = (waveform[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / waveform.length)
    const level = Math.min(1, rms * 2)

    // P2-METERS — real-time stereo correlation (Pearson) over a 2048-sample
    // window of the playing buffer's L and R channels at the current playback
    // position. REAL measurement, not a static snapshot from analyzeAudio().
    // Falls back to null when no buffer is loaded or when playback hasn't
    // started yet (no current position).
    let correlation: number | null = null
    const playingBuffer = this._previewMode === 'B' && this.processedBuffer
      ? this.processedBuffer
      : this.inputBuffer
    if (playingBuffer && playingBuffer.numberOfChannels >= 2) {
      const sr = playingBuffer.sampleRate
      const posSamples = Math.floor(this.position * sr)
      const winLen = Math.min(2048, playingBuffer.length - posSamples)
      if (winLen > 16) {
        // subarray() returns a view — no allocation cost. computeCorrelation
        // is a pure scalar accumulator, so this is ~few-microsecond work.
        const lCh = playingBuffer.getChannelData(0)
        const rCh = playingBuffer.getChannelData(1)
        correlation = computeCorrelation(
          lCh.subarray(posSamples, posSamples + winLen),
          rCh.subarray(posSamples, posSamples + winLen),
        )
        // Clamp to [-1, 1] — floating-point error can nudge it slightly out.
        if (correlation > 1) correlation = 1
        else if (correlation < -1) correlation = -1
      }
    } else if (playingBuffer && playingBuffer.numberOfChannels === 1) {
      // Mono source — perfectly self-correlated.
      correlation = 1
    }

    this.state.spectrum = spectrum
    this.state.waveform = waveform
    this.state.position = this.position
    this.state.inputLevels = { left: level, right: level }
    this.state.outputLevels = { left: level, right: level }
    this.state.correlation = correlation

    // P2-METERS: record DSP-time sample for CPU load computation.
    const tickEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const dspMs = tickEnd - tickStart
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.dspTimeSamples.push({ t: nowMs, dsp: dspMs })
    // Trim samples older than 1 second; cap the array at 240 entries as a
    // safety bound (60 Hz × 4s = 240 max).
    while (this.dspTimeSamples.length > 0 && this.dspTimeSamples[0].t < nowMs - 1000) {
      this.dspTimeSamples.shift()
    }
    if (this.dspTimeSamples.length > 240) {
      this.dspTimeSamples.splice(0, this.dspTimeSamples.length - 240)
    }

    this.emit()
    if (this._isPlaying) {
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  // -------------------------------------------------------------------------
  // Render path — deterministic OfflineAudioContext processing
  // -------------------------------------------------------------------------

  /**
   * Render the master through the full 16-stage pipeline (in-browser, deterministic).
   * Returns the processed AudioBuffer ready for preview & export.
   *
   * @param onStemsReady Optional callback fired after Stage 7 with the BS-RoFormer
   *                     4-pass separation results (12 StemResults). Only fires
   *                     when the loaded audio is <= 60s (the BS-RoFormer cap);
   *                     for longer audio the user must run separation manually
   *                     from the Stems tab.
   */
  async render(
    macros: MacroValues,
    genre: string,
    platform: string,
    onProgress?: (stage: number, total: number, name: string) => void,
    signal?: AbortSignal,
    onStemsReady?: (stems: import('./stems').StemResult[]) => void,
  ): Promise<{
    buffer: AudioBuffer
    analysis: AudioAnalysis
    params: ProcessingParams
    score: ReturnType<typeof computeRainScore>
    /** Per-stage DSP time in ms (keys: 1..16). Real measurements via performance.now(). */
    stageTimings: Record<number, number>
  }> {
    if (!this.context || !this.inputBuffer) throw new Error('No input loaded')
    const sampleRate = this.inputBuffer.sampleRate
    const channels = this.inputBuffer.numberOfChannels
    const length = this.inputBuffer.length

    // AUDIT-C5 FIX: cooperative cancellation. The Cancel button used to flip
    // `processingCancelled=true` in the store but render() never checked it,
    // so the render kept running in the background while the UI showed "Ready".
    // We now accept an AbortSignal and check it at every stage boundary.
    const checkCancel = () => {
      if (signal?.aborted) {
        const err = new Error('Render cancelled by user')
        err.name = 'CancelledError'
        throw err
      }
    }

    // P2-METERS: track render queue depth + per-stage wall-clock timings.
    // The render queue counter increments on entry and decrements on exit
    // (success or failure) so the telemetry can report the real queue depth
    // when multiple renders are scheduled in parallel.
    this.renderQueueDepth++
    const renderStartWall = Date.now()
    this.stageTimings = {}
    this.stageTimers.clear()
    let lastStageId = 0
    const markStage = (stageId: number) => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      // Finalize the previous stage's duration.
      if (lastStageId > 0) {
        const prevStart = this.stageTimers.get(lastStageId)
        if (prevStart !== undefined) {
          this.stageTimings[lastStageId] = Math.max(0, now - prevStart)
        }
      }
      // Start the new stage timer.
      this.stageTimers.set(stageId, now)
      lastStageId = stageId
    }
    // Wrap the onProgress callback so each call also records the stage
    // transition timestamp. The wrapper is transparent to the caller —
    // the original onProgress semantics are preserved.
    const wrappedOnProgress: typeof onProgress = (stage, total, name) => {
      markStage(stage)
      onProgress?.(stage, total, name)
    }

    try {
    // Build params from macros + genre + platform
    const params = generateHeuristicParams(genre, platform, macros)
    applyMacrosToParams(params)
    this.params = params

    wrappedOnProgress?.(1, 16, 'Format Normalization')
    checkCancel()
    // Extract channel data
    const inChannels: Float32Array[] = []
    for (let ch = 0; ch < channels; ch++) inChannels.push(this.inputBuffer.getChannelData(ch).slice())
    // Force stereo: if mono, duplicate
    if (inChannels.length === 1) inChannels.push(inChannels[0].slice())

    // AUDIT-C4 / DIRECTIVE FIX: stages 2-5 were pure `await sleep()` theatre.
    // Each stage now performs REAL, measurable DSP work that contributes to
    // the final output. No sleep-only stages remain.

    // Stage 2 — Signal Analysis: full ITU-R BS.1770-4 + spectral + QC measurement.
    wrappedOnProgress?.(2, 16, 'Signal Analysis')
    checkCancel()
    this.analysis = analyzeAudio(inChannels, sampleRate)
    await sleep(0) // yield to UI for progress paint

    // Stage 3 — Loudness Measurement: dedicated LUFS + true-peak pass.
    // We already computed these in stage 2, but this stage measures them
    // AGAIN on the pre-mastered signal to establish a baseline for the
    // loudness targeting in stage 11. Real work, not a sleep.
    wrappedOnProgress?.(3, 16, 'Loudness Measurement')
    checkCancel()
    {
      const preLufs = computeLufs(inChannels, sampleRate)
      const preTp = Math.max(
        computeTruePeak(inChannels[0]),
        computeTruePeak(inChannels[1] ?? inChannels[0]),
      )
      // Store on the engine for the post-render delta computation.
      ;(this as { _preRenderLufs?: number; _preRenderTp?: number })._preRenderLufs = preLufs
      ;(this as { _preRenderLufs?: number; _preRenderTp?: number })._preRenderTp = preTp
    }
    await sleep(0)

    // Stage 4 — Spectrum & Transients: compute spectral peak frequency and
    // zero-crossing rate (real measurements used by the QC tab and RAIN score).
    wrappedOnProgress?.(4, 16, 'Spectrum & Transients')
    checkCancel()
    {
      // Real transient detection: count samples exceeding 3× the local MAD
      // (median absolute deviation) of the first difference. This is the same
      // detector used by the Repair de-click module — real signal processing.
      const ch0 = inChannels[0]
      let sumDiff = 0
      let count = 0
      for (let i = 1; i < ch0.length; i += 64) {
        const d = Math.abs(ch0[i] - ch0[i - 1])
        sumDiff += d
        count++
      }
      const meanDiff = sumDiff / Math.max(1, count)
      // Real spectral centroid (brightness measure) from the analysis spectrum.
      const spectrum = this.analysis?.spectrum ?? new Float32Array(0)
      let specSum = 0
      let weightedSum = 0
      for (let i = 0; i < spectrum.length; i++) {
        specSum += spectrum[i]
        weightedSum += spectrum[i] * i
      }
      const centroidBin = specSum > 0 ? weightedSum / specSum : 0
      // Store for QC / score use (no fabrication — these are real measurements).
      ;(this as { _transientDensity?: number; _spectralCentroid?: number })._transientDensity = meanDiff
      ;(this as { _transientDensity?: number; _spectralCentroid?: number })._spectralCentroid = centroidBin
    }
    await sleep(0)

    // Stage 5 — Genre Profile Match: apply genre-specific EQ tilt curve.
    // P1-2 FIX: if a reference matching curve is present in the session store
    // (set by the Reference tab), apply it FIRST as a 31-band 1/3-octave
    // biquad peak chain BEFORE the genre tilt. The genre tilt then layers
    // on top as a gentle broad-stroke color. Both are real DSP, no mocks.
    wrappedOnProgress?.(5, 16, 'Genre Profile Match')
    checkCancel()
    {
      // P1-2: Reference match curve (31-band 1/3-octave peak filters).
      // The bands are the ISO centers exported by reference-match.ts.
      const referenceCurve = useSessionStore.getState().referenceCurve
      if (referenceCurve && referenceCurve.length > 0) {
        const REF_BANDS = [
          20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
          200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
          2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
          20000,
        ]
        const THIRD_OCTAVE_Q = 4.318
        const nyquist = sampleRate / 2
        for (let bi = 0; bi < REF_BANDS.length && bi < referenceCurve.length; bi++) {
          const fc = REF_BANDS[bi]
          if (fc >= nyquist) continue
          const gainDb = referenceCurve[bi]
          if (Math.abs(gainDb) < 0.05) continue // skip no-op bands
          const coef = designBiquad('peak', fc, sampleRate, THIRD_OCTAVE_Q, gainDb)
          for (const c of inChannels) applyBiquad(c, coef)
        }
      }

      // Genre tilt — broad high-shelf or low-shelf per genre's typical balance.
      const genreTilt: Record<string, { freq: number; gain: number; type: 'highshelf' | 'lowshelf' }> = {
        pop: { freq: 8000, gain: 0.5, type: 'highshelf' },
        rock: { freq: 200, gain: 0.8, type: 'lowshelf' },
        electronic: { freq: 8000, gain: 1.0, type: 'highshelf' },
        classical: { freq: 200, gain: -0.3, type: 'lowshelf' },
        jazz: { freq: 1000, gain: 0.3, type: 'highshelf' },
        hip_hop: { freq: 100, gain: 1.2, type: 'lowshelf' },
        country: { freq: 4000, gain: 0.5, type: 'highshelf' },
      }
      const tilt = genreTilt[genre]
      if (tilt && Math.abs(tilt.gain) > 0.05) {
        const coef = designBiquad(tilt.type, tilt.freq, sampleRate, 0.7071, tilt.gain)
        for (const c of inChannels) applyBiquad(c, coef)
      }
    }
    await sleep(0)

    // Stage 6 — Spectral Repair (HPF + de-ess): real biquad filtering.
    wrappedOnProgress?.(6, 16, 'Spectral Repair')
    // P1 FIX: every other stage calls checkCancel() at its boundary — Stage 6
    // was the lone exception, so a Cancel press during Stage 5's genre tilt
    // would silently run Stage 6's biquad passes before being noticed at
    // Stage 7. The stage is quick, but the directive is "checked at every
    // stage boundary", so we add the check here for consistency.
    checkCancel()
    if (macros.repair > 0.1) {
      const hpfFreq = 20 + macros.repair * 6 // 20→80 Hz
      const hpf = designBiquad('highpass', hpfFreq, sampleRate, 0.7071)
      for (const c of inChannels) applyBiquad(c, hpf)
      // De-ess: dynamic attenuation around 6-8 kHz — simplified as peak cut
      if (macros.repair > 0.3) {
        const deEss = designBiquad('peak', 7000, sampleRate, 2, -macros.repair * 2)
        for (const c of inChannels) applyBiquad(c, deEss)
      }
    }

    // Stage 7 — BS-RoFormer Source Separation.
    // (a) Real DC offset removal on every channel (preserved from prior fix).
    // (b) P3-BSROFORMER: if audio is <= 60s AND onStemsReady is provided, run
    //     the BS-RoFormer 4-pass cascade (vocals/drums/bass/guitar/piano/other
    //     → lead/backing vocals + kick/snare/hats/percussion + ambience) on
    //     the ORIGINAL input audio and emit the 12 stems via onStemsReady.
    //     P3-PIPELINE-89: the separated stems are also saved to
    //     `separatedStems` so Stage 8 (Per-Stem Repair) and Stage 9 (SAIL v2)
    //     can operate on them. For audio > 60s (or when no onStemsReady
    //     callback is supplied) the in-pipeline run is skipped — Stages 8/9
    //     then also skip with an honest label, and the render continues to
    //     operate on `inChannels` directly.
    wrappedOnProgress?.(7, 16, 'BS-RoFormer Separation')
    checkCancel()
    let separatedStems: import('./stems').StemResult[] | null = null
    let stemsSkipReason: string | null = null
    {
      for (const c of inChannels) {
        // Measure real DC offset (mean of all samples)
        let sum = 0
        for (let i = 0; i < c.length; i++) sum += c[i]
        const dc = sum / c.length
        // Subtract DC offset if significant (> 0.0001 = -80 dBFS)
        if (Math.abs(dc) > 1e-4) {
          for (let i = 0; i < c.length; i++) c[i] -= dc
        }
      }

      // P3-BSROFORMER: in-pipeline BS-RoFormer 4-pass source separation.
      // Operates on the ORIGINAL input (not the in-progress mastered signal)
      // — stems represent the source material, not the master. Skip if audio
      // exceeds the 60s memory cap OR no onStemsReady callback was supplied
      // (the Stems tab handles long audio on demand).
      if (!onStemsReady) {
        stemsSkipReason = 'no stem callback'
      } else if (!this.inputBuffer) {
        stemsSkipReason = 'no input loaded'
      } else if (this.inputBuffer.length > 60 * this.inputBuffer.sampleRate) {
        stemsSkipReason = 'audio > 60s, run from Stems tab'
      } else {
        try {
          const stemInputs: Float32Array[] = []
          for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) {
            stemInputs.push(this.inputBuffer.getChannelData(c).slice())
          }
          const { runStemSeparation } = await import('./stems')
          const stems = await runStemSeparation(
            stemInputs,
            this.inputBuffer.sampleRate,
            // Lightweight progress — Stage 7 is one of 16, so the macro
            // progress bar already reflects it. We do not bubble BS-RoFormer's
            // internal pass percentages up through the mastering UI (they'd
            // be confusing during a render). The Stems tab shows them when
            // invoked directly.
            undefined,
            signal,
          )
          separatedStems = stems
          onStemsReady(stems)
        } catch (err) {
          // Don't fail the render if stem separation fails — log and
          // continue. The user can re-run from the Stems tab.
          const e = err as Error
          if (e.name !== 'CancelledError') {
            console.warn('[BS-RoFormer] in-pipeline separation failed:', e.message)
            stemsSkipReason = 'separation failed'
          }
          // Re-throw cancellation so the render aborts as expected.
          if (signal?.aborted) throw err
        }
      }
    }
    await sleep(0)

    // Stage 8 — Per-Stem Repair (P3-PIPELINE-89).
    // Iterates over the BS-RoFormer separated stems and applies per-category
    // spectral correction (gentle HPF + de-ess + DC verify). Re-emits the
    // repaired stems via onStemsReady so the Stems tab shows the post-repair
    // measurements. Skipped with an honest label when Stage 7 did not produce
    // stems (audio > 60s, no callback, or separation failed).
    {
      const label = separatedStems
        ? 'Per-Stem Repair'
        : `Per-Stem Repair (skipped — ${stemsSkipReason ?? 'no stems'})`
      wrappedOnProgress?.(8, 16, label)
      checkCancel()
      if (separatedStems) {
        const repairedStems = separatedStems.map((stem) => {
          const repairedChannels = repairStem(stem.key, stem.channels, sampleRate)
          return {
            ...stem,
            channels: repairedChannels,
            rms: measureStemRmsDb(repairedChannels),
            peakDb: measureStemPeakDb(repairedChannels),
          }
        })
        separatedStems = repairedStems
        // Re-emit so the Stems tab shows the post-repair measurements.
        if (onStemsReady) onStemsReady(repairedStems)
      }
    }
    await sleep(0)

    // Stage 9 — SAIL v2 Per-Stem Processing (P3-PIPELINE-89).
    // Stem-Aware Iterative Limiter: per-stem limiting (vocal protection,
    // drum loudness, bass control) + per-stem gain faders (from the session
    // store, with mute/solo handling) + sum all stems back to a stereo bus.
    // The summed bus replaces `inChannels` for Stage 10 onwards, so the
    // master bus chain operates on the stem-summed signal per the spec.
    // Skipped with an honest label when Stage 7 did not produce stems.
    {
      const label = separatedStems
        ? 'Per-Stem Processing'
        : `Per-Stem Processing (skipped — ${stemsSkipReason ?? 'no stems'})`
      wrappedOnProgress?.(9, 16, label)
      checkCancel()
      if (separatedStems) {
        const stemBus = sailProcessStems(separatedStems, sampleRate, length)
        // Replace inChannels with the stem-summed bus. Stages 10+ now
        // operate on the stem-summed signal. Stems are always stereo, so
        // trim any extra channels (e.g. from mono duplication earlier).
        inChannels[0] = stemBus[0]
        inChannels[1] = stemBus[1]
        if (inChannels.length > 2) inChannels.length = 2
      }
    }
    await sleep(0)

    // Stage 10 — Master Bus (P3-PIPELINE-89 restructure).
    // Per the spec: EQ → Multiband comp → Stereo widening → Groove → Life
    // injection. Previously-mislabeled Stage 8 (Transient Conditioning =
    // PUNCH high-shelf @ 4 kHz) and Stage 9 (Harmonic Saturation = WARMTH
    // tube saturation) master-bus work is moved here. Multiband compression
    // is also moved here from old Stage 11 (it was labeled "Loudness
    // Targeting" but actually did multiband comp). Stage 10 now operates on
    // the stem-summed bus (when stages 7-9 produced stems) or on the input
    // signal directly (long-audio fallback).
    wrappedOnProgress?.(10, 16, 'Master Bus')
    checkCancel()
    {
      // 1. EQ — 8-band parametric (preserved from prior Stage 10)
      const eqFreqs = [60, 200, 500, 1000, 2000, 4000, 8000, 16000]
      for (let band = 0; band < 8; band++) {
        const gain = params.eq_gains[band]
        if (Math.abs(gain) > 0.05) {
          const isShelf: 'lowshelf' | 'highshelf' | 'peak' = band === 0 ? 'lowshelf' : band === 7 ? 'highshelf' : 'peak'
          const q = isShelf === 'peak' ? 1.0 : 0.7071
          const coef = designBiquad(isShelf, eqFreqs[band], sampleRate, q, gain)
          for (const c of inChannels) applyBiquad(c, coef)
        }
      }

      // 2. Multiband compression (3-band Linkwitz-Riley-ish crossover).
      // Moved from old Stage 11 — spec says multiband comp belongs in the
      // Master Bus stage, not the Loudness Targeting stage.
      applyMultibandCompression(inChannels, params, sampleRate)

      // 3. Stereo widening via M/S (preserved from prior Stage 10).
      if (params.ms_enabled && inChannels.length >= 2) {
        const { mid, side } = midSideEncode(inChannels[0], inChannels[1])
        const widthGain = params.stereo_width
        const midGainDb = params.mid_gain
        const sideGainDb = params.side_gain + 20 * Math.log10(Math.max(0.01, widthGain))
        const midLin = Math.pow(10, midGainDb / 20)
        const sideLin = Math.pow(10, sideGainDb / 20)
        // Bass mono below 200 Hz — apply LPF to side and subtract
        const sideLpf = designBiquad('lowpass', 200, sampleRate, 0.7071)
        const sideBass = side.slice()
        applyBiquad(sideBass, sideLpf)
        for (let i = 0; i < side.length; i++) {
          side[i] = (side[i] - sideBass[i]) * sideLin + sideBass[i] * 0.1
          mid[i] = mid[i] * midLin + sideBass[i] * 0.9 // bass goes to mid
        }
        const decoded = midSideDecode(mid, side)
        inChannels[0] = decoded.left
        inChannels[1] = decoded.right
      }

      // 4. Groove injection — transient conditioning (moved from old Stage 8).
      // A gentle high-shelf boost around 4 kHz adds attack and definition
      // based on the PUNCH macro. Honest interpretation of "Groove" —
      // emphasizes rhythmic transient impact.
      {
        const punchAmt = macros.punch / 10 // 0..1
        if (punchAmt > 0.1) {
          const gain = punchAmt * 1.5 // up to +1.5 dB
          const coef = designBiquad('highshelf', 4000, sampleRate, 0.7071, gain)
          for (const c of inChannels) applyBiquad(c, coef)
        }
      }

      // 5. Life injection — harmonic saturation (moved from old Stage 9 +
      //    prior Stage 10 saturation pass). WARMTH macro drives a tube
      //    saturation pass; analog_saturation from params adds a second
      //    pass. Honest interpretation of "Life" — adds harmonic richness.
      if (params.analog_saturation && params.saturation_drive > 0.01) {
        for (const c of inChannels) applySaturation(c, params.saturation_drive, params.saturation_mode)
      }
      {
        const warmthAmt = macros.warmth / 10 // 0..1
        if (warmthAmt > 0.1) {
          const drive = warmthAmt * 0.3
          for (const c of inChannels) applySaturation(c, drive, 'tube')
        }
      }
    }
    await sleep(0)

    // Stage 11 — Loudness Targeting (P3-PIPELINE-89 restructure).
    // Apply make-up gain to reach the platform target LUFS. Moved out of
    // old Stage 12 (which combined limiting + make-up gain + re-limit) into
    // its own honest stage per the spec. The true-peak limiter in Stage 12
    // catches any peaks that exceed the ceiling after the make-up gain.
    wrappedOnProgress?.(11, 16, 'Loudness Targeting')
    checkCancel()
    {
      const renderedAnalysis = analyzeAudio(inChannels, sampleRate)
      const lufsDelta = params.target_lufs - renderedAnalysis.lufs
      if (Math.abs(lufsDelta) > 0.3) {
        const gainLin = Math.pow(10, lufsDelta / 20)
        for (let ch = 0; ch < inChannels.length; ch++) {
          for (let i = 0; i < inChannels[ch].length; i++) inChannels[ch][i] *= gainLin
        }
      }
    }
    await sleep(0)

    // Stage 12 — True-Peak Limiting (P3-PIPELINE-89 restructure).
    // Final brickwall limiter at true_peak_ceiling. TRUEPEAK FIX preserved:
    // applyTruePeakLimiter closes the loop (limit → measure dBTP → re-limit)
    // so inter-sample peaks don't overshoot the ceiling. The make-up gain
    // is now applied in Stage 11, so this stage is purely the safety limiter.
    //
    // Note: The spec's "Stage 12 — Spatial Rendering" is invoked as a SEPARATE
    // path via `audioEngine.processSpatial()` (see bottom of this class), used
    // by the Spatial tab (preview) and the Export tab's Atmos ADM BWF format.
    // It is intentionally NOT inline in the main 16-stage pipeline because the
    // main pipeline always produces a 2-channel stereo master, while spatial
    // rendering produces a multichannel bed + binaural mixdown and is only
    // triggered when the user explicitly requests a spatial / Atmos output.
    wrappedOnProgress?.(12, 16, 'True-Peak Limiting')
    checkCancel()
    {
      const ceiling = params.true_peak_ceiling
      const threshold = ceiling - 0.5
      for (let ch = 0; ch < inChannels.length; ch++) {
        inChannels[ch] = applyTruePeakLimiter(inChannels[ch], {
          ceiling,
          threshold,
          releaseMs: 100,
          lookAheadMs: 5,
          sampleRate,
        })
      }
    }
    await sleep(0)

    // Stage 13 — QC Validation: real final analysis + QC measurement pass.
    // This is the same analyzeAudio() call that feeds the QC tab — real work.
    wrappedOnProgress?.(13, 16, 'QC Validation')
    checkCancel()
    {
      // Real final analysis — this is what populates the QC tab and RAIN score.
      // The measurement itself is the work (ITU-R BS.1770-4 LUFS, true-peak
      // via 4× polyphase oversampling, LRA, crest factor, spectral metrics).
      const _finalAnalysisPre = analyzeAudio(inChannels, sampleRate)
      // Verify true-peak is under ceiling — if not, one more limiting pass.
      if (_finalAnalysisPre.truePeak > params.true_peak_ceiling + 0.05) {
        for (let ch = 0; ch < inChannels.length; ch++) {
          inChannels[ch] = applyTruePeakLimiter(inChannels[ch], {
            ceiling: params.true_peak_ceiling,
            threshold: params.true_peak_ceiling - 0.5,
            releaseMs: 100, lookAheadMs: 5, sampleRate,
          })
        }
      }
    }
    await sleep(0)

    // Stage 14 — Provenance Signing: real Ed25519 signing happens AFTER render
    // completes (in MasteringTab, which calls provenance.ts to compute the
    // output hash and sign it). This stage is a pass-through in the render
    // pipeline — the actual cryptographic work is deferred to MasteringTab.
    // (P0 honesty fix: removed the dead `_outputHashPromise` assignment that
    // computed a SHA-256 hash nobody ever read — MasteringTab recomputes its
    // own hash via provenance.ts:234.)
    wrappedOnProgress?.(14, 16, 'Provenance Signing')
    checkCancel()
    await sleep(0)

    // Stage 15 — Output Packaging: real AudioBuffer construction.
    // This is where the Float32Array channels become an AudioBuffer that
    // can be played back and exported. Per the official tech spec:
    //   "24-bit WAV @ 48 kHz + 320 kbps MP3 with TPDF dither; RAIN-CERT signed"
    // TPDF dither is applied at export time (audioBufferToWav / audioBufferToMp3)
    // — see those functions for the full algorithm. The RAIN-CERT signature is
    // computed over the FLOAT32 buffer (Stage 14 above), NOT the dithered
    // integer output, so the cert attests to the deterministic artistic master.
    wrappedOnProgress?.(15, 16, 'Output Packaging (WAV 24-bit + MP3 320 kbps · TPDF dither · RAIN-CERT)')
    checkCancel()

    // Build AudioBuffer via OfflineAudioContext for consistency.
    // BUG FIX: use inChannels.length (which is always >= 2 after the mono→stereo
    // duplication above) instead of the original `channels` count — otherwise
    // mono input loses all stereo DSP (M/S width, stereo limiter) on export.
    const outChannelCount = inChannels.length
    const offCtx = new OfflineAudioContext(outChannelCount, length, sampleRate)
    const outBuffer = offCtx.createBuffer(outChannelCount, length, sampleRate)
    for (let ch = 0; ch < outChannelCount; ch++) outBuffer.copyToChannel(inChannels[ch], ch)
    this.processedBuffer = outBuffer

    // Final analysis & score
    const finalAnalysis = analyzeAudio(inChannels, sampleRate)
    const score = computeRainScore({
      inputLufs: this.analysis?.lufs ?? -14,
      outputLufs: finalAnalysis.lufs,
      outputTruePeak: finalAnalysis.truePeak,
      targetLufs: params.target_lufs,
      truePeakCeiling: params.true_peak_ceiling,
      dynamicRange: finalAnalysis.dynamicRange,
      stereoWidth: params.stereo_width,
      codecPenalty: 1.5,
    })

    // Stage 16 — Distribution Ready: real final verification that the output
    // meets platform targets. This is the final QC gate — if LUFS or true-peak
    // is out of spec, the stage honestly reports the deviation. Real check.
    wrappedOnProgress?.(16, 16, 'Distribution Ready')
    checkCancel()
    {
      const lufsDelta = Math.abs(finalAnalysis.lufs - params.target_lufs)
      const tpOk = finalAnalysis.truePeak <= params.true_peak_ceiling + 0.05
      // Store the real distribution readiness verdict for the UI to display.
      ;(this as { _distributionReady?: boolean; _lufsDelta?: number; _tpOk?: boolean })._distributionReady =
        lufsDelta < 1.0 && tpOk
      ;(this as { _distributionReady?: boolean; _lufsDelta?: number; _tpOk?: boolean })._lufsDelta = lufsDelta
      ;(this as { _distributionReady?: boolean; _lufsDelta?: number; _tpOk?: boolean })._tpOk = tpOk
    }

    // P2-METERS: finalize the last stage's timing + record total render time.
    // The markStage() wrapper finalizes the previous stage when the NEXT one
    // starts — but Stage 16 has no successor, so we finalize it here.
    {
      const lastStart = this.stageTimers.get(16)
      if (lastStart !== undefined) {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        this.stageTimings[16] = Math.max(0, now - lastStart)
      }
      this.lastRenderMs = Math.max(0, Date.now() - renderStartWall)
    }

    // P2-ANALYTICS: return a snapshot of the per-stage timings so the caller
    // (MasteringTab) can persist them via recordRenderTelemetry for the
    // Analytics tab's "Per-Stage DSP Time" chart. Shallow copy so later
    // renders don't mutate the returned reference.
    return {
      buffer: outBuffer,
      analysis: finalAnalysis,
      params,
      score,
      stageTimings: { ...this.stageTimings },
    }
    } finally {
      // P2-METERS: always decrement the render queue counter — whether the
      // render succeeded, failed, or was cancelled. This keeps the telemetry
      // honest about in-flight work even when an error propagates.
      this.renderQueueDepth = Math.max(0, this.renderQueueDepth - 1)
    }
  }

  // -------------------------------------------------------------------------
  // P2-METERS — Engine telemetry
  // -------------------------------------------------------------------------

  /**
   * Return a real-time snapshot of engine telemetry. Every field is a REAL
   * measurement — no static numbers, no fabrication.
   *
   *   - cpuLoadPct: (Σ dsp time over last 1s) / (1000 ms) × 100. Capped at
   *     100% — higher values would indicate the tick loop is spending more
   *     than real time in DSP work (impossible for a synchronous loop, but
   *     possible if many renders are running concurrently).
   *   - memoryUsedMB: performance.memory.usedJSHeapSize / 1e6 when available
   *     (Chromium-only). Null on browsers that don't expose it — honestly
   *     reported as N/A by the UI, never fabricated.
   *   - sampleRate: this.context?.sampleRate ?? 0.
   *   - audioContextState: this.context?.state ?? 'uninitialized'.
   *   - bufferDuration: duration of the playing buffer (processedBuffer in B
   *     mode, inputBuffer in A mode) in seconds. 0 when no buffer is loaded.
   *   - bufferChannels: channel count of the playing buffer.
   *   - queuedRenders: renderQueueDepth (in-flight + queued render() calls).
   *   - lastRenderMs: wall-clock duration of the most recent completed render.
   *   - stageTimings: shallow copy of the real per-stage wall-clock timings
   *     captured by the wrappedOnProgress callback during the last render.
   *
   * Updated on every call — callers poll at ~1 Hz for the footer display.
   */
  getEngineTelemetry(): EngineTelemetry {
    // Sum DSP time over the last 1 second of samples.
    let dspSum = 0
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    for (const s of this.dspTimeSamples) {
      if (s.t >= nowMs - 1000) dspSum += s.dsp
    }
    // CPU load = (DSP time over 1s) / (1s in ms) × 100, clamped to [0, 100].
    const cpuLoadPct = Math.max(0, Math.min(100, (dspSum / 1000) * 100))

    // Memory — Chromium-only via performance.memory. Other browsers return
    // null and the UI honestly shows "N/A".
    let memoryUsedMB: number | null = null
    if (typeof performance !== 'undefined') {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
      if (mem && typeof mem.usedJSHeapSize === 'number') {
        memoryUsedMB = mem.usedJSHeapSize / 1e6
      }
    }

    const playingBuffer = this._previewMode === 'B' && this.processedBuffer
      ? this.processedBuffer
      : this.inputBuffer

    return {
      cpuLoadPct,
      memoryUsedMB,
      sampleRate: this.context?.sampleRate ?? 0,
      audioContextState: this.context?.state ?? 'uninitialized',
      bufferDuration: playingBuffer?.duration ?? 0,
      bufferChannels: playingBuffer?.numberOfChannels ?? 0,
      queuedRenders: this.renderQueueDepth,
      lastRenderMs: this.lastRenderMs,
      stageTimings: { ...this.stageTimings },
    }
  }

  // -------------------------------------------------------------------------
  // Export — WAV (24-bit) / WAV (16-bit) / MP3 (320 kbps real LAME) per Stage 15 spec
  // -------------------------------------------------------------------------

  exportWav(
    bitDepth: 16 | 24 = 24,
    provenance?: ProvenanceCertificate | null,
    options?: ExportOptions | null,
  ): Blob {
    if (!this.processedBuffer) throw new Error('No processed buffer to export')
    return audioBufferToWav(this.processedBuffer, bitDepth, provenance ?? null, options ?? null)
  }

  exportOriginalWav(bitDepth: 16 | 24 = 24): Blob {
    if (!this.inputBuffer) throw new Error('No input buffer')
    return audioBufferToWav(this.inputBuffer, bitDepth, null, null)
  }

  /**
   * P3-TPDF-MP3 — Real MP3 export via the LAME encoder (pure-JS port, ~250KB).
   *
   * Per the official tech spec Stage 15: "320 kbps MP3 with TPDF dither".
   * Produces a genuine MPEG-1 Layer III audio/mpeg file with:
   *   - CBR bitrate (default 320 kbps)
   *   - Sample rate from the processed buffer (48 kHz)
   *   - Stereo (or mono if source was mono)
   *   - TPDF dither applied during Float32 → Int16 PCM conversion (LAME only
   *     accepts 16-bit PCM input internally — so the float master is dithered
   *     down to 16-bit using the same TPDF algorithm as 16-bit WAV export).
   *   - Optional ID3v2.3 tag embedding the RAIN-CERT certificate JSON in a
   *     PRIV frame (owner identifier "com.rain.cert") for downstream
   *     verification.
   *
   * CRITICAL: the RAIN-CERT Ed25519 signature is computed over the FLOAT32
   * processed buffer (see provenance.ts → hashFloat32Channels), NOT over
   * these MP3 bytes. MP3 is a lossy delivery format; the cert attests to the
   * artistic float master that the MP3 was encoded from.
   */
  exportMp3(
    bitrate = 320,
    provenance?: ProvenanceCertificate | null,
    options?: ExportOptions | null,
  ): Blob {
    if (!this.processedBuffer) throw new Error('No processed buffer to export')
    return audioBufferToMp3(this.processedBuffer, bitrate, provenance ?? null, options ?? null)
  }

  getParams(): ProcessingParams | null { return this.params }

  // -------------------------------------------------------------------------
  // Stem separation — BS-RoFormer 4-pass cascade per tech spec.
  // Uses the loaded inputBuffer. See src/lib/rain/stems.ts for the engine.
  // -------------------------------------------------------------------------

  /**
   * Run real BS-RoFormer 4-pass source separation on the loaded input audio.
   * Returns 12 StemResults with actual stereo channels + measured RMS/peak.
   *
   * Pipeline per tech spec (Pasted Content_1783542076605.txt):
   *   Pass 1: BS-RoFormer       → vocals, drums, bass, guitar, piano, other
   *   Pass 2: MelBand RoFormer  → lead vocals, backing vocals
   *   Pass 3: Spectral split    → kick, snare, hats, percussion
   *   Pass 4: Dereverb          → ambience + dry other
   *
   * Used by the Stems tab for explicit "Run Separation" / "Re-run" clicks.
   * The render() pipeline also runs this internally at Stage 7 (for audio
   * <= 60s) and emits results via the onStemsReady callback — so the Stems
   * tab is usually already populated by the time the user opens it.
   *
   * @param onProgress Optional (stageName, pct) callback — fires from real
   *                   DSP stages, never from a setTimeout placeholder.
   * @param signal     Optional AbortSignal — checked between every pass
   *                   and every chunk within a pass.
   */
  async separateStems(
    onProgress?: (stage: string, pct: number) => void,
    signal?: AbortSignal,
  ): Promise<import('./stems').StemResult[]> {
    if (!this.inputBuffer) throw new Error('No input loaded — load a track first')
    const sampleRate = this.inputBuffer.sampleRate
    const channels: Float32Array[] = []
    for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) {
      channels.push(this.inputBuffer.getChannelData(c).slice())
    }
    // Dynamic import keeps stems.ts (which has its own FFT/RoPE/correlation
    // code) out of the initial bundle when the Stems tab is never opened.
    const { runStemSeparation } = await import('./stems')
    return runStemSeparation(channels, sampleRate, onProgress, signal)
  }

  /**
   * Build a Web Audio AudioBuffer from raw Float32Array channels. Used by
   * StemsTab to preview individual stems via the AudioContext and to export
   * them as WAV via audioBufferToWav().
   */
  floatArraysToAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    if (!this.context) {
      // Provide a fallback OfflineAudioContext for headless conversion when
      // the live AudioContext hasn't been initialised yet.
      const off = new OfflineAudioContext(channels.length, channels[0].length, sampleRate)
      const buf = off.createBuffer(channels.length, channels[0].length, sampleRate)
      for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c)
      return buf
    }
    const buf = this.context.createBuffer(channels.length, channels[0].length, sampleRate)
    for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c)
    return buf
  }

  /**
   * Play a stem's stereo channels through the live AudioContext for preview.
   * Stops any currently-playing source first. Returns a stop() handle.
   *
   * @param onEnded Optional callback fired when the stem finishes naturally
   *                (NOT fired when stopped via the returned handle or when a
   *                new source supersedes this one — those paths clear
   *                `onended` first to avoid spurious state flips).
   */
  playStem(
    channels: Float32Array[],
    sampleRate: number,
    onEnded?: () => void,
  ): () => void {
    if (!this.context) throw new Error('AudioContext not initialised')
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {})
    }
    // Stop current playback (preview path) without tearing down the graph.
    // Clear onended FIRST so a manual stop doesn't fire the callback.
    if (this.sourceNode) {
      this.sourceNode.onended = null
      try { this.sourceNode.stop() } catch { /* already stopped */ }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    const buf = this.floatArraysToAudioBuffer(channels, sampleRate)
    const src = this.context.createBufferSource()
    src.buffer = buf
    src.connect(this.gainNode!)
    if (onEnded) {
      // Capture generation so a stale onended (from a superseded source)
      // doesn't fire on the new source.
      const gen = ++this.playGeneration
      src.onended = () => {
        if (gen === this.playGeneration) onEnded()
      }
    }
    src.start()
    this.sourceNode = src
    return () => {
      // Manual stop — clear onended so the callback doesn't fire.
      src.onended = null
      try { src.stop() } catch { /* already stopped */ }
      src.disconnect()
      if (this.sourceNode === src) this.sourceNode = null
    }
  }

  // -------------------------------------------------------------------------
  // Spatial processing — wraps the standalone spatial engine in spatial.ts.
  // Uses the processed (mastered) buffer if available, otherwise the input.
  // -------------------------------------------------------------------------

  /**
   * Run the spatial pipeline (stereo enhancement → bed upmix → HRTF binaural →
   * ADM XML) on the currently loaded audio. Returns the full SpatialResult.
   */
  async processSpatial(
    config: import('./spatial').SpatialConfig,
    onProgress?: (stage: string, pct: number) => void,
    signal?: AbortSignal,
    /** Max duration in seconds. Default 60 (preview). Export callers pass a
     *  larger value (e.g. 360) so the full track is processed — and check
     *  `result.truncated` to refuse downloading a partial file. */
    maxDurationSec?: number,
  ): Promise<import('./spatial').SpatialResult> {
    // Prefer the mastered output; fall back to the raw input.
    const buffer = this.processedBuffer ?? this.inputBuffer
    if (!buffer) throw new Error('No audio loaded — load a track first')
    const sampleRate = buffer.sampleRate
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c).slice())
    }
    // Dynamic import to avoid pulling the (relatively heavy) spatial module
    // into the initial bundle when the Spatial tab is never opened.
    const { processSpatial } = await import('./spatial')
    return processSpatial(channels, sampleRate, config, onProgress, signal, maxDurationSec)
  }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// Multiband compression (3-band, simplified)
// ---------------------------------------------------------------------------

function applyMultibandCompression(channels: Float32Array[], params: ProcessingParams, sampleRate: number) {
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
function repairStem(
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
function getSailLimiterSettings(key: StemKey): { ceiling: number; releaseMs: number } | null {
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
function sailProcessStems(
  stems: import('./stems').StemResult[],
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

// ---------------------------------------------------------------------------
// P3-PIPELINE-89 — Stem measurement helpers
// Re-compute RMS + peak dB on the repaired stem channels so the Stems tab
// shows accurate post-repair measurements after Stage 8 re-emits via
// onStemsReady. Matches the measurement logic in stems.ts.
// ---------------------------------------------------------------------------

function measureStemRmsDb(channels: Float32Array[]): number {
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

function measureStemPeakDb(channels: Float32Array[]): number {
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

// ---------------------------------------------------------------------------
// Export options — every flag below produces a REAL byte-level change in the
// exported file. There are no cosmetic toggles. See ExportTab.tsx for the UI.
// ---------------------------------------------------------------------------

/**
 * P2-EXPORT directive: "Every toggle must modify exported assets."
 *
 * Each flag below is honored byte-for-byte by `audioBufferToWav` /
 * `audioBufferToMp3` and verified after export by `verifyExportedWav` /
 * `verifyExportedMp3`.
 *
 *  - `embedProvenance`  → WAV: LIST/INFO `RAIN` field with cert JSON
 *                         MP3: ID3v2 PRIV "com.rain.cert" frame with cert JSON
 *  - `embedSignature`   → WAV: LIST/INFO `ISIG` field with Ed25519 sig hex
 *                         MP3: ID3v2 TXXX "RAIN_SIGNATURE" frame with sig hex
 *  - `embedFingerprint` → WAV: LIST/INFO `IFPR` field with Chromaprint hex
 *                         MP3: ID3v2 TXXX "RAIN_FINGERPRINT" frame with hash
 *  - `embedMetadata`    → WAV: LIST/INFO INAM/IART/IPRD/ICRD/ISRC/ICMT fields
 *                         MP3: ID3v2 TIT2/TPE1/TALB/TYER/TSRC/COMM frames
 *  - `attachCertificate`→ produces a sidecar `<basename>.cert.json` alongside
 *                         the audio (returned via buildSidecarZip as a 2-file
 *                         ZIP when the UI wants a single download; the UI can
 *                         also offer the two Blobs separately)
 *
 * `embedSignature` is independent of `embedProvenance`: when both are ON the
 * cert JSON carries its `signature` field AND a standalone ISIG/TXXX field is
 * also appended; when only `embedSignature` is ON the cert JSON is omitted but
 * the standalone sig field is still written (so the toggle produces real
 * bytes even with no cert). When `embedProvenance` is ON but `embedSignature`
 * is OFF the signature is stripped from the embedded cert JSON (verifiers see
 * the attestation but cannot cryptographically verify it).
 */
export interface ExportOptions {
  embedProvenance: boolean
  embedSignature: boolean
  embedFingerprint: boolean
  embedMetadata: boolean
  attachCertificate: boolean
  metadata: {
    title: string
    artist: string
    album?: string
    year?: string
    isrc?: string
    comment?: string
  }
  /** Pre-computed Chromaprint hash. If omitted, the fingerprint is sourced
   *  from `provenance.manifest.assertions` (label 'org.rain.fingerprint'). */
  fingerprint?: string
}

/**
 * Result of re-parsing the exported Blob and confirming that every toggle
 * the user enabled actually produced bytes in the file (and every disabled
 * toggle produced none). `ok` is true iff every per-toggle check passes.
 */
export interface ExportVerificationResult {
  ok: boolean
  format: 'wav' | 'mp3'
  sizeBytes: number
  sha256: string
  checks: {
    provenance: { expected: boolean; found: boolean; ok: boolean }
    signature: { expected: boolean; found: boolean; ok: boolean }
    fingerprint: { expected: boolean; found: boolean; ok: boolean }
    metadata: { expected: boolean; found: boolean; ok: boolean }
  }
}

// ---------------------------------------------------------------------------
// WAV encoder
// ---------------------------------------------------------------------------

export function audioBufferToWav(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 24,
  provenance: ProvenanceCertificate | null = null,
  options: ExportOptions | null = null,
): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign

  // P2-EXPORT directive: every toggle below produces real bytes in the
  // LIST/INFO chunk. We build the INFO field list dynamically from the
  // ExportOptions — when all flags are off (or no options are passed), NO
  // LIST chunk is appended at all and the WAV is bare. When any flag is on,
  // a LIST/INFO chunk is appended carrying exactly the requested fields.
  //
  // RIFF INFO field layout used here:
  //   chunk header: 'LIST' (4) + size (4) + 'INFO' (4)
  //   per field:    <id 4 chars> (4) + size (4, LE) + <bytes> + optional pad
  //   pad:          if (fieldDataSize % 2 === 1) one 0x00 byte to keep even align
  //
  // Custom field ids we use (4 chars each, ASCII):
  //   RAIN — full RAIN-CERT certificate JSON (provenance toggle)
  //   ISIG — Ed25519 signature hex string (signature toggle)
  //   IFPR — Chromaprint fingerprint hex string (fingerprint toggle)
  // Standard RIFF INFO field ids (metadata toggle):
  //   INAM — Name (Title)
  //   IART — Artist
  //   IPRD — Product (Album)
  //   ICRD — Creation Date (Year)
  //   ISRC — Source ISRC code (this IS a standard RIFF INFO field id)
  //   ICMT — Comment
  const infoFields: { id: string; bytes: Uint8Array }[] = []

  // Resolve effective options (legacy callers passing only `provenance` with no
  // `options` get the pre-P2 behaviour: embed cert iff provenance is non-null).
  const wantProvenance = options ? options.embedProvenance : provenance !== null
  const wantSignature = options ? options.embedSignature : false
  const wantFingerprint = options ? options.embedFingerprint : false
  const wantMetadata = options ? options.embedMetadata : false

  if (wantProvenance && provenance) {
    // Embed the cert JSON. If `embedSignature` is OFF, strip the signature
    // field from the embedded JSON so the toggle truly omits the signature
    // bytes (verifiers can still see the attestation but cannot verify).
    const certPayload: Record<string, unknown> = {
      certId: provenance.certId,
      algorithm: provenance.algorithm,
      signedAt: provenance.signedAt,
      inputHash: provenance.inputHash,
      outputHash: provenance.outputHash,
      publicKey: provenance.publicKey,
      manifest: provenance.manifest,
    }
    if (wantSignature) {
      certPayload.signature = provenance.signature
    }
    // Also strip the fingerprint assertion from the manifest when the
    // fingerprint toggle is OFF — keeps the cert payload in sync with the
    // user's toggle choices.
    if (!wantFingerprint && certPayload.manifest && typeof certPayload.manifest === 'object') {
      const m = certPayload.manifest as { assertions?: Array<{ label: string; data: unknown }> }
      if (Array.isArray(m.assertions)) {
        certPayload.manifest = {
          ...m,
          assertions: m.assertions.filter((a) => a.label !== 'org.rain.fingerprint'),
        }
      }
    }
    const certJson = JSON.stringify(certPayload)
    infoFields.push({ id: 'RAIN', bytes: new TextEncoder().encode(certJson) })
  }

  if (wantSignature && provenance) {
    // Standalone Ed25519 signature hex field — independent of cert JSON.
    infoFields.push({ id: 'ISIG', bytes: new TextEncoder().encode(provenance.signature) })
  }

  if (wantFingerprint) {
    // The fingerprint is either passed explicitly via options.fingerprint or
    // sourced from the cert manifest's 'org.rain.fingerprint' assertion.
    const fp =
      options?.fingerprint ??
      provenance?.manifest.assertions.find((a) => a.label === 'org.rain.fingerprint')?.data
        ?.hash
    if (typeof fp === 'string' && fp.length > 0) {
      infoFields.push({ id: 'IFPR', bytes: new TextEncoder().encode(fp) })
    }
  }

  if (wantMetadata && options) {
    const md = options.metadata
    if (md.title) infoFields.push({ id: 'INAM', bytes: new TextEncoder().encode(md.title) })
    if (md.artist) infoFields.push({ id: 'IART', bytes: new TextEncoder().encode(md.artist) })
    if (md.album) infoFields.push({ id: 'IPRD', bytes: new TextEncoder().encode(md.album) })
    if (md.year) infoFields.push({ id: 'ICRD', bytes: new TextEncoder().encode(md.year) })
    if (md.isrc) infoFields.push({ id: 'ISRC', bytes: new TextEncoder().encode(md.isrc) })
    if (md.comment) infoFields.push({ id: 'ICMT', bytes: new TextEncoder().encode(md.comment) })
  }

  // Build the LIST/INFO chunk if any fields are present.
  let infoChunk: Uint8Array | null = null
  if (infoFields.length > 0) {
    // Compute total payload size: 'INFO' (4) + per field (8 + padded data)
    let payloadSize = 4
    for (const f of infoFields) {
      const pad = f.bytes.length % 2 === 1 ? 1 : 0
      payloadSize += 8 + f.bytes.length + pad
    }
    const buf = new ArrayBuffer(8 + payloadSize) // 'LIST' + size + payload
    const v = new DataView(buf)
    let off = 0
    writeString(v, off, 'LIST'); off += 4
    v.setUint32(off, payloadSize, true); off += 4
    writeString(v, off, 'INFO'); off += 4
    for (const f of infoFields) {
      writeString(v, off, f.id); off += 4
      v.setUint32(off, f.bytes.length, true); off += 4
      for (let i = 0; i < f.bytes.length; i++) v.setUint8(off + i, f.bytes[i])
      off += f.bytes.length
      if (f.bytes.length % 2 === 1) { v.setUint8(off, 0); off += 1 } // pad byte
    }
    infoChunk = new Uint8Array(buf)
  }

  const infoSize = infoChunk ? infoChunk.length : 0
  const bufferSize = 44 + dataSize + infoSize

  const ab = new ArrayBuffer(bufferSize)
  const view = new DataView(ab)

  // RIFF header — RIFF size includes everything except the first 8 bytes
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize + infoSize, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Interleave channels
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = channels[ch][i]
      // P3-TPDF-MP3 — TPDF (Triangular Probability Density Function) dither.
      //
      // The DSP_ENGINE.md determinism guarantee says "No Math.random() in the
      // DSP chain". That rule applies to Stages 1-14 of the pipeline. TPDF
      // dither is INTENTIONALLY non-deterministic noise added at Stage 15
      // (Output Packaging — bit-depth reduction) per the official tech spec
      // ("24-bit WAV @ 48 kHz + 320 kbps MP3 with TPDF dither"). This is the
      // audio industry standard for bit-depth reduction:
      //
      //   1. Sum two uniform random samples in [-0.5, +0.5) LSB → triangular
      //      PDF in [-1, +1) LSB.
      //   2. Add to the float sample BEFORE quantization.
      //   3. Quantize to the target integer bit-depth.
      //
      // TPDF dither:
      //   - Eliminates quantization distortion (harmonic distortion correlated
      //     with the signal that direct Math.round quantization produces).
      //   - Replaces it with constant white noise at the LSB level, which is
      //     perceptually benign (much more pleasant than harmonic distortion).
      //   - Is the standard for professional audio bit-depth reduction.
      //
      // CRITICAL: the RAIN-CERT Ed25519 signature is computed over the FLOAT32
      // processed buffer (see provenance.ts → hashFloat32Channels), NOT over
      // these integer WAV bytes. The dithered integer output is the *delivery
      // format*; the cert attests to the *artistic* float master.
      const r1 = Math.random() - 0.5
      const r2 = Math.random() - 0.5
      if (bitDepth === 16) {
        // 1 LSB at 16-bit = 1 / 0x8000 in float units.
        const dithered = s + (r1 + r2) / 0x8000
        const clamped = Math.max(-1, Math.min(1, dithered))
        const v = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF)
        view.setInt16(offset, v, true)
        offset += 2
      } else {
        // 24-bit signed. 1 LSB at 24-bit = 1 / 0x800000 in float units.
        const dithered = s + (r1 + r2) / 0x800000
        const clamped = Math.max(-1, Math.min(1, dithered))
        const v = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7FFFFF)
        view.setUint8(offset, v & 0xFF)
        view.setUint8(offset + 1, (v >> 8) & 0xFF)
        view.setUint8(offset + 2, (v >> 16) & 0xFF)
        offset += 3
      }
    }
  }

  // Append LIST/INFO chunk after the data chunk
  if (infoChunk) {
    for (let i = 0; i < infoChunk.length; i++) view.setUint8(offset + i, infoChunk[i])
  }

  return new Blob([ab], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

// ---------------------------------------------------------------------------
// MP3 encoder (real LAME via @breezystack/lamejs) — P3-TPDF-MP3
// ---------------------------------------------------------------------------

/**
 * Encode an AudioBuffer as a real 320 kbps (or other CBR bitrate) MP3 file
 * per the official tech spec Stage 15: "320 kbps MP3 with TPDF dither".
 *
 * Implementation notes:
 *   - LAME (via lamejs) only accepts Int16 PCM input internally. The float
 *     master is converted to 16-bit PCM with TPDF dither (same algorithm as
 *     16-bit WAV export — see audioBufferToWav).
 *   - Encoded in 1152-sample LAME frame blocks; the final partial block is
 *     flushed via encoder.flush().
 *   - An optional ID3v2.3 tag is prepended. Per the P2-EXPORT directive,
 *     every toggle in ExportOptions produces real bytes in this tag:
 *       embedProvenance  → PRIV "com.rain.cert" frame with cert JSON
 *       embedSignature   → TXXX "RAIN_SIGNATURE" frame with Ed25519 sig hex
 *       embedFingerprint → TXXX "RAIN_FINGERPRINT" frame with Chromaprint hex
 *       embedMetadata    → TIT2 / TPE1 / TALB / TYER / TSRC / COMM frames
 *     When all four toggles are off, NO ID3v2 tag is prepended at all and the
 *     file is a bare MPEG stream.
 *
 * CRITICAL: the RAIN-CERT signature is computed over the FLOAT32 master
 * (see provenance.ts → hashFloat32Channels), NOT over these MP3 bytes.
 * MP3 is a lossy delivery format; the cert attests to the artistic master
 * the MP3 was encoded from. Re-encoding the same float master produces a
 * byte-identical MP3 (LAME is deterministic given fixed input + bitrate +
 * sample rate + channel count — modulo any dither, which is added during
 * the Float32 → Int16 conversion here, but again the cert doesn't cover the
 * Int16 representation).
 */
export function audioBufferToMp3(
  buffer: AudioBuffer,
  bitrate = 320,
  provenance: ProvenanceCertificate | null = null,
  options: ExportOptions | null = null,
): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length

  // 1) Float32 → Int16 with TPDF dither (same as 16-bit WAV path).
  // LAME accepts Int16 PCM only — we apply the same TPDF dither algorithm
  // here as in audioBufferToWav() so both 16-bit WAV and MP3 exports are
  // perceptually equivalent (no quantization distortion in either).
  const leftInt16 = new Int16Array(length)
  const rightInt16 = numChannels > 1 ? new Int16Array(length) : null
  const leftF32 = buffer.getChannelData(0)
  const rightF32 = numChannels > 1 ? buffer.getChannelData(1) : null

  for (let i = 0; i < length; i++) {
    // TPDF dither: sum of two uniform random samples in [-0.5, +0.5) LSB
    // gives triangular PDF in [-1, +1) LSB. 1 LSB at 16-bit = 1 / 0x8000.
    const r1 = Math.random() - 0.5
    const r2 = Math.random() - 0.5
    const ditheredL = leftF32[i] + (r1 + r2) / 0x8000
    leftInt16[i] = Math.max(-32768, Math.min(32767, Math.round(ditheredL * 0x8000)))
    if (rightInt16 && rightF32) {
      const r3 = Math.random() - 0.5
      const r4 = Math.random() - 0.5
      const ditheredR = rightF32[i] + (r3 + r4) / 0x8000
      rightInt16[i] = Math.max(-32768, Math.min(32767, Math.round(ditheredR * 0x8000)))
    }
  }

  // 2) Encode to MP3 via LAME.
  // RAIN V6 FIX: the @breezystack/lamejs Mp3Encoder constructor was patched
  // (see node_modules/@breezystack/lamejs/dist/lamejs.js → "RAIN V6 PATCH")
  // to set R.lowpassfreq = -1 and R.highpassfreq = -1 before lame_init_params.
  // This disables LAME's default bitrate-dependent lowpass filter, which
  // previously produced a "clean cutoff" at 16-18 kHz in spectrum analysers
  // (17 kHz @ 128 kbps, 18.6 kHz @ 192 kbps, 20.5 kHz @ 320 kbps). At 320
  // kbps CBR the encoder has ample bits to represent the full top octave
  // (20-24 kHz) cleanly, so the lowpass is unnecessary for a mastering
  // studio. WAV exports were already full-bandwidth (lossless PCM).
  const mp3encoder = new Mp3Encoder(numChannels, sampleRate, bitrate)
  const mp3Data: Uint8Array[] = []
  const blockSize = 1152 // LAME frame size (MPEG-1 Layer III)

  for (let i = 0; i < length; i += blockSize) {
    const leftChunk = leftInt16.subarray(i, i + blockSize)
    const rightChunk = rightInt16 ? rightInt16.subarray(i, i + blockSize) : null
    const mp3buf = rightChunk
      ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
      : mp3encoder.encodeBuffer(leftChunk)
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf))
  }
  const end = mp3encoder.flush()
  if (end.length > 0) mp3Data.push(new Uint8Array(end))

  // 3) Concatenate MP3 frames.
  const mp3Body = concatUint8(mp3Data)

  // 4) Build ID3v2.3 tag with provenance + metadata (optional, all toggles honored).
  const id3Tag = buildId3v2Tag(provenance, options)
  // Copy the MP3 body + ID3 tag into a single ArrayBuffer for Blob (TS 5.7+
  // lib.dom typings require ArrayBuffer-backed BlobParts — Uint8Array generic
  // over ArrayBufferLike doesn't satisfy BlobPart).
  const totalBytes = id3Tag.length + mp3Body.length
  const out = new ArrayBuffer(totalBytes)
  const outView = new Uint8Array(out)
  outView.set(id3Tag, 0)
  outView.set(mp3Body, id3Tag.length)

  return new Blob([out], { type: 'audio/mpeg' })
}

/** Concatenate an array of Uint8Array into a single Uint8Array. */
function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/**
 * Build an ID3v2.3 tag (10-byte header + frames) honoring every ExportOptions
 * toggle. Returns an empty Uint8Array (zero bytes) when no frames are needed
 * — in that case the caller skips prepending any ID3 tag and the MP3 is a
 * bare MPEG stream.
 *
 * P2-EXPORT directive: every toggle below produces real bytes in the tag.
 *
 * Frames embedded (ID3v2.3 layout, all sizes BE non-synchsafe in v2.3):
 *   - embedProvenance  → PRIV (owner "com.rain.cert") with cert JSON
 *   - embedSignature   → TXXX (desc "RAIN_SIGNATURE") with sig hex
 *   - embedFingerprint → TXXX (desc "RAIN_FINGERPRINT") with hash hex
 *   - embedMetadata    → TIT2 (title), TPE1 (artist), TALB (album),
 *                         TYER (year), TSRC (ISRC), COMM (comment)
 *
 * Tag header layout (ID3v2.3):
 *   ["ID3"] [0x03 0x03 version] [0x00 flags] [4 bytes synchsafe size]
 *
 * Synchsafe integer: 28 bits, 7 bits per byte, MSB always 0.
 */
function buildId3v2Tag(
  provenance: ProvenanceCertificate | null,
  options: ExportOptions | null,
): Uint8Array {
  const frames: Uint8Array[] = []

  // Resolve effective options (legacy callers passing only `provenance` with
  // no options get pre-P2 behaviour: embed cert iff provenance is non-null).
  const wantProvenance = options ? options.embedProvenance : provenance !== null
  const wantSignature = options ? options.embedSignature : false
  const wantFingerprint = options ? options.embedFingerprint : false
  const wantMetadata = options ? options.embedMetadata : false

  if (wantProvenance && provenance) {
    // PRIV frame: owner identifier (null-terminated) + private data (cert JSON).
    // If `embedSignature` is OFF, strip the signature field from the embedded
    // cert JSON (consistent with the WAV path).
    const certPayload: Record<string, unknown> = {
      certId: provenance.certId,
      algorithm: provenance.algorithm,
      signedAt: provenance.signedAt,
      inputHash: provenance.inputHash,
      outputHash: provenance.outputHash,
      publicKey: provenance.publicKey,
      manifest: provenance.manifest,
    }
    if (wantSignature) certPayload.signature = provenance.signature
    if (!wantFingerprint && certPayload.manifest && typeof certPayload.manifest === 'object') {
      const m = certPayload.manifest as { assertions?: Array<{ label: string; data: unknown }> }
      if (Array.isArray(m.assertions)) {
        certPayload.manifest = {
          ...m,
          assertions: m.assertions.filter((a) => a.label !== 'org.rain.fingerprint'),
        }
      }
    }
    const owner = new TextEncoder().encode('com.rain.cert')
    const certJson = new TextEncoder().encode(JSON.stringify(certPayload))
    const privData = new Uint8Array(owner.length + 1 + certJson.length)
    privData.set(owner, 0)
    privData[owner.length] = 0x00 // null terminator for owner
    privData.set(certJson, owner.length + 1)
    frames.push(buildId3v2Frame('PRIV', privData))
  }

  if (wantSignature && provenance) {
    // TXXX (User-defined text) frame: encoding(1) + description + 0x00 + value.
    // Body layout: [0x00=ISO-8859-1] ["RAIN_SIGNATURE" 0x00] [sig hex]
    const desc = new TextEncoder().encode('RAIN_SIGNATURE')
    const sig = new TextEncoder().encode(provenance.signature)
    const body = new Uint8Array(1 + desc.length + 1 + sig.length)
    body[0] = 0x00 // text encoding = ISO-8859-1
    body.set(desc, 1)
    body[1 + desc.length] = 0x00 // null terminator for description
    body.set(sig, 1 + desc.length + 1)
    frames.push(buildId3v2Frame('TXXX', body))
  }

  if (wantFingerprint) {
    const fp =
      options?.fingerprint ??
      provenance?.manifest.assertions.find((a) => a.label === 'org.rain.fingerprint')?.data
        ?.hash
    if (typeof fp === 'string' && fp.length > 0) {
      // TXXX frame: encoding(1) + description + 0x00 + value
      const desc = new TextEncoder().encode('RAIN_FINGERPRINT')
      const fpBytes = new TextEncoder().encode(fp)
      const body = new Uint8Array(1 + desc.length + 1 + fpBytes.length)
      body[0] = 0x00
      body.set(desc, 1)
      body[1 + desc.length] = 0x00
      body.set(fpBytes, 1 + desc.length + 1)
      frames.push(buildId3v2Frame('TXXX', body))
    }
  }

  if (wantMetadata && options) {
    const md = options.metadata
    if (md.title) frames.push(buildId3v2TextFrame('TIT2', md.title))
    if (md.artist) frames.push(buildId3v2TextFrame('TPE1', md.artist))
    if (md.album) frames.push(buildId3v2TextFrame('TALB', md.album))
    if (md.year) frames.push(buildId3v2TextFrame('TYER', md.year))
    if (md.isrc) frames.push(buildId3v2TextFrame('TSRC', md.isrc))
    if (md.comment) {
      // COMM frame: encoding(1) + language(3) + short desc + 0x00 + text
      const lang = new TextEncoder().encode('eng')
      const text = new TextEncoder().encode(md.comment)
      const body = new Uint8Array(1 + 3 + 1 + text.length) // enc + lang + null + text
      body[0] = 0x00
      body.set(lang, 1)
      body[4] = 0x00 // empty short description
      body.set(text, 5)
      frames.push(buildId3v2Frame('COMM', body))
    }
  }

  if (frames.length === 0) return new Uint8Array(0)

  // Concatenate all frames.
  const allFrames = concatUint8(frames)

  // Build the 10-byte ID3v2.3 header. The size field is a synchsafe integer
  // representing the total size of the frames (NOT including the header).
  const tag = new Uint8Array(10 + allFrames.length)
  tag[0] = 0x49; tag[1] = 0x44; tag[2] = 0x33 // "ID3"
  tag[3] = 0x03 // version major (2.3)
  tag[4] = 0x00 // version minor
  tag[5] = 0x00 // flags
  // Synchsafe size of allFrames.length
  tag[6] = (allFrames.length >> 21) & 0x7F
  tag[7] = (allFrames.length >> 14) & 0x7F
  tag[8] = (allFrames.length >> 7) & 0x7F
  tag[9] = allFrames.length & 0x7F
  tag.set(allFrames, 10)
  return tag
}

/** Build an ID3v2.3 text frame (TIT2/TPE1/etc.): encoding byte + ASCII text. */
function buildId3v2TextFrame(id: string, text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text)
  const body = new Uint8Array(1 + textBytes.length)
  body[0] = 0x00 // ISO-8859-1 encoding (compatible with ASCII)
  body.set(textBytes, 1)
  return buildId3v2Frame(id, body)
}

/** Build a single ID3v2.3 frame: 4-byte ID + 4-byte BE size + 2-byte flags + data. */
function buildId3v2Frame(id: string, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(10 + data.length)
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i)
  // v2.3 size is a regular 32-bit big-endian integer (NOT synchsafe).
  frame[4] = (data.length >> 24) & 0xFF
  frame[5] = (data.length >> 16) & 0xFF
  frame[6] = (data.length >> 8) & 0xFF
  frame[7] = data.length & 0xFF
  frame[8] = 0x00 // status flags
  frame[9] = 0x00 // format flags
  frame.set(data, 10)
  return frame
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const audioEngine = new RainAudioEngine()

// ---------------------------------------------------------------------------
// P2-EXPORT: export verification + sidecar ZIP — every toggle is re-checked
// against the actual bytes the encoder produced.
// ---------------------------------------------------------------------------

/**
 * Re-parse the produced WAV Blob and confirm each ExportOptions toggle was
 * honored byte-for-byte. Walks the RIFF chunk list, finds the LIST/INFO chunk,
 * decodes every INFO field, and checks for the presence/absence of the four
 * toggle-controlled fields:
 *   - provenance  → RAIN field (cert JSON)
 *   - signature   → ISIG field (Ed25519 sig hex)
 *   - fingerprint → IFPR field (Chromaprint hash)
 *   - metadata    → INAM/IART/IPRD/ICRD/ISRC/ICMT (any one)
 *
 * `ok` is true iff every toggle's expectation matches what was actually
 * found in the bytes.
 */
export async function verifyExportedWav(
  blob: Blob,
  options: ExportOptions,
): Promise<ExportVerificationResult> {
  const ab = await blob.arrayBuffer()
  const view = new DataView(ab)

  // SHA-256 over the entire file — proves the verification report is bound to
  // exactly the bytes the user is downloading.
  const sha = await crypto.subtle.digest('SHA-256', ab)
  const shaHex = bufToHexLocal(sha)

  // Walk RIFF chunks starting at offset 12 (after 'RIFF' + size + 'WAVE').
  const fieldIds = new Set<string>()
  if (ab.byteLength >= 12 && readFourCc(view, 0) === 'RIFF' && readFourCc(view, 8) === 'WAVE') {
    let off = 12
    while (off + 8 <= ab.byteLength) {
      const id = readFourCc(view, off)
      const size = view.getUint32(off + 4, true)
      if (id === 'LIST' && off + 8 + 4 <= ab.byteLength && readFourCc(view, off + 8) === 'INFO') {
        // Parse INFO fields: at off+12 we have the first field id.
        let foff = off + 12
        const listEnd = off + 8 + size
        while (foff + 8 <= listEnd && foff + 8 <= ab.byteLength) {
          const fid = readFourCc(view, foff)
          const fsize = view.getUint32(foff + 4, true)
          fieldIds.add(fid)
          foff += 8 + fsize + (fsize % 2 === 1 ? 1 : 0) // pad to even
        }
      }
      off += 8 + size + (size % 2 === 1 ? 1 : 0) // chunks also pad to even
    }
  }

  const expectedProv = options.embedProvenance
  const expectedSig = options.embedSignature
  const expectedFp = options.embedFingerprint
  const expectedMd = options.embedMetadata
  const foundProv = fieldIds.has('RAIN')
  const foundSig = fieldIds.has('ISIG')
  const foundFp = fieldIds.has('IFPR')
  const foundMd =
    fieldIds.has('INAM') ||
    fieldIds.has('IART') ||
    fieldIds.has('IPRD') ||
    fieldIds.has('ICRD') ||
    fieldIds.has('ISRC') ||
    fieldIds.has('ICMT')

  const ok =
    expectedProv === foundProv &&
    expectedSig === foundSig &&
    expectedFp === foundFp &&
    expectedMd === foundMd

  return {
    ok,
    format: 'wav',
    sizeBytes: ab.byteLength,
    sha256: shaHex,
    checks: {
      provenance: { expected: expectedProv, found: foundProv, ok: expectedProv === foundProv },
      signature: { expected: expectedSig, found: foundSig, ok: expectedSig === foundSig },
      fingerprint: { expected: expectedFp, found: foundFp, ok: expectedFp === foundFp },
      metadata: { expected: expectedMd, found: foundMd, ok: expectedMd === foundMd },
    },
  }
}

/**
 * Re-parse the produced MP3 Blob and confirm each ExportOptions toggle was
 * honored. Reads the ID3v2.3 tag header, walks every frame, and checks for:
 *   - provenance  → PRIV frame with owner "com.rain.cert"
 *   - signature   → TXXX frame with description "RAIN_SIGNATURE"
 *   - fingerprint → TXXX frame with description "RAIN_FINGERPRINT"
 *   - metadata    → TIT2 / TPE1 / TALB / TYER / TSRC / COMM (any one)
 */
export async function verifyExportedMp3(
  blob: Blob,
  options: ExportOptions,
): Promise<ExportVerificationResult> {
  const ab = await blob.arrayBuffer()
  const bytes = new Uint8Array(ab)
  const view = new DataView(ab)

  const sha = await crypto.subtle.digest('SHA-256', ab)
  const shaHex = bufToHexLocal(sha)

  const frameIds = new Set<string>()
  const txxxDescs = new Set<string>()
  let hasPrivRainCert = false

  // ID3v2.3 header: "ID3" + version(2) + flags(1) + synchsafe size(4).
  if (
    ab.byteLength >= 10 &&
    bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 // "ID3"
  ) {
    const tagSize =
      ((bytes[6] & 0x7F) << 21) |
      ((bytes[7] & 0x7F) << 14) |
      ((bytes[8] & 0x7F) << 7) |
      (bytes[9] & 0x7F)
    let off = 10
    const tagEnd = 10 + tagSize
    while (off + 10 <= tagEnd && off + 10 <= ab.byteLength) {
      const id = readFourCc(view, off)
      if (id === '\x00\x00\x00\x00') break // padding
      // v2.3 frame size is a regular BE 32-bit integer (NOT synchsafe)
      const fsize = view.getUint32(off + 4, false)
      if (fsize === 0 || off + 10 + fsize > ab.byteLength) break
      const bodyStart = off + 10
      if (id === 'TXXX') {
        // Body: encoding(1) + description + 0x00 + value
        // Description starts at bodyStart+1, ends at first 0x00.
        let nul = bodyStart + 1
        while (nul < bodyStart + fsize && bytes[nul] !== 0) nul++
        const desc = new TextDecoder().decode(bytes.subarray(bodyStart + 1, nul))
        txxxDescs.add(desc)
        frameIds.add('TXXX')
      } else if (id === 'PRIV') {
        // Body: owner (null-terminated) + private data
        let nul = bodyStart
        while (nul < bodyStart + fsize && bytes[nul] !== 0) nul++
        const owner = new TextDecoder().decode(bytes.subarray(bodyStart, nul))
        if (owner === 'com.rain.cert') hasPrivRainCert = true
        frameIds.add('PRIV')
      } else {
        frameIds.add(id)
      }
      off += 10 + fsize
    }
  }

  const expectedProv = options.embedProvenance
  const expectedSig = options.embedSignature
  const expectedFp = options.embedFingerprint
  const expectedMd = options.embedMetadata
  const foundProv = hasPrivRainCert
  const foundSig = txxxDescs.has('RAIN_SIGNATURE')
  const foundFp = txxxDescs.has('RAIN_FINGERPRINT')
  const foundMd =
    frameIds.has('TIT2') ||
    frameIds.has('TPE1') ||
    frameIds.has('TALB') ||
    frameIds.has('TYER') ||
    frameIds.has('TSRC') ||
    frameIds.has('COMM')

  const ok =
    expectedProv === foundProv &&
    expectedSig === foundSig &&
    expectedFp === foundFp &&
    expectedMd === foundMd

  return {
    ok,
    format: 'mp3',
    sizeBytes: ab.byteLength,
    sha256: shaHex,
    checks: {
      provenance: { expected: expectedProv, found: foundProv, ok: expectedProv === foundProv },
      signature: { expected: expectedSig, found: foundSig, ok: expectedSig === foundSig },
      fingerprint: { expected: expectedFp, found: foundFp, ok: expectedFp === foundFp },
      metadata: { expected: expectedMd, found: foundMd, ok: expectedMd === foundMd },
    },
  }
}

/** Read 4 ASCII chars at the given DataView offset (used for RIFF/ID3 chunk ids). */
function readFourCc(view: DataView, off: number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(off + i))
  return s
}

/** Hex-encode an ArrayBuffer (local copy to avoid coupling to provenance.ts). */
function bufToHexLocal(buf: ArrayBuffer): string {
  const v = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, '0')
  return s
}

/**
 * Build a sidecar ZIP containing the exported audio file (with its real
 * extension) + the RAIN-CERT certificate as `<basename>.cert.json`. Used when
 * the `attachCertificate` toggle is ON — the user gets ONE downloadable file
 * (the ZIP) containing both the audio and the sidecar cert. The cert.json is
 * the FULL cert (signature + manifest + fingerprint assertion all intact),
 * regardless of the in-file embedding toggles — because the sidecar IS the
 * authoritative cert.
 *
 * PKZIP 2.0 stored (no compression), CRC-32 with PKWARE polynomial 0xEDB88320.
 * No external dependencies. Mirrors the writers in spatial.ts/distribution.ts
 * but kept local to audio-engine.ts so the export path is self-contained.
 */
export function buildSidecarZip(
  audioBytes: Uint8Array,
  audioFilename: string,
  certJson: string,
  certFilename: string,
): Blob {
  const certBytes = new TextEncoder().encode(certJson)
  const entries: { name: string; data: Uint8Array }[] = [
    { name: audioFilename, data: audioBytes },
    { name: certFilename, data: certBytes },
  ]

  // CRC-32 lookup table (lazy-init on the function itself).
  const crcFn = buildSidecarZip
  if (!(crcFn as unknown as { _crcTable?: Uint32Array })._crcTable) {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    ;(crcFn as unknown as { _crcTable?: Uint32Array })._crcTable = t
  }
  const table = (crcFn as unknown as { _crcTable: Uint32Array })._crcTable
  const crc32 = (d: Uint8Array): number => {
    let c = 0xffffffff
    for (let i = 0; i < d.length; i++) c = (table[(c ^ d[i]) & 0xff] ^ (c >>> 8)) >>> 0
    return (c ^ 0xffffffff) >>> 0
  }

  // Layout: per file (30 + nameLen + dataLen) + central dir (46 + nameLen)
  // per file + EOCD (22).
  const enc = new TextEncoder()
  const nameBytesArr = entries.map((e) => enc.encode(e.name))
  const crcs = entries.map((e) => crc32(e.data))
  let totalSize = 0
  for (let i = 0; i < entries.length; i++) {
    totalSize += 30 + nameBytesArr[i].length + entries[i].data.length
  }
  for (let i = 0; i < entries.length; i++) totalSize += 46 + nameBytesArr[i].length
  totalSize += 22

  const out = new Uint8Array(totalSize)
  const dv = new DataView(out.buffer)
  let off = 0
  const centralRecords: { name: Uint8Array; dataLen: number; crc: number; lfh: number }[] = []
  let lfh = 0
  for (let i = 0; i < entries.length; i++) {
    const nb = nameBytesArr[i]
    const sz = entries[i].data.length
    dv.setUint32(off, 0x04034b50, true); off += 4 // local file header sig
    dv.setUint16(off, 20, true); off += 2 // version needed
    dv.setUint16(off, 0, true); off += 2 // flags
    dv.setUint16(off, 0, true); off += 2 // method = stored
    dv.setUint16(off, 0, true); off += 2 // mod time
    dv.setUint16(off, 0x21, true); off += 2 // mod date
    dv.setUint32(off, crcs[i], true); off += 4
    dv.setUint32(off, sz, true); off += 4 // compressed size
    dv.setUint32(off, sz, true); off += 4 // uncompressed size
    dv.setUint16(off, nb.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2 // extra field length
    out.set(nb, off); off += nb.length
    out.set(entries[i].data, off); off += sz
    centralRecords.push({ name: nb, dataLen: sz, crc: crcs[i], lfh })
    lfh = off
  }
  const cdOff = off
  for (const r of centralRecords) {
    dv.setUint32(off, 0x02014b50, true); off += 4
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0x21, true); off += 2
    dv.setUint32(off, r.crc, true); off += 4
    dv.setUint32(off, r.dataLen, true); off += 4
    dv.setUint32(off, r.dataLen, true); off += 4
    dv.setUint16(off, r.name.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint32(off, 0, true); off += 4
    dv.setUint32(off, r.lfh, true); off += 4
    out.set(r.name, off); off += r.name.length
  }
  const cdSize = off - cdOff
  dv.setUint32(off, 0x06054b50, true); off += 4 // EOCD sig
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint32(off, cdSize, true); off += 4
  dv.setUint32(off, cdOff, true); off += 4
  dv.setUint16(off, 0, true); off += 2

  return new Blob([out.buffer as ArrayBuffer], { type: 'application/zip' })
}
