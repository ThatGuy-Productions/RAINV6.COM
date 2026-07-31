/**
 * RAIN V6 — Utility Functions
 *
 * Helper functions and constants used across the audio engine module.
 *
 * Extracted from audio-engine.ts during Phase 7 architecture refactor.
 */

/**
 * Yield to the event loop for a given number of milliseconds.
 * Used by the render pipeline to allow UI progress paint between stages.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms))
}
