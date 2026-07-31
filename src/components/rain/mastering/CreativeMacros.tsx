'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Sparkles, Undo2, Redo2, Zap, SlidersHorizontal, Bookmark } from 'lucide-react'
import { MACROS, TENSION_PAIRS } from '@/lib/rain/constants'
import type { MacroKey, MacroValues } from '@/lib/rain/types'
import { useSessionStore } from '@/lib/rain/store'
import { recordActivity } from '@/lib/rain/analytics'
import { MacroKnob } from './MacroKnob'
import { GenrePresets } from './GenrePresets'
import { CustomPresets } from './CustomPresets'

interface CreativeMacrosProps {
  onAiSuggest?: () => void
  aiLoading?: boolean
}

export function CreativeMacros({ onAiSuggest, aiLoading = false }: CreativeMacrosProps) {
  const macros = useSessionStore((s) => s.macros)
  const setMacros = useSessionStore((s) => s.setMacros)
  const macroSource = useSessionStore((s) => s.macroSource)
  const macroConfidence = useSessionStore((s) => s.macroConfidence)
  const genre = useSessionStore((s) => s.genre)
  const canUndo = useSessionStore((s) => s.canUndo)
  const canRedo = useSessionStore((s) => s.canRedo)
  const undoMacros = useSessionStore((s) => s.undoMacros)
  const redoMacros = useSessionStore((s) => s.redoMacros)
  const [showPresets, setShowPresets] = useState(false)
  const [showMyPresets, setShowMyPresets] = useState(false)

  // P2-ANALYTICS: wrap undo/redo so each invocation is recorded to the
  // activity log (and the matching cumulative counter is bumped). The
  // wrapper preserves the original store action semantics — it just
  // emits a recordActivity call alongside it. Failures are swallowed so
  // analytics can never break the undo/redo flow.
  const handleUndo = () => {
    if (!canUndo) return
    undoMacros()
    void recordActivity('undo').catch(() => { /* swallow */ })
  }
  const handleRedo = () => {
    if (!canRedo) return
    redoMacros()
    void recordActivity('redo').catch(() => { /* swallow */ })
  }

  // Listen for keyboard shortcut custom events (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z,
  // Ctrl/Cmd+Y). Routed through the same wrapper so keyboard undo/redo is
  // also recorded.
  useEffect(() => {
    const onKeyUndo = () => handleUndo()
    const onKeyRedo = () => handleRedo()
    window.addEventListener('rain:undo', onKeyUndo)
    window.addEventListener('rain:redo', onKeyRedo)
    return () => {
      window.removeEventListener('rain:undo', onKeyUndo)
      window.removeEventListener('rain:redo', onKeyRedo)
    }
  }, [canUndo, canRedo, undoMacros, redoMacros])

  const tensions = TENSION_PAIRS.filter((t) => {
    const v1 = macros[t.keys[0]]
    const v2 = macros[t.keys[1]]
    return v1 > 7 && v2 > 7
  })

  return (
    <div className="rain-panel rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
            Creative Macros
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">7 Controls · 0–10</span>
            <SourceBadge source={macroSource} confidence={macroConfidence} />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Undo / Redo ghost buttons */}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="Undo macro change"
            className="flex items-center justify-center w-8 h-8 rounded-md border border-rain-border bg-rain-surface-2 text-foreground/60 hover:text-rain-accent hover:border-rain-accent/50 active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-rain-border disabled:hover:text-foreground/60"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            aria-label="Redo macro change"
            className="flex items-center justify-center w-8 h-8 rounded-md border border-rain-border bg-rain-surface-2 text-foreground/60 hover:text-rain-accent hover:border-rain-accent/50 active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-rain-border disabled:hover:text-foreground/60"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onAiSuggest}
            disabled={aiLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rain-accent text-black text-xs font-semibold hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100"
          >
            {aiLoading ? (
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            AI Suggest
          </button>
          <button
            onClick={() => {
              setShowPresets((v) => !v)
              setShowMyPresets(false)
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors ${showPresets ? 'border-rain-accent/50 bg-rain-accent/10 text-rain-accent' : 'border-rain-border bg-rain-surface-2 text-foreground/80 hover:border-rain-accent/50'}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Presets
          </button>
          <button
            onClick={() => {
              setShowMyPresets((v) => !v)
              setShowPresets(false)
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors ${showMyPresets ? 'border-rain-accent/50 bg-rain-accent/10 text-rain-accent' : 'border-rain-border bg-rain-surface-2 text-foreground/80 hover:border-rain-accent/50'}`}
            aria-label="Toggle My Presets panel"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Mine
          </button>
        </div>
      </div>

      {/* Inline Genre Presets */}
      <AnimatePresence>
        {showPresets && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <GenrePresets />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline Custom (My) Presets */}
      <AnimatePresence>
        {showMyPresets && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <CustomPresets />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
        {MACROS.map((m, i) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex justify-center"
          >
            <MacroKnob
              label={m.label}
              value={macros[m.key]}
              onChange={(v) => setMacros({ [m.key]: v } as Partial<MacroValues>)}
              color={m.color}
              description={m.description}
              subParams={[...m.subParams]}
              defaultValue={m.default}
            />
          </motion.div>
        ))}
      </div>

      {/* Tension warnings */}
      {tensions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 space-y-1.5"
        >
          {tensions.map((t) => (
            <div
              key={`${t.keys[0]}-${t.keys[1]}`}
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-orange-500/10 border border-orange-500/30 text-xs"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-mono font-bold text-orange-400 uppercase">
                  {t.keys[0]} + {t.keys[1]}
                </span>
                <span className="text-muted-foreground ml-1">— {t.message}</span>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      <div className="mt-3 pt-3 border-t border-rain-border flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>Genre: <span className="text-rain-accent">{genre}</span></span>
        <span>Double-click knob to reset · Scroll to fine-tune</span>
      </div>
    </div>
  )
}

function SourceBadge({ source, confidence }: { source: string; confidence: number }) {
  const color = source === 'MODEL' ? '#AAFF00' : source === 'HEURISTIC' ? '#00D4FF' : '#64748B'
  const label = source === 'MODEL' ? 'AI' : source === 'HEURISTIC' ? 'HEURISTIC' : 'MANUAL'
  return (
    <span
      className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border"
      style={{ color, borderColor: `${color}40`, background: `${color}10` }}
    >
      {label}{source !== 'MANUAL' && confidence > 0 ? ` ${confidence}%` : ''}
    </span>
  )
}
