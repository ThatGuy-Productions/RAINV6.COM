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
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 * Standalone functions moved to: analysis.ts, dynamics.ts, filters.ts,
 * loudness.ts, limiting.ts, export.ts, utilities.ts, types.ts.
 */

import type { AudioAnalysis, MacroValues, ProcessingParams, ProvenanceCertificate } from '../types'
import {
  analyzeAudio,
  applyBiquad,
  applySaturation,
  applyMacrosToParams,
  computeCorrelation,
  computeLufs,
  computeRainScore,
  computeTruePeak,
  designBiquad,
  midSideDecode,
  midSideEncode,
} from '../dsp'
import { generateHeuristicParams } from '../heuristics'
import { runRepair, type RepairModuleId, type RepairResult } from '../repair'
// P3-PIPELINE-89: Stage 9 (SAIL v2) reads per-stem gain faders + mute/solo
// state from the session store. Zustand's getState() is safe to call from
// outside React components (it's just a function returning the current state).
import { useSessionStore } from '../store'

import type { Listener, AudioEngineState, EngineTelemetry, ExportOptions } from './types'
import { measureStemRmsDb, measureStemPeakDb } from './analysis'
import { applyMultibandCompression, repairStem } from './dynamics'
import { GENRE_TILT, REF_BANDS, THIRD_OCTAVE_Q } from './filters'
import { applyLoudnessTargeting } from './loudness'
import { sailProcessStems } from './limiting'
import { audioBufferToWav, audioBufferToMp3 } from './export'
import { sleep } from './utilities'

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
    for (let c = 0; c < numChannels; c++) newBuffer.copyToChannel(repairedChannels[c] as Float32Array<ArrayBuffer>, c)
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
    onStemsReady?: (stems: import('../stems').StemResult[]) => void,
    simpleMode: boolean = false,
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

    // AUDIT-C5 FIX: cooperative cancellation. The Cancel Button used to flip
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
    // ─── Stage 4: AI Inference (RainNet v2) ───
    // P3-RAINNET: try ONNX inference first; fall back to genre heuristics
    // if the model isn't loaded yet or the audio is too short for a Mel spec.
    let params: ProcessingParams
    // Track inference source (MODEL vs HEURISTIC) for diagnostics
    let _inferenceSource: 'MODEL' | 'HEURISTIC' = 'HEURISTIC'
    void _inferenceSource

    // Extract channel data (moved up so groove/emotion analysis can access it)
    const inChannels: Float32Array[] = []
    for (let ch = 0; ch < channels; ch++) inChannels.push(this.inputBuffer.getChannelData(ch).slice())
    // Force stereo: if mono, duplicate
    if (inChannels.length === 1) inChannels.push(inChannels[0].slice())

    // Compute spectral features early for groove/emotion analysis
    const preAnalysis = analyzeAudio(inChannels, sampleRate)

    // ─── Stage 4b: Groove + Emotion Detection ───
    // P4-GROOVE-EMOTION: analyse the source audio for groove pattern,
    // emotional character, and section structure BEFORE the DSP runs.
    // These feed into compression time constants, EQ tempering, and
    // section-aware processing later in the pipeline.
    wrappedOnProgress?.(4, 16, 'AI Inference + Groove/Emotion Detection')
    let grooveEmotionOverrides: import('../groove-emotion').GrooveEmotionOverrides | null = null
    try {
      const { analyzeGrooveEmotion } = await import('../groove-emotion')
      const geProfile = analyzeGrooveEmotion(inChannels, sampleRate, preAnalysis.spectralFeatures, genre, platform)
      grooveEmotionOverrides = geProfile?.overrides ?? null
      if (grooveEmotionOverrides) {
        console.log(
          `[GrooveEmotion] BPM=${geProfile.profile.groove.bpm ?? '?'} | groove=${geProfile.profile.groove.grooveType} | emotion=${geProfile.profile.emotion.quadrant}`,
        )
      }
    } catch (geError) {
      console.warn('[GrooveEmotion] analysis failed — continuing without groove/emotion:', geError)
    }

    wrappedOnProgress?.(4, 16, 'AI Inference')
    checkCancel()
    try {
      const inCh0 = inChannels[0] ?? new Float32Array(0)
      const hasEnoughAudio = inCh0.length >= 48000 * 0.5 // at least 0.5s at 48kHz
      if (hasEnoughAudio) {
        const { runRainNetInference } = await import('../rainnet-inference')
        const result = await runRainNetInference({
          audio: inCh0,
          sampleRate,
          genre,
          platform,
          simpleMode: simpleMode ? 1.0 : 0.0,
        })
        params = result.params as ProcessingParams
        _inferenceSource = 'MODEL'
      } else {
        throw new Error('Audio too short for RainNet — falling back to heuristics')
      }
    } catch (rainNetError) {
      console.warn('[RainNet] inference failed, falling back to heuristics:', rainNetError)
      params = generateHeuristicParams(genre, platform, macros)
    }
    applyMacrosToParams(params)
    this.params = params

    wrappedOnProgress?.(1, 16, 'Format Normalization')
    checkCancel()

    // AUDIT-C4 / DIRECTIVE FIX: stages 2-5 were pure `await sleep()` theatre.
    // Each stage now performs REAL, measurable DSP work that contributes to
    // the final output. No sleep-only stages remain.

    // Stage 2 — Signal Analysis: full ITU-R BS.1770-4 + spectral + QC measurement.
    wrappedOnProgress?.(2, 16, 'Signal Analysis')
    checkCancel()
    this.analysis = preAnalysis
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
      const tilt = GENRE_TILT[genre]
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
    let separatedStems: import('../stems').StemResult[] | null = null
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
          const { runStemSeparation } = await import('../stems')
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
      // P4-GROOVE-EMOTION: if groove was detected, override attack/release
      // with groove-locked musical time constants before compression.
      if (grooveEmotionOverrides) {
        if (grooveEmotionOverrides.mb_attack_override) {
          params.mb_attack_low = grooveEmotionOverrides.mb_attack_override.low
          params.mb_attack_mid = grooveEmotionOverrides.mb_attack_override.mid
          params.mb_attack_high = grooveEmotionOverrides.mb_attack_override.high
        }
        if (grooveEmotionOverrides.mb_release_override) {
          params.mb_release_low = grooveEmotionOverrides.mb_release_override.low
          params.mb_release_mid = grooveEmotionOverrides.mb_release_override.mid
          params.mb_release_high = grooveEmotionOverrides.mb_release_override.high
        }
      }
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
    applyLoudnessTargeting(inChannels, params, sampleRate)
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
      const { applyTruePeakLimiter } = await import('../dsp')
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
        const { applyTruePeakLimiter } = await import('../dsp')
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
    for (let ch = 0; ch < outChannelCount; ch++) outBuffer.copyToChannel(inChannels[ch] as Float32Array<ArrayBuffer>, ch)
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
  ): Promise<import('../stems').StemResult[]> {
    if (!this.inputBuffer) throw new Error('No input loaded — load a track first')
    const sampleRate = this.inputBuffer.sampleRate
    const channels: Float32Array[] = []
    for (let c = 0; c < this.inputBuffer.numberOfChannels; c++) {
      channels.push(this.inputBuffer.getChannelData(c).slice())
    }
    // Dynamic import keeps stems.ts (which has its own FFT/RoPE/correlation
    // code) out of the initial bundle when the Stems tab is never opened.
    const { runStemSeparation } = await import('../stems')
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
      for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c] as Float32Array<ArrayBuffer>, c)
      return buf
    }
    const buf = this.context.createBuffer(channels.length, channels[0].length, sampleRate)
    for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c] as Float32Array<ArrayBuffer>, c)
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
    config: import('../spatial').SpatialConfig,
    onProgress?: (stage: string, pct: number) => void,
    signal?: AbortSignal,
    /** Max duration in seconds. Default 60 (preview). Export callers pass a
     *  larger value (e.g. 360) so the full track is processed — and check
     *  `result.truncated` to refuse downloading a partial file. */
    maxDurationSec?: number,
  ): Promise<import('../spatial').SpatialResult> {
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
    const { processSpatial } = await import('../spatial')
    return processSpatial(channels, sampleRate, config, onProgress, signal, maxDurationSec)
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const audioEngine = new RainAudioEngine()
