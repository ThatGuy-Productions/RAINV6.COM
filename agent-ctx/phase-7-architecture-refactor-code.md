# Phase 7 — Architecture Refactor for RAIN V6 Audio Engine

## Task ID
phase-7-architecture-refactor

## Agent
code

## Summary
Successfully modularised `src/lib/rain/audio-engine.ts` (2,740 lines) into a directory structure with 10 files under `src/lib/rain/audio-engine/`, without changing any DSP algorithms, business logic, or function signatures.

## File Structure Created

```
src/lib/rain/audio-engine/
├── index.ts       — barrel re-export (re-exports all public API)
├── types.ts       — shared types/interfaces (AudioEngineState, EngineTelemetry, ExportOptions, ExportVerificationResult, Listener)
├── analysis.ts    — audio analysis/measurement functions (measureStemRmsDb, measureStemPeakDb)
├── dynamics.ts    — dynamics processing (applyMultibandCompression, compressBand, repairStem)
├── filters.ts     — filter configuration constants (GENRE_TILT, REF_BANDS, THIRD_OCTAVE_Q)
├── loudness.ts    — LUFS targeting function (applyLoudnessTargeting)
├── limiting.ts    — SAIL v2 limiter functions (getSailLimiterSettings, sailProcessStems)
├── export.ts      — WAV/MP3 encoding, verification, sidecar ZIP (audioBufferToWav, audioBufferToMp3, verifyExportedWav, verifyExportedMp3, buildSidecarZip + internal helpers)
├── utilities.ts   — helper functions (sleep)
└── engine.ts      — RainAudioEngine class + singleton (audioEngine)
```

## Original File
`src/lib/rain/audio-engine.ts` → replaced with barrel re-export: `export * from './audio-engine/index'`

## Key Decisions
1. **Standalone functions extracted as-is**: `measureStemRmsDb`, `measureStemPeakDb`, `applyMultibandCompression`, `compressBand`, `repairStem`, `getSailLimiterSettings`, `sailProcessStems`, `audioBufferToWav`, `audioBufferToMp3`, `buildSidecarZip`, `verifyExportedWav`, `verifyExportedMp3`, `sleep` — all moved to their logical modules without any algorithm changes.

2. **Constants extracted from inline render code**: `GENRE_TILT`, `REF_BANDS`, `THIRD_OCTAVE_Q` were previously defined inline in the render method's Stage 5 block. Now they're module-level constants in `filters.ts`, imported by `engine.ts`.

3. **Loudness targeting extracted**: The Stage 11 loudness targeting code (make-up gain to reach target LUFS) was extracted from inline render code into `applyLoudnessTargeting()` in `loudness.ts`. The algorithm is identical — just structural refactoring.

4. **Public API preserved**: All 10 exports from the original file are re-exported through the barrel chain:
   - `audioEngine` (singleton)
   - `audioBufferToWav`, `audioBufferToMp3` (export functions)
   - `verifyExportedWav`, `verifyExportedMp3`, `buildSidecarZip` (verification/packaging)
   - `AudioEngineState`, `EngineTelemetry`, `ExportOptions`, `ExportVerificationResult` (types)

5. **`'use client'` directive**: Maintained on the original `audio-engine.ts` barrel and on `engine.ts` (which uses `window.AudioContext`, `requestAnimationFrame`, etc.).

## Verification
- `bun run lint` — 0 errors (15 pre-existing warnings unrelated to this refactor)
- Dev server compiles successfully
- All 20+ consumer files that import from `@/lib/rain/audio-engine` continue to work unchanged
