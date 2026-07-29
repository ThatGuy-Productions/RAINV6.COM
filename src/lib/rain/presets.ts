/**
 * RAIN V6 — Custom Preset Persistence
 *
 * Manages user-saved macro snapshots in localStorage. Each preset captures the
 * full 7-macro state plus the active genre and platform so it can be restored
 * verbatim. Pure module — no React, no side effects on import — safe to call
 * from server components (all access guarded by `typeof window`).
 *
 * Storage layout (localStorage key `rain-v6-custom-presets`):
 *   JSON-encoded array of `CustomPreset`, newest first.
 *
 * Capacity: MAX_PRESETS (24). When exceeded, the oldest entries are dropped.
 */

import type { MacroValues } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CustomPreset {
  /** Unique id (timestamp-based, prefixed for readability). */
  id: string
  /** User-given name (1–32 chars, trimmed). */
  name: string
  /** Snapshot of the 7 macro values at save time. */
  macros: MacroValues
  /** Genre slug active when saved (e.g. 'pop', 'rock'). */
  genre: string
  /** Platform slug active when saved (e.g. 'spotify'). */
  platform: string
  /** Unix timestamp (ms) when created. */
  createdAt: number
  /** Hex color assigned from the cycling palette. */
  color: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'rain-v6-custom-presets'
export const MAX_PRESETS = 24

/** Color palette cycled when assigning colors to new presets. */
export const COLOR_PALETTE = [
  '#AAFF00',
  '#8B5CF6',
  '#00D4FF',
  '#F97316',
  '#D946EF',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
] as const

const FALLBACK_NAME = 'Untitled Preset'
const MAX_NAME_LEN = 32

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function sanitizeName(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return FALLBACK_NAME
  return trimmed.length > MAX_NAME_LEN ? trimmed.slice(0, MAX_NAME_LEN) : trimmed
}

function nextColor(count: number): string {
  return COLOR_PALETTE[count % COLOR_PALETTE.length] ?? COLOR_PALETTE[0]
}

function persist(presets: CustomPreset[]): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // Quota / serialization issues — fail silently. UI still reflects in-memory list.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all custom presets from localStorage. Returns `[]` on any error, on
 * SSR, or when no presets are stored. Newest first.
 */
export function loadCustomPresets(): CustomPreset[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive: validate shape, drop malformed entries.
    const cleaned: CustomPreset[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (
        typeof e.id !== 'string' ||
        typeof e.name !== 'string' ||
        typeof e.createdAt !== 'number' ||
        typeof e.genre !== 'string' ||
        typeof e.platform !== 'string' ||
        typeof e.color !== 'string' ||
        !e.macros ||
        typeof e.macros !== 'object'
      ) {
        continue
      }
      cleaned.push(e as unknown as CustomPreset)
    }
    // Ensure newest-first ordering.
    cleaned.sort((a, b) => b.createdAt - a.createdAt)
    return cleaned
  } catch {
    return []
  }
}

/**
 * Create and persist a new preset from the current macro state. The preset is
 * inserted at the top of the list; if capacity is exceeded the oldest entries
 * are dropped. Returns the newly created preset.
 */
export function saveCustomPreset(
  name: string,
  macros: MacroValues,
  genre: string,
  platform: string,
): CustomPreset {
  const existing = loadCustomPresets()
  const color = nextColor(existing.length)
  const now = Date.now()
  const preset: CustomPreset = {
    id: `cp-${now}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: sanitizeName(name),
    macros: { ...macros },
    genre,
    platform,
    createdAt: now,
    color,
  }
  const updated = [preset, ...existing].slice(0, MAX_PRESETS)
  persist(updated)
  return preset
}

/**
 * Delete a preset by id. No-op if the id is not found.
 */
export function deleteCustomPreset(id: string): void {
  const existing = loadCustomPresets()
  if (existing.length === 0) return
  const updated = existing.filter((p) => p.id !== id)
  if (updated.length === existing.length) return
  persist(updated)
}

/**
 * Rename a preset by id. The new name is sanitized (trimmed + clamped). No-op
 * if the id is not found.
 */
export function renameCustomPreset(id: string, newName: string): void {
  const existing = loadCustomPresets()
  const idx = existing.findIndex((p) => p.id === id)
  if (idx === -1) return
  existing[idx] = { ...existing[idx], name: sanitizeName(newName) }
  persist(existing)
}
