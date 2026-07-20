'use client'

import { motion } from 'framer-motion'
import { Clock, Trash2, ArrowRight, Music2 } from 'lucide-react'
import { useSessionStore, type RenderLogEntry } from '@/lib/rain/store'

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (isToday) return `Today ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function formatDuration(sec: number): string {
  // P3-ANALYTICS: `entry.duration` is now audio duration in SECONDS (was render
  // wall-clock ms). Format as m:ss (or h:mm:ss for long-form).
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  const ss = String(s).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${m}:${ss}`
}

function scoreColor(score: number): string {
  if (score >= 90) return '#AAFF00'
  if (score >= 75) return '#84CC16'
  if (score >= 60) return '#F97316'
  return '#EF4444'
}

export function RenderHistory() {
  const renderHistory = useSessionStore((s) => s.renderHistory)
  const clearRenderHistory = useSessionStore((s) => s.clearRenderHistory)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setGenre = useSessionStore((s) => s.setGenre)
  const setPlatform = useSessionStore((s) => s.setPlatform)

  const handleRestore = (entry: RenderLogEntry) => {
    setMacros(entry.macroValues)
    setGenre(entry.genre)
    setPlatform(entry.platform)
  }

  if (renderHistory.length === 0) {
    return (
      <div className="rain-panel rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-rain-accent" />
          <div className="text-sm font-semibold">Render History</div>
        </div>
        <div className="text-center py-8">
          <Music2 className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <div className="text-sm text-muted-foreground">
            No renders yet — run the 16-stage pipeline to create history
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/50 mt-2">
            Each render will be logged here with full macro snapshot
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rain-panel rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-rain-accent" />
          <div className="text-sm font-semibold">Render History</div>
          <span className="text-[10px] font-mono text-muted-foreground ml-1">
            {renderHistory.length} / 20
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative max-h-96 overflow-y-auto rain-scrollbar pr-2">
        <div className="space-y-0">
          {renderHistory.map((entry, i) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              className="relative flex gap-3 group"
            >
              {/* Timeline line + dot */}
              <div className="flex flex-col items-center flex-shrink-0 w-5">
                <div
                  className="w-3 h-3 rounded-full border-2 flex-shrink-0 mt-3.5 transition-colors"
                  style={{
                    borderColor: scoreColor(entry.rainScore),
                    background: i === 0 ? scoreColor(entry.rainScore) : 'transparent',
                  }}
                />
                {i < renderHistory.length - 1 && (
                  <div className="w-px flex-1 bg-rain-border/50" />
                )}
              </div>

              {/* Card */}
              <button
                onClick={() => handleRestore(entry)}
                className="flex-1 text-left bg-rain-surface-2/60 border border-rain-border/50 rounded-lg p-3 mb-2 hover:border-rain-accent/40 hover:bg-rain-surface-2 transition-all group-hover:shadow-[0_0_8px_rgba(170,255,0,0.06)] w-full"
                aria-label={`Restore render from ${formatTimestamp(entry.timestamp)}`}
              >
                {/* Top row: timestamp + score badge */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{
                      color: scoreColor(entry.rainScore),
                      background: `${scoreColor(entry.rainScore)}15`,
                      border: `1px solid ${scoreColor(entry.rainScore)}30`,
                    }}
                  >
                    {entry.rainScore}
                  </span>
                </div>

                {/* File name */}
                <div className="text-xs font-medium truncate mb-1.5" title={entry.fileName}>
                  {entry.fileName}
                </div>

                {/* Genre → Platform */}
                <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground mb-1.5">
                  <span className="capitalize">{entry.genre}</span>
                  <ArrowRight className="w-2.5 h-2.5" />
                  <span className="capitalize">{entry.platform.replace(/_/g, ' ')}</span>
                </div>

                {/* LUFS + Duration row */}
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <span className="text-muted-foreground">
                    {entry.inputLufs.toFixed(1)} <ArrowRight className="w-2.5 h-2.5 inline" style={{ color: '#AAFF00' }} />{' '}
                    <span className="text-rain-accent">{entry.outputLufs.toFixed(1)}</span> LUFS
                  </span>
                  <span className="text-muted-foreground/60">
                    {formatDuration(entry.duration)}
                  </span>
                </div>

                {/* Restore hint on hover */}
                <div className="text-[9px] font-mono text-rain-accent/0 group-hover:text-rain-accent/70 transition-colors mt-1">
                  Click to restore macros
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Clear button */}
      <div className="mt-3 pt-3 border-t border-rain-border/30">
        <button
          onClick={clearRenderHistory}
          className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors"
          aria-label="Clear render history"
        >
          <Trash2 className="w-3 h-3" />
          Clear history
        </button>
      </div>
    </div>
  )
}
