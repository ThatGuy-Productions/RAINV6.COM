'use client'

/**
 * RAIN V6 — A/B Snapshot Bar
 *
 * Session-only scratchpad slots (A / B / C / D) for fast macro comparison
 * while tweaking. Each slot can hold a captured macro state (macros +
 * genre + platform + timestamp) and be re-loaded with one click.
 *
 * Distinct from `macroHistory` (linear undo/redo) and from `CustomPreset`
 * (which persists across sessions via localStorage). Snapshots live in the
 * Zustand store only and are wiped on `reset()`.
 *
 * Design language mirrors `GenrePresets` / `CustomPresets`: dark rain-panel
 * surface, lime accent, mono labels, mini 7-bar SVG chart, framer-motion
 * entrance + layout animations. The active snapshot (whose macros exactly
 * match the current session) is highlighted with a pulsing border in the
 * slot's color and a lime "ACTIVE" pill; non-matching snapshots show an
 * orange "MODIFIED" pill with the count of changed macros.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, CircleDot, Eraser, Play, Trash2 } from 'lucide-react'
import { MACROS } from '@/lib/rain/constants'
import { useSessionStore, type MacroSnapshot } from '@/lib/rain/store'
import { notifyError, notifyInfo } from '@/lib/rain/notifications'
import type { MacroKey, MacroValues } from '@/lib/rain/types'

// ---------------------------------------------------------------------------
// Slot palette — rotating colors for A / B / C / D
// ---------------------------------------------------------------------------

const SLOT_LABELS = ['A', 'B', 'C', 'D'] as const
const SLOT_COLORS = ['#AAFF00', '#8B5CF6', '#00D4FF', '#F97316'] as const

// ---------------------------------------------------------------------------
// Macro display metadata (matches GenrePresets / CustomPresets convention)
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
// Mini 7-bar SVG chart (same pattern as GenrePresets' MiniMacroChart)
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
// Relative time formatter per spec:
//   "just now" (<10s) | "Xs ago" (<60s) | "Xm ago" (<60m) | "Xh ago" (<24h)
//   | "Xd ago" (otherwise)
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

// ---------------------------------------------------------------------------
// Snapshot comparison helpers (0.01 tolerance, matches preset conventions)
// ---------------------------------------------------------------------------

function isSnapshotActive(current: MacroValues, candidate: MacroValues): boolean {
  return MACRO_KEYS.every((k) => Math.abs(current[k] - candidate[k]) < 0.01)
}

function countChangedMacros(current: MacroValues, candidate: MacroValues): number {
  return MACRO_KEYS.reduce(
    (n, k) => (Math.abs(current[k] - candidate[k]) >= 0.01 ? n + 1 : n),
    0,
  )
}

// ---------------------------------------------------------------------------
// Small icon button used in the hover toolbar
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  color?: string
  danger?: boolean
}

function ToolbarButton({ icon: Icon, label, onClick, disabled, color, danger }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`
        flex items-center justify-center w-5 h-5 rounded border transition-colors
        ${disabled
          ? 'border-rain-border/40 bg-rain-surface-3/80 text-muted-foreground/30 cursor-not-allowed'
          : danger
            ? 'border-rain-border bg-rain-surface-3/80 text-foreground/70 hover:text-red-400 hover:border-red-400/50 hover:bg-red-500/10'
            : 'border-rain-border bg-rain-surface-3/80 text-foreground/70 hover:border-rain-accent/50 hover:text-rain-accent hover:bg-rain-accent/10'
        }
      `}
      style={color && !disabled && !danger ? { color } : undefined}
    >
      <Icon className="w-3 h-3" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Single snapshot slot card
// ---------------------------------------------------------------------------

interface SnapshotSlotProps {
  index: number
  label: string
  color: string
  snapshot: MacroSnapshot | null
  isActive: boolean
  changedCount: number
  onCapture: () => void
  onLoad: () => void
  onClear: () => void
}

function SnapshotSlot({
  index,
  label,
  color,
  snapshot,
  isActive,
  changedCount,
  onCapture,
  onLoad,
  onClear,
}: SnapshotSlotProps) {
  const populated = snapshot !== null
  // Primary click: populated → load, empty → capture.
  const handlePrimary = () => {
    if (populated) onLoad()
    else onCapture()
  }

  // Card border color: active slot uses slot color (pulsing), populated
  // non-active uses a dimmed slot color, empty uses default border.
  const borderStyle = isActive
    ? { borderColor: color }
    : populated
      ? { borderColor: `${color}55` }
      : undefined

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className="relative group"
    >
      <motion.button
        type="button"
        onClick={handlePrimary}
        whileTap={{ scale: 0.97 }}
        className={`
          w-full text-left rounded-md border bg-rain-surface-2/70
          px-2.5 py-2 transition-colors
          ${isActive ? '' : 'hover:bg-rain-surface-3 hover:border-rain-accent/40'}
        `}
        style={borderStyle}
        aria-label={populated ? `Load snapshot ${label}` : `Capture into snapshot ${label}`}
        animate={
          isActive
            ? {
                boxShadow: [
                  `0 0 0px ${color}`,
                  `0 0 12px ${color}90`,
                  `0 0 0px ${color}`,
                ],
              }
            : { boxShadow: '0 0 0px transparent' }
        }
        transition={
          isActive
            ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.2 }
        }
      >
        {/* Top row: circle label + status pill */}
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-mono font-bold flex-shrink-0"
              style={{
                color: populated ? '#0A0B0E' : color,
                background: populated ? color : `${color}15`,
                border: `1px solid ${color}`,
              }}
            >
              {label}
            </div>
            {populated && isActive && (
              <span
                className="text-[8px] font-mono font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                style={{
                  color: '#AAFF00',
                  background: 'rgba(170,255,0,0.12)',
                  border: '1px solid rgba(170,255,0,0.35)',
                }}
              >
                ACTIVE
              </span>
            )}
            {populated && !isActive && (
              <span
                className="text-[8px] font-mono font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                style={{
                  color: '#F97316',
                  background: 'rgba(249,115,22,0.12)',
                  border: '1px solid rgba(249,115,22,0.35)',
                }}
              >
                {changedCount} CHANGED
              </span>
            )}
          </div>
        </div>

        {/* Body: empty placeholder or chart + meta */}
        {populated ? (
          <>
            <div className="flex items-center justify-between gap-1.5">
              <MiniMacroChart macros={snapshot.macros} />
            </div>
            <div className="mt-1 text-[9px] font-mono text-muted-foreground/70 tabular-nums">
              Captured {formatRelativeTime(snapshot.capturedAt)}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[9px] font-mono text-muted-foreground/60 truncate">
              <span className="capitalize">{snapshot.genre}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{snapshot.platform.replace(/_/g, ' ')}</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-[44px] gap-0.5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/40">
              Empty
            </div>
            <div className="text-[8px] font-mono text-muted-foreground/30">
              Click to capture
            </div>
          </div>
        )}
      </motion.button>

      {/* Hover toolbar — top-right corner, slides in on hover */}
      <div
        className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        aria-hidden={false}
      >
        <ToolbarButton
          icon={Camera}
          label={`Capture into snapshot ${label}`}
          onClick={onCapture}
          color={color}
        />
        <ToolbarButton
          icon={Play}
          label={`Load snapshot ${label}`}
          onClick={onLoad}
          disabled={!populated}
          color={color}
        />
        <ToolbarButton
          icon={Trash2}
          label={`Clear snapshot ${label}`}
          onClick={onClear}
          disabled={!populated}
          danger
        />
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Main SnapshotBar component
// ---------------------------------------------------------------------------

