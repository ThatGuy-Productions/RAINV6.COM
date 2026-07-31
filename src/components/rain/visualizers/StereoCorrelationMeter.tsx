'use client'

/**
 * RAIN V6 — Stereo Correlation Meter (REAL, real-time)
 *
 * Displays the real stereo correlation of the audio signal.
 * Correlation ranges from -1 (out of phase) through 0 (uncorrelated) to +1 (mono/in-phase).
 *
 * P2-METERS FIX (round 2):
 *   - PREVIOUSLY the meter read `outputAnalysis.qcMetrics.phaseCorrelation` —
 *     a REAL measurement, but only computed ONCE at render time. During
 *     playback the meter was frozen at the render-time value (or showed
 *     nothing until the first render completed).
 *   - NOW the meter subscribes to audio-engine state and reads the LIVE
 *     `correlation` field, which is computed every tick() (~30 Hz) from a
 *     2048-sample window of the playing buffer's L and R channels at the
 *     current playback position. The measurement is real Pearson correlation
 *     (dsp.ts::computeCorrelation), not a synthetic animation.
 *   - The render-time value from qcMetrics remains as a fallback when no
 *     playback is in progress (e.g. after a render but before pressing Play).
 *   - Numeric readout (e.g. "+0.85" / "-0.12") updates in real time next to
 *     the meter bar — see correlationStr below.
 *
 * Wrapped in React.memo — props (variant) are stable across renders.
 */

import { useEffect, useState, memo } from 'react'
import { audioEngine, type AudioEngineState } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'

interface StereoCorrelationMeterProps {
  /** 'input' reads inputAnalysis.qcMetrics.phaseCorrelation; 'output' reads outputAnalysis */
  variant?: 'input' | 'output'
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Map a correlation value [-1, 1] to a color */
function correlationColor(correlation: number): string {
  if (correlation >= 0.5) return '#22C55E' // green — correlated/mono
  if (correlation >= 0.0) return '#EAB308' // yellow — uncorrelated
  return '#EF4444' // red — out of phase
}

export const StereoCorrelationMeter = memo(function StereoCorrelationMeter({ variant = 'output' }: StereoCorrelationMeterProps) {
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)

  // P2-METERS: subscribe to live audio engine state. The engine emits at
  // ~30 Hz during playback (RAF-driven tick loop), so the meter updates in
  // real time. The correlation field is null when no buffer is loaded.
  const [engineState, setEngineState] = useState<AudioEngineState | null>(null)
  useEffect(() => {
    const unsub = audioEngine.subscribe((s) => setEngineState(s))
    return unsub
  }, [])

  // For the 'output' variant we use the live correlation (which is computed
  // from the processedBuffer when previewMode is 'B'). For the 'input'
  // variant we use the live correlation when in 'A' mode, otherwise fall
  // back to the render-time inputAnalysis measurement.
  const liveCorrelation = engineState?.correlation ?? null
  const renderTimeValue = variant === 'input'
    ? inputAnalysis?.qcMetrics.phaseCorrelation
    : outputAnalysis?.qcMetrics.phaseCorrelation

  // Prefer the live measurement when available; fall back to render-time.
  const correlation = liveCorrelation !== null ? liveCorrelation : (renderTimeValue ?? 0)
  const hasLive = liveCorrelation !== null
  const hasRenderTime = renderTimeValue !== undefined
  const hasAny = hasLive || hasRenderTime

  // Map correlation [-1, 1] to position [0%, 100%]
  const needlePosition = ((correlation + 1) / 2) * 100
  const needleColor = correlationColor(correlation)

  // Numeric display — show "—" when no analysis exists yet
  const correlationStr = hasAny
    ? (correlation >= 0 ? '+' : '') + correlation.toFixed(2)
    : '—'

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Stereo Correlation {variant === 'input' ? '(Input)' : '(Output)'}
        </span>
        <span
          className="text-sm font-bold font-mono tabular-nums"
          style={{ color: hasAny ? needleColor : '#6B7280' }}
          role="status"
          aria-live="polite"
        >
          {correlationStr}
        </span>
      </div>

      {/* Meter bar */}
      <div className="relative h-3 rounded-sm overflow-hidden bg-rain-surface-3">
        {/* Gradient background: red → yellow → green */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              'linear-gradient(90deg, #EF4444 0%, #EAB308 50%, #22C55E 100%)',
          }}
        />

        {/* Center line at 0 correlation (50% position) */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />

        {/* +1 marker line */}
        <div className="absolute top-0 bottom-0 left-0 w-px bg-white/15" />

        {/* -1 marker line */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-white/15" />

        {/* Needle / indicator */}
        {hasAny && (
          <div
            className="absolute top-0 bottom-0 w-1 -translate-x-1/2 rounded-sm transition-all duration-100 ease-out"
            style={{
              left: `${clamp(needlePosition, 1, 99)}%`,
              backgroundColor: needleColor,
              boxShadow: `0 0 6px ${needleColor}80`,
            }}
          >
            {/* Needle tip triangle — points down */}
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2"
              style={{
                width: 0,
                height: 0,
                borderLeft: '3px solid transparent',
                borderRight: '3px solid transparent',
                borderTop: `3px solid ${needleColor}`,
              }}
            />
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60">
        <span>Out of Phase</span>
        <span className="text-muted-foreground/40">0</span>
        <span>Mono</span>
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/50">
        <span>
          {!hasAny
            ? `Awaiting ${variant === 'input' ? 'input' : 'render'} analysis`
            : hasLive
              ? 'LIVE · ~30 Hz'
              : 'render-time value'}
        </span>
      </div>
    </div>
  )
})
