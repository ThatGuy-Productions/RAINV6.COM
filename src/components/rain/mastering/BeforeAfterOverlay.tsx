'use client'

import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import type { AudioAnalysis } from '@/lib/rain/types'

interface BeforeAfterOverlayProps {
  open: boolean
  onClose: () => void
}

interface MetricRowProps {
  label: string
  beforeVal: string
  afterVal: string
  delta: string
  improved: boolean | null // null = neutral
  unit: string
}

function MetricRow({ label, beforeVal, afterVal, delta, improved, unit }: MetricRowProps) {
  const deltaColor = improved === true
    ? '#AAFF00'  // lime — improved
    : improved === false
      ? '#F97316'  // orange — worse
      : '#64748B'  // neutral

  const deltaSign = delta.startsWith('-') ? '−' : delta.startsWith('+') ? '+' : ''

  return (
    <div className="flex items-center py-2.5 border-b border-white/5 last:border-b-0">
      {/* Label */}
      <div className="w-20 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex-shrink-0">
        {label}
      </div>

      {/* Before value */}
      <div className="flex-1 text-right pr-4">
        <span className="font-mono text-sm font-bold tabular-nums text-foreground/70">
          {beforeVal}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground/50 ml-1">{unit}</span>
      </div>

      {/* Delta arrow */}
      <div className="w-16 flex-shrink-0 flex items-center justify-center">
        <div
          className="text-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded-full"
          style={{
            color: deltaColor,
            backgroundColor: `${deltaColor}15`,
            border: `1px solid ${deltaColor}30`,
          }}
        >
          {deltaSign}{delta.replace(/^[+-]/, '')}
        </div>
      </div>

      {/* After value */}
      <div className="flex-1 text-left pl-4">
        <span className="font-mono text-sm font-bold tabular-nums" style={{ color: improved === true ? '#AAFF00' : improved === false ? '#F97316' : 'inherit' }}>
          {afterVal}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground/50 ml-1">{unit}</span>
      </div>
    </div>
  )
}

function formatLufs(v: number): string { return v.toFixed(1) }
function formatDb(v: number): string { return v.toFixed(1) }
function formatDr(v: number): string { return v.toFixed(1) }

/**
 * Determine if a delta is "improved" for a given metric.
 * - LUFS: closer to target is better (we use a rough heuristic: lower absolute deviation from -14)
 * - TruePeak: lower is better (less clipping risk)
 * - RMS: context-dependent, neutral
 * - DR: higher is better (more dynamic range)
 */
function computeMetrics(input: AudioAnalysis, output: AudioAnalysis, targetLufs: number) {
  const metrics: MetricRowProps[] = []

  // LUFS — improvement if output is closer to the platform target LUFS
  // AUDIT-M11 FIX: was hardcoded to -14. Now uses the real platform target
  // from the session store (e.g. Spotify -14, Apple -16, YouTube -14, Tidal -14, Vinyl -10).
  const beforeLufsDelta = Math.abs(input.lufs - targetLufs)
  const afterLufsDelta = Math.abs(output.lufs - targetLufs)
  const lufsDiff = output.lufs - input.lufs
  metrics.push({
    label: 'LUFS',
    beforeVal: formatLufs(input.lufs),
    afterVal: formatLufs(output.lufs),
    delta: (lufsDiff >= 0 ? '+' : '') + lufsDiff.toFixed(1),
    improved: afterLufsDelta < beforeLufsDelta ? true : afterLufsDelta > beforeLufsDelta ? false : null,
    unit: 'LU',
  })

  // TruePeak — lower is better (less clipping)
  const tpDiff = output.truePeak - input.truePeak
  metrics.push({
    label: 'TruePeak',
    beforeVal: formatDb(input.truePeak),
    afterVal: formatDb(output.truePeak),
    delta: (tpDiff >= 0 ? '+' : '') + tpDiff.toFixed(1),
    improved: tpDiff < 0 ? true : tpDiff > 0 ? false : null,
    unit: 'dBTP',
  })

  // RMS — neutral (context-dependent)
  const rmsDiff = output.rms - input.rms
  metrics.push({
    label: 'RMS',
    beforeVal: formatDb(input.rms),
    afterVal: formatDb(output.rms),
    delta: (rmsDiff >= 0 ? '+' : '') + rmsDiff.toFixed(1),
    improved: null,
    unit: 'dB',
  })

  // DR — higher is better
  const drDiff = output.dynamicRange - input.dynamicRange
  metrics.push({
    label: 'DR',
    beforeVal: formatDr(input.dynamicRange),
    afterVal: formatDr(output.dynamicRange),
    delta: (drDiff >= 0 ? '+' : '') + drDiff.toFixed(1),
    improved: drDiff > 0 ? true : drDiff < 0 ? false : null,
    unit: 'dB',
  })

  return metrics
}

export function BeforeAfterOverlay({ open, onClose }: BeforeAfterOverlayProps) {
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)
  // AUDIT-M11 FIX: read the real platform target LUFS instead of hardcoding -14.
  const platform = useSessionStore((s) => s.platform)
  const targetLufs = (() => {
    const targets: Record<string, number> = {
      spotify: -14, apple_music: -16, youtube: -14, tidal: -14, cd: -9, vinyl: -10,
    }
    return targets[platform] ?? -14
  })()

  // Close on Escape — AUDIT2-2 FIX: stopPropagation so the global
  // KeyboardShortcuts handler doesn't ALSO fire (which would stop & rewind
  // audio every time the user pressed Esc to close the overlay).
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (open) {
      // Use capture phase so we beat the global handler to the punch.
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, handleKeyDown])

  // No analysis data yet
  if (!inputAnalysis || !outputAnalysis) return null

  const metrics = computeMetrics(inputAnalysis, outputAnalysis, targetLufs)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => {
            // Close on backdrop click
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-2xl mx-4"
          >
            <div className="rounded-xl border border-white/10 bg-[rgba(10,12,18,0.92)] backdrop-blur-xl shadow-2xl shadow-black/60 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <div>
                  <h2 className="text-sm font-mono font-bold tracking-wider text-rain-accent">
                    BEFORE / AFTER COMPARISON
                  </h2>
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                    Input vs. mastered output analysis
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close comparison overlay"
                  className="flex items-center justify-center w-8 h-8 rounded-md border border-rain-border bg-rain-surface-2 text-foreground/60 hover:text-rain-accent hover:border-rain-accent/50 active:scale-90 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Column headers */}
              <div className="flex items-center px-6 py-2 border-b border-white/10">
                <div className="w-20 flex-shrink-0" />
                <div className="flex-1 text-right pr-4">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground/40">
                    Before
                  </span>
                </div>
                <div className="w-16 flex-shrink-0" />
                <div className="flex-1 text-left pl-4">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-rain-accent/70">
                    After
                  </span>
                </div>
              </div>

              {/* Central divider — BEFORE | AFTER labels */}
              <div className="relative px-6">
                {/* Vertical divider line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-rain-accent/30 to-transparent" />
              </div>

              {/* Metrics */}
              <div className="px-6 py-2">
                {metrics.map((m) => (
                  <MetricRow key={m.label} {...m} />
                ))}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4 text-[9px] font-mono">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#AAFF00]" />
                    Improved
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#F97316]" />
                    Degraded
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#64748B]" />
                    Neutral
                  </span>
                </div>
                <div className="text-[9px] font-mono text-muted-foreground/50">
                  Press <kbd className="px-1 py-0.5 rounded border border-rain-border bg-rain-surface-2 text-[8px]">Esc</kbd> to close
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
