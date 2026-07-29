'use client'

import { LUFS_SCALE, PLATFORM_TARGETS } from '@/lib/rain/constants'
import { useSessionStore } from '@/lib/rain/store'
import { LufsHistoryGraph } from '@/components/rain/visualizers/LufsHistoryGraph'

interface MeteringPanelProps {
  variant?: 'input' | 'output'
}

export function MeteringPanel({ variant = 'output' }: MeteringPanelProps) {
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const analysis = variant === 'input' ? inputAnalysis : outputAnalysis
  const platform = useSessionStore((s) => s.platform)
  const platformTarget = PLATFORM_TARGETS.find((p) => p.slug === platform) ?? PLATFORM_TARGETS[0]

  if (!analysis) {
    return (
      <div className="rain-panel rounded-lg p-4 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {variant === 'input' ? 'Input' : 'Output'} Metering
        </div>
        <div className="text-xs text-muted-foreground italic">No analysis yet</div>
      </div>
    )
  }

  const targetLufs = variant === 'output' ? platformTarget.targetLufs : -23
  const lufsDelta = analysis.lufs - targetLufs
  const lufsOk = Math.abs(lufsDelta) < 1.0

  const tpCeiling = variant === 'output' ? platformTarget.truePeakCeiling : 0
  const tpOk = analysis.truePeak <= tpCeiling

  return (
    <div className="rain-panel rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {variant === 'input' ? 'Input' : 'Output'} Metering
        </div>
        {variant === 'output' && (
          <div className="text-[9px] font-mono text-muted-foreground">
            Target: <span style={{ color: platformTarget.tier === 1 ? '#AAFF00' : '#8B5CF6' }}>{platformTarget.label}</span>
          </div>
        )}
      </div>

      {/* LUFS Meter */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">LUFS (Integrated)</span>
          <span className={`text-base font-bold font-mono tabular-nums ${lufsOk ? 'rain-gradient-text-lime' : 'text-orange-400'}`}>
            {analysis.lufs.toFixed(1)}
          </span>
        </div>
        <div className="relative h-3 bg-rain-surface-3 rounded-sm overflow-hidden">
          {/* Scale gradient */}
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'linear-gradient(90deg, #64748B 0%, #06B6D4 40%, #AAFF00 65%, #F59E0B 85%, #EF4444 100%)' }}
          />
          {/* Target markers */}
          {LUFS_SCALE.targets.map((t) => {
            const pos = ((t.value - LUFS_SCALE.min) / (LUFS_SCALE.max - LUFS_SCALE.min)) * 100
            return (
              <div key={t.label} className="absolute top-0 bottom-0" style={{ left: `${pos}%` }}>
                <div className="w-px h-full bg-white/40" />
              </div>
            )
          })}
          {/* Current value pointer */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
            style={{ left: `${clamp(((analysis.lufs - LUFS_SCALE.min) / (LUFS_SCALE.max - LUFS_SCALE.min)) * 100, 0, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-0.5">
          {LUFS_SCALE.targets.map((t) => (
            <span key={t.label} style={{ color: t.color }}>{t.label} {t.value}</span>
          ))}
        </div>
        {variant === 'output' && (
          <div className={`text-[9px] font-mono mt-1 ${lufsOk ? 'text-rain-accent' : 'text-orange-400'}`}>
            Δ {lufsDelta > 0 ? '+' : ''}{lufsDelta.toFixed(1)} LU from target
          </div>
        )}
      </div>

      {/* True Peak Meter */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">True Peak</span>
          <span className={`text-base font-bold font-mono tabular-nums ${tpOk ? 'rain-gradient-text-lime' : 'text-red-400'}`}>
            {analysis.truePeak.toFixed(1)} <span className="text-[10px] opacity-60">dBTP</span>
          </span>
        </div>
        <div className="relative h-3 bg-rain-surface-3 rounded-sm overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: 'linear-gradient(90deg, #10B981 0%, #AAFF00 60%, #F59E0B 80%, #EF4444 100%)' }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
            style={{ left: `${clamp(((analysis.truePeak + 6) / 6) * 100, 0, 100)}%` }}
          />
        </div>
        {variant === 'output' && (
          <div className={`text-[9px] font-mono mt-1 ${tpOk ? 'text-rain-accent' : 'text-red-400'}`}>
            Ceiling: {tpCeiling.toFixed(1)} dBTP {tpOk ? '✓ within' : '✗ exceeds'}
          </div>
        )}
      </div>

      {/* Other metrics */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-rain-border">
        <Metric label="RMS" value={`${analysis.rms.toFixed(1)} dB`} />
        <Metric label="Crest" value={`${analysis.crestFactor.toFixed(1)} dB`} />
        <Metric label="DR (LRA)" value={`${analysis.dynamicRange.toFixed(1)} LU`} />
        <Metric label="BPM" value={analysis.bpm ? String(analysis.bpm) : '—'} />
        <Metric label="Key" value={analysis.key ?? '—'} />
        <Metric label="Peak Hz" value={analysis.peakFrequency > 0 ? `${Math.round(analysis.peakFrequency)} Hz` : '—'} />
      </div>

      {/* LUFS History Graph — output panel only, after processing */}
      {variant === 'output' && hasProcessed && (
        <div className="pt-2 border-t border-rain-border">
          <LufsHistoryGraph height={120} />
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-1.5">
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className="text-xs font-mono font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