export function SnapshotBar() {
  const snapshots = useSessionStore((s) => s.snapshots)
  const macros = useSessionStore((s) => s.macros)
  const captureSnapshot = useSessionStore((s) => s.captureSnapshot)
  const loadSnapshot = useSessionStore((s) => s.loadSnapshot)
  const clearSnapshot = useSessionStore((s) => s.clearSnapshot)
  const clearAllSnapshots = useSessionStore((s) => s.clearAllSnapshots)

  // Re-render every 30s so relative timestamps ("Captured 2m ago") stay
  // fresh without user interaction. Cleanup on unmount.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) & 0xffff), 30_000)
    return () => clearInterval(id)
  }, [])

  const hasAny = snapshots.some((s) => s !== null)

  const handleCapture = (i: number) => {
    captureSnapshot(i)
    notifyInfo('Snapshot captured', `${SLOT_LABELS[i]} slot saved`)
  }
  const handleLoad = (i: number) => {
    const ok = loadSnapshot(i)
    if (!ok) {
      notifyError('Slot empty', 'Capture a snapshot first')
      return
    }
    notifyInfo('Snapshot loaded', `${SLOT_LABELS[i]} applied`)
  }
  const handleClear = (i: number) => {
    clearSnapshot(i)
    notifyInfo('Snapshot cleared', `${SLOT_LABELS[i]} slot emptied`)
  }
  const handleClearAll = () => {
    clearAllSnapshots()
    notifyInfo('All snapshots cleared')
  }

  return (
    <div className="rain-panel rounded-lg p-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <CircleDot className="w-3.5 h-3.5 text-rain-accent flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              A/B Snapshots
            </div>
            <div className="text-[9px] font-mono text-muted-foreground/60 truncate">
              Capture up to 4 macro states for instant comparison
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={!hasAny}
          className="flex items-center gap-1 px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 text-[10px] font-mono uppercase tracking-wider text-foreground/80 hover:border-red-400/50 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-rain-border disabled:hover:text-foreground/80 flex-shrink-0"
          aria-label="Clear all snapshots"
        >
          <Eraser className="w-3 h-3" />
          Clear All
        </button>
      </div>

      {/* 4-column grid (2 cols on small screens) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SLOT_LABELS.map((label, i) => {
          const snap = snapshots[i] ?? null
          const color = SLOT_COLORS[i]
          const isActive = snap ? isSnapshotActive(macros, snap.macros) : false
          const changedCount = snap ? countChangedMacros(macros, snap.macros) : 0
          return (
            <SnapshotSlot
              key={label}
              index={i}
              label={label}
              color={color}
              snapshot={snap}
              isActive={isActive}
              changedCount={changedCount}
              onCapture={() => handleCapture(i)}
              onLoad={() => handleLoad(i)}
              onClear={() => handleClear(i)}
            />
          )
        })}
      </div>
    </div>
  )
}
