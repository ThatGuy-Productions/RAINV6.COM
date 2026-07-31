/**
 * RAIN V6 — Heuristic params generator
 * Mirrors backend/app/services/heuristic_params.py and the frontend's
 * heuristic-params.ts from the original Vite SPA.
 *
 * Re-exports generateHeuristicParams from dsp.ts (single source of truth).
 */

export { generateHeuristicParams, applyMacrosToParams } from './dsp'
