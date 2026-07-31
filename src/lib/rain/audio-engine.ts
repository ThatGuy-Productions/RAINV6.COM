'use client'

/**
 * RAIN V6 — Web Audio Engine (barrel re-export)
 *
 * Phase 7 architecture refactor: the original monolithic audio-engine.ts
 * has been split into logical modules under ./audio-engine/. This file
 * re-exports everything so that existing imports from
 * `@/lib/rain/audio-engine` continue to work unchanged.
 *
 * Module layout:
 *   audio-engine/types.ts      — shared types and interfaces
 *   audio-engine/analysis.ts   — audio analysis / measurement functions
 *   audio-engine/dynamics.ts   — dynamics processing (multiband comp, per-stem repair)
 *   audio-engine/filters.ts    — filter configuration (genre tilt, reference bands)
 *   audio-engine/loudness.ts   — LUFS targeting / loudness normalization
 *   audio-engine/limiting.ts   — SAIL v2 limiter functions
 *   audio-engine/export.ts     — WAV/MP3 encoding, verification, sidecar ZIP
 *   audio-engine/utilities.ts  — helper functions and constants
 *   audio-engine/engine.ts     — RainAudioEngine class + singleton
 *   audio-engine/index.ts      — barrel re-export
 */

export * from './audio-engine/index'
