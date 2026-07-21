'use client'

import { motion } from 'framer-motion'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { RainScore } from '@/lib/rain/types'
import { useSessionStore } from '@/lib/rain/store'

interface RainScoreGaugeProps {
  score: RainScore | null
  size?: number
}

const PLATFORMS: Array<{ key: keyof RainScore; label: string; color: string }> = [
  { key: 'spotify', label: 'Spotify', color: '#AAFF00' },
  { key: 'apple_music', label: 'Apple', color: '#00D4FF' },
  { key: 'youtube', label: 'YouTube', color: '#F97316' },
  { key: 'tidal', label: 'Tidal', color: '#8B5CF6' },
]

/** Score-to-color mapping for the sparkline + delta badge. */
function scoreColor(score: number): string {
  if (score >= 90) return '#AAFF00'
  if (score >= 75) return '#84CC16'
  if (score >= 60) return '#F97316'
  return '#EF4444'
}

/** Build an SVG sparkline path from a list of scores. */
function sparklinePath(scores: number[], w: number, h: number): string {
  if (scores.length === 0) return ''
  if (scores.length === 1) return `M 0 ${h - (scores[0] / 100) * h}`
  const step = w / (scores.length - 1)
  return scores
    .map((s, i) => {
      const x = i * step
      const y = h - (s / 100) * h
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function RainScoreGauge({ score, size = 180 }: RainScoreGaugeProps) {
  const overall = score?.overall ?? 0
  const radius = size / 2 - 16
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (overall / 100) * circumference * 0.75

  // Score history sparkline — pulls from renderHistory in the store.
  const renderHistory = useSessionStore((s) => s.renderHistory)
  const scoreHistory = renderHistory.map((r) => r.rainScore).slice(0, 12).reverse()
  const prevScore = scoreHistory.length >= 2 ? scoreHistory[scoreHistory.length - 2] : null
  const delta = prevScore !== null ? overall - prevScore : null

  const sparkW = 120
  const sparkH = 28

  return (
    <div className="rain-panel rounded-lg p-4 relative overflow-hidden">
      {/* Subtle animated glow background when score is high */}
      {overall >= 85 && (
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            background: 'radial-gradient(circle at 50% 30%, rgba(170,255,0,0.15), transparent 60%)',
          }}
        />
      )}

      <div className="flex items-center justify-between mb-2 relative">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          RAIN Score V2
        </div>
        {/* Delta badge — shows score change vs. previous render */}
        {delta !== null && delta !== 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              delta > 0
                ? 'bg-rain-accent/15 text-rain-accent border border-rain-accent/30'
                : 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
            }`}
            title={`Change from previous render (${prevScore} → ${overall})`}
          >
            {delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {delta > 0 ? '+' : ''}{delta}
          </motion.div>
        )}
        {delta === 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground bg-rain-surface-3 border border-rain-border">
            <Minus className="w-2.5 h-2.5" />
            0
          </div>
        )}
      </div>

      <div className="flex items-center justify-center mb-3 relative">
        <div className="relative" style={{ width: size, height: size }}>
          <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
            {/* Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="6"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeDashoffset={circumference * 0.125}
              strokeLinecap="round"
              transform={`rotate(135 ${size / 2} ${size / 2})`}
            />
            {/* Value arc */}
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="url(#scoreGrad)"
              strokeWidth="6"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeLinecap="round"
              transform={`rotate(135 ${size / 2} ${size / 2})`}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ filter: 'drop-shadow(0 0 8px rgba(170, 255, 0, 0.5))' }}
            />
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#AAFF00" />
                <stop offset="50%" stopColor="#84CC16" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.div
              key={overall}
              initial={{ scale: 0.85, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="text-5xl font-bold rain-gradient-text-lime font-mono tabular-nums"
              style={{ color: scoreColor(overall) }}
            >
              {overall}
            </motion.div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              / 100
            </div>
          </div>
        </div>
      </div>

      {/* Score history sparkline — last N renders */}
      {scoreHistory.length >= 2 && (
        <div className="mb-3 px-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Score History · {scoreHistory.length} renders
            </span>
            <span className="text-[9px] font-mono text-muted-foreground/50">
              avg {(scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length).toFixed(1)}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${sparkW} ${sparkH}`}
            className="w-full"
            style={{ height: sparkH }}
            role="img"
            aria-label={`Score history sparkline: ${scoreHistory.join(', ')}`}
          >
            {/* Baseline at average */}
            {(() => {
              const avg = scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length
              const avgY = sparkH - (avg / 100) * sparkH
              return <line x1="0" y1={avgY} x2={sparkW} y2={avgY} stroke="rgba(170,255,0,0.15)" strokeWidth="1" strokeDasharray="2 2" />
            })()}
            {/* Area fill */}
            <path
              d={`${sparklinePath(scoreHistory, sparkW, sparkH)} L ${sparkW} ${sparkH} L 0 ${sparkH} Z`}
              fill="url(#sparkFill)"
              opacity="0.3"
            />
            {/* Line */}
            <path
              d={sparklinePath(scoreHistory, sparkW, sparkH)}
              fill="none"
              stroke="#AAFF00"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 3px rgba(170,255,0,0.4))' }}
            />
            {/* End dot */}
            {(() => {
              const lastX = sparkW
              const lastY = sparkH - (overall / 100) * sparkH
              return (
                <motion.circle
                  cx={lastX}
                  cy={lastY}
                  r="2.5"
                  fill={scoreColor(overall)}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.5, type: 'spring' }}
                />
              )
            })()}
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#AAFF00" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#AAFF00" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}

      <div className="space-y-1.5">
        {PLATFORMS.map((p) => {
          const value = score?.[p.key] as number ?? 0
          const penalty = score?.codec_penalty?.[p.key as string] ?? 0
          return (
            <div key={p.key} className="flex items-center gap-2 group">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-16 group-hover:text-foreground transition-colors">
                {p.label}
              </span>
              <div className="flex-1 h-1.5 bg-rain-surface-3 rounded-full overflow-hidden relative">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: p.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${value}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                {/* Penalty indicator — small red notch at the end */}
                {penalty > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-orange-500/60"
                    style={{ left: `calc(${value}% - 2px)` }}
                    title={`Codec penalty: -${penalty.toFixed(1)}`}
                  />
                )}
              </div>
              <span className="text-xs font-mono font-bold tabular-nums w-7 text-right" style={{ color: p.color }}>
                {value}
              </span>
              {penalty > 0 && (
                <span className="text-[9px] font-mono text-orange-400 w-12 text-right">
                  -{penalty.toFixed(1)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
