/**
 * RAIN V6 — Audio Engine Types
 *
 * Shared types and interfaces for the audio engine module.
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

export type Listener = (state: AudioEngineState) => void

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
