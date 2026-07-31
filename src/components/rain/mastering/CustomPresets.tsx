'use client'

/**
 * RAIN V6 — Custom Presets Panel
 *
 * Lists user-saved macro snapshots (persisted in localStorage via
 * `@/lib/rain/presets`). Users can save the current macro state under a
 * custom name, load it back with one click, and delete presets they no
 * longer need.
 *
 * Design language mirrors `GenrePresets`: dark `rain-panel` surface, lime
 * accent, mono labels, mini 7-bar SVG chart, framer-motion entrance
 * stagger. The active preset (whose macros exactly match the current
 * session) is highlighted with a check icon and `border-rain-accent`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, Check, Plus, Save, Trash2, X } from 'lucide-react'
import { MACROS } from '@/lib/rain/constants'
import { useSessionStore } from '@/lib/rain/store'
import { notifyInfo, notifySuccess } from '@/lib/rain/notifications'
import {
  deleteCustomPreset,
  loadCustomPresets,
  saveCustomPreset,
  STORAGE_KEY,
  type CustomPreset,
} from '@/lib/rain/presets'
import type { MacroKey, MacroValues } from '@/lib/rain/types'

// ---------------------------------------------------------------------------
// Macro display metadata (matches GenrePresets convention)
// ---------------------------------------------------------------------------

const MACRO_KEYS: MacroKey[] = [
  'brighten',
  'glue',
  'width',
  'punch',
  'warmth',
  'space',
  'repair',
]

const MACRO_COLORS: Record<MacroKey, string> = MACROS.reduce((acc, m) => {
  acc[m.key] = m.color
  return acc
}, {} as Record<MacroKey, string>)

// ---------------------------------------------------------------------------
// Mini 7-bar SVG chart (adapted from GenrePresets' MiniMacroChart)
// ---------------------------------------------------------------------------

function MiniMacroChart({
  macros,
  barWidth = 2.5,
  barGap = 1,
  height = 14,
}: {
  macros: MacroValues
  barWidth?: number
  barGap?: number
  height?: number
}) {
  const maxVal = 10
  const width = MACRO_KEYS.length * (barWidth + barGap) - barGap
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="flex-shrink-0"
      aria-hidden="true"
    >
      {MACRO_KEYS.map((key, i) => {
        const val = macros[key]
        const barH = Math.max(1, (val / maxVal) * (height - 2))
        const x = i * (barWidth + barGap)
        const y = height - barH - 1
        return (
          <rect
            key={key}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            rx={0.75}
            fill={MACRO_COLORS[key]}
            opacity={0.5 + (val / maxVal) * 0.5}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Relative time formatter — "just now", "5m ago", "2d ago", "3w ago", "2mo ago"
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}

// ---------------------------------------------------------------------------
// Active state — all 7 macro values match within 0.01 tolerance
// ---------------------------------------------------------------------------

function isPresetActive(current: MacroValues, candidate: MacroValues): boolean {
  return MACRO_KEYS.every((k) => Math.abs(current[k] - candidate[k]) < 0.01)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CustomPresets() {
  const macros = useSessionStore((s) => s.macros)
  const genre = useSessionStore((s) => s.genre)
  const platform = useSessionStore((s) => s.platform)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setGenre = useSessionStore((s) => s.setGenre)
  const setPlatform = useSessionStore((s) => s.setPlatform)
  const setMacroSource = useSessionStore((s) => s.setMacroSource)

  // Lazy initializer — reads from localStorage on the client, returns `[]`
  // during SSR. The panel only mounts after a user clicks "Mine" (a post-
  // hydration interaction), so there is no hydration mismatch concern.
  const [presets, setPresets] = useState<CustomPreset[]>(() => {
    if (typeof window === 'undefined') return []
    return loadCustomPresets()
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draftName, setDraftName] = useState('')

  // Re-sync from localStorage — called after mutations (add/delete) and when
  // a cross-tab `storage` event modifies the same key.
  const refresh = useCallback(() => {
    setPresets(loadCustomPresets())
  }, [])

  // Stay in sync if another tab/window edits the same presets store.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])

  const activePresetId = useMemo(() => {
    for (const p of presets) {
      if (isPresetActive(macros, p.macros)) return p.id
    }
    return null
  }, [macros, presets])

  const handleStartAdd = () => {
    setDraftName('')
    setIsAdding(true)
  }

  const handleCancelAdd = () => {
    setIsAdding(false)
    setDraftName('')
  }

  const handleConfirmAdd = () => {
    const created = saveCustomPreset(draftName, macros, genre, platform)
    refresh()
    setIsAdding(false)
    setDraftName('')
    notifySuccess('Preset saved', `"${created.name}" added to My Presets`)
  }

  const handleLoad = (preset: CustomPreset) => {
    setMacros(preset.macros)
    setGenre(preset.genre)
    setPlatform(preset.platform)
    setMacroSource('HEURISTIC', 100)
    notifyInfo('Preset loaded', preset.name)
  }

  const handleDelete = (preset: CustomPreset) => {
    const ok =
      typeof window !== 'undefined'
        ? window.confirm(`Delete preset "${preset.name}"? This cannot be undone.`)
        : true
    if (!ok) return
    deleteCustomPreset(preset.id)
    refresh()
  }

  return (
    <div className="rain-panel rounded-lg p-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <Bookmark className="w-3.5 h-3.5 text-rain-accent flex-shrink-0" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            My Presets
          </span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-rain-border bg-rain-surface-2 text-foreground/70 tabular-nums"
            aria-label={`${presets.length} saved preset${presets.length === 1 ? '' : 's'}`}
          >
            {presets.length}
          </span>
        </div>

        {/* Add button / inline form */}
        <AnimatePresence mode="wait" initial={false}>
          {!isAdding ? (
            <motion.button
              key="add"
              onClick={handleStartAdd}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 text-[10px] font-mono uppercase tracking-wider text-foreground/80 hover:border-rain-accent/50 hover:text-rain-accent transition-colors"
              aria-label="Save current macro state as a preset"
            >
              <Plus className="w-3 h-3" />
              Add current
            </motion.button>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-1 overflow-hidden"
            >
              <label htmlFor="preset-name-input" className="sr-only">Preset name</label>
              <input
                id="preset-name-input"
                autoFocus
                type="text"
                value={draftName}
                maxLength={32}
                placeholder="Preset name…"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleConfirmAdd()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    handleCancelAdd()
                  }
                }}
                className="w-32 px-2 py-1 rounded-md border border-rain-border bg-rain-surface-3 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-rain-accent/60 focus:ring-1 focus:ring-rain-accent/30 transition-colors"
                aria-label="Preset name"
              />
              <button
                onClick={handleConfirmAdd}
                aria-label="Save preset"
                className="flex items-center justify-center w-7 h-7 rounded-md bg-rain-accent text-black hover:scale-105 active:scale-95 transition-transform"
              >
                <Save className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancelAdd}
                aria-label="Cancel"
                className="flex items-center justify-center w-7 h-7 rounded-md border border-rain-border bg-rain-surface-2 text-foreground/70 hover:border-red-400/50 hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Body — preset grid or empty state */}
      {presets.length === 0 ? (
        <div className="rounded-md border border-dashed border-rain-border bg-rain-surface-2/40 px-4 py-6 text-center">
          <Bookmark className="w-5 h-5 mx-auto text-muted-foreground/40 mb-2" />
          <div className="text-[11px] font-mono text-muted-foreground">
            No custom presets yet — click &lsquo;Add current&rsquo; to save your macro state
          </div>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rain-scrollbar pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AnimatePresence initial={false}>
              {presets.map((preset, i) => {
                const isActive = activePresetId === preset.id
                return (
                  <motion.div
                    key={preset.id}
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="relative"
                  >
                    <button
                      onClick={() => handleLoad(preset)}
                      className={`
                        w-full text-left rounded-md border-l-2 bg-rain-surface-2/70 border border-rain-border/60
                        px-2.5 py-2 transition-colors hover:bg-rain-surface-3 hover:border-rain-accent/40
                        ${isActive ? 'border-rain-accent shadow-[0_0_10px_rgba(170,255,0,0.18)]' : ''}
                      `}
                      style={{ borderLeftColor: preset.color }}
                      aria-label={`Load preset ${preset.name}`}
                    >
                      {/* Top row: name + active check */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            background: preset.color,
                            boxShadow: `0 0 6px ${preset.color}80`,
                          }}
                        />
                        <span
                          className="text-[11px] font-mono font-semibold truncate flex-1"
                          title={preset.name}
                        >
                          {preset.name}
                        </span>
                        {isActive && (
                          <Check className="w-3 h-3 text-rain-accent flex-shrink-0" />
                        )}
                      </div>

                      {/* Bottom row: relative date + mini chart + genre/platform */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-muted-foreground/70 tabular-nums whitespace-nowrap">
                          {formatRelativeTime(preset.createdAt)}
                        </span>
                        <MiniMacroChart macros={preset.macros} />
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[9px] font-mono text-muted-foreground/60 truncate">
                        <span className="capitalize">{preset.genre}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">
                          {preset.platform.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </button>

                    {/* Delete button — top-right corner */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(preset)
                      }}
                      aria-label={`Delete preset ${preset.name}`}
                      className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded border border-transparent text-muted-foreground/50 hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
