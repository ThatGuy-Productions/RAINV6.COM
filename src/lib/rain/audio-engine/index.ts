/**
 * RAIN V6 — Audio Engine Module
 *
 * Barrel re-export for the modularised audio-engine directory.
 * All public exports from the original audio-engine.ts are re-exported here
 * so that `import { ... } from '@/lib/rain/audio-engine'` continues to work
 * unchanged.
 *
 * Module layout (Phase 7 architecture refactor):
 *   types.ts      — shared types and interfaces
 *   analysis.ts   — audio analysis / measurement functions
 *   dynamics.ts   — dynamics processing (multiband comp, per-stem repair)
 *   filters.ts    — filter configuration (genre tilt, reference bands)
 *   loudness.ts   — LUFS targeting / loudness normalization
 *   limiting.ts   — SAIL v2 limiter functions
 *   export.ts     — WAV/MP3 encoding, verification, sidecar ZIP
 *   utilities.ts  — helper functions and constants
 *   engine.ts     — RainAudioEngine class + singleton
 */

// Types
export type { AudioEngineState, EngineTelemetry, ExportOptions, ExportVerificationResult, Listener } from './types'

// Engine singleton
export { audioEngine } from './engine'

// Export functions
export { audioBufferToWav, audioBufferToMp3, verifyExportedWav, verifyExportedMp3, buildSidecarZip } from './export'
