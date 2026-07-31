'use client'

/**
 * RAIN V6 — RepairTab (P3-REPAIR)
 *
 * 8 real DSP repair modules. Every "Run" click invokes actual DSP on the
 * loaded audio buffer — no setTimeout, no fabricated metrics. The "Repair
 * Spectrum Analysis" panel at the bottom shows MEASURED values from
 * `measureRepairMetrics()` and updates after every repair run.
 *
 * Flow:
 *  - On mount / file load: measure current input metrics → show as baseline
 *  - "Run" → call audioEngine.runRepair() with real DSP, show live progress
 *  - After run: show before/after/improvement, "Apply to master" button
 *  - "Apply to master" → commit repaired audio to input buffer
 *  - "Reset to original" → restore input buffer from the immutable original
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity,
  Loader2,
  Wand2,
  Check,
  RotateCcw,
  AlertCircle,
  X,
  Zap,
} from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { audioEngine } from '@/lib/rain/audio-engine'
import { recordActivity } from '@/lib/rain/analytics'
import {
  measureRepairMetrics,
  type RepairModuleId,
  type RepairResult,
} from '@/lib/rain/repair'
import { notifySuccess, notifyError, notifyInfo } from '@/lib/rain/notifications'

// ---------------------------------------------------------------------------
// Module catalogue — honest DSP names, no fake ML model claims
// ---------------------------------------------------------------------------

interface RepairModuleDef {
  id: RepairModuleId
  name: string
  method: string
  description: string
  color: string
}

const REPAIR_MODULES: RepairModuleDef[] = [
  {
    id: 'denoise',
    name: 'Broadband Denoise',
    method: 'Adaptive Spectral Subtraction',
    description: 'STFT noise floor from quietest 10 % of frames, soft-knee subtraction with oversubtraction.',
    color: '#AAFF00',
  },
  {
    id: 'spectral_gate',
    name: 'Adaptive Spectral Gate',
    method: 'Per-band Dynamic Gate',
    description: 'Per-bin threshold from local statistics, soft gating curve (no hard cut).',
    color: '#00D4FF',
  },
  {
    id: 'declick',
    name: 'De-click',
    method: 'Cubic Spline Interpolation',
    description: 'MAD transient detection (median + 8·MAD), cubic Hermite repair, autocorrelation for periodic clicks.',
    color: '#F97316',
  },
  {
    id: 'decrackle',
    name: 'De-crackle',
    method: 'MAD Crackler Detector',
    description: 'HF-band (5 kHz HPF) MAD detection + cubic Hermite overlap-add interpolation.',
    color: '#84CC16',
  },
  {
    id: 'dehum',
    name: 'De-hum',
    method: 'Harmonic Notch Cascade',
    description: '40–70 Hz autocorrelation fundamental detect + 7-harmonic notch cascade (Q=30).',
    color: '#8B5CF6',
  },
  {
    id: 'dereverb',
    name: 'De-reverb',
    method: 'RT60 Envelope Subtraction',
    description: 'Reverse-integrated energy RT60 estimate, time-varying late-reverb suppression.',
    color: '#D946EF',
  },
  {
    id: 'declip',
    name: 'Clipping Reconstruction',
    method: 'Hermite Spline Reconstruction',
    description: 'Clip-region detect (|s|≥0.999), cubic Hermite spline between clean boundaries, gentle LPF.',
    color: '#10B981',
  },
  {
    id: 'resonance',
    name: 'Resonance Suppression',
    method: 'Spectral Flux Peak Suppression',
    description: 'Peak prominence detect from averaged spectrum, narrow notch (Q=10) cascade, max 8 peaks.',
    color: '#F59E0B',
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RepairTab() {
  const macros = useSessionStore((s) => s.macros)
  const setMacros = useSessionStore((s) => s.setMacros)
  const fileName = useSessionStore((s) => s.fileName)
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)

  const [activeModule, setActiveModule] = useState<RepairModuleId | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<RepairResult | null>(null)
  const [currentMetrics, setCurrentMetrics] = useState<Record<string, number> | null>(null)
  const [canReset, setCanReset] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Measure current input metrics whenever a file is loaded/changed.
  useEffect(() => {
    if (!fileName) {
      setCurrentMetrics(null)
      setLastResult(null)
      setCanReset(false)
      return
    }
    const channels = audioEngine.getInputChannels()
    if (!channels) {
      setCurrentMetrics(null)
      return
    }
    // getInputChannels returns live views — copy so the measurement is a snapshot.
    const copies = channels.map((c) => c.slice())
    const sr = audioEngine.inputSampleRate
    if (sr > 0 && copies.length > 0) {
      const metrics = measureRepairMetrics(copies, sr)
      setCurrentMetrics(metrics)
    }
    setCanReset(audioEngine.canResetRepair)
  }, [fileName, inputAnalysis])

  const handleRun = useCallback(
    async (moduleId: RepairModuleId) => {
      if (!fileName || activeModule) return
      setActiveModule(moduleId)
      setProgress(0)
      setError(null)
      setLastResult(null)
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const result = await audioEngine.runRepair(
          moduleId,
          macros.repair,
          (pct) => setProgress(pct),
          ac.signal,
        )
        setLastResult(result)
        // P2-ANALYTICS: record real repair-module usage (module id, intensity,
        // measured duration). recordActivity('repair') bumps the cumulative
        // repairCount counter so the Analytics KPI can show the real count
        // without re-reading the full activity log.
        void recordActivity('repair', {
          moduleId,
          intensity: macros.repair,
          durationMs: result.duration,
          sampleRate: result.sampleRate,
        }).catch(() => { /* swallow — analytics must not break repair flow */ })
        notifySuccess('Repair complete', `${(result.duration / 1000).toFixed(1)}s processing time`)
      } catch (e) {
        const err = e as Error
        if (err.name === 'CancelledError') {
          notifyInfo('Repair cancelled')
        } else {
          setError(err.message || 'Repair failed')
          notifyError('Repair failed', err.message)
        }
      } finally {
        setActiveModule(null)
        setProgress(0)
        abortRef.current = null
      }
    },
    [fileName, activeModule, macros.repair],
  )

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleApply = useCallback(() => {
    if (!lastResult) return
    audioEngine.applyRepair(lastResult.channels)
    setCurrentMetrics(measureRepairMetrics(lastResult.channels, lastResult.sampleRate))
    setLastResult(null)
    setCanReset(audioEngine.canResetRepair)
    notifySuccess('Repair applied', 'Input buffer updated with repaired audio')
  }, [lastResult])

  const handleReset = useCallback(() => {
    const ok = audioEngine.resetRepair()
    if (ok) {
      const channels = audioEngine.getInputChannels()
      if (channels) {
        const copies = channels.map((c) => c.slice())
        const sr = audioEngine.inputSampleRate
        if (sr > 0) {
          setCurrentMetrics(measureRepairMetrics(copies, sr))
        }
      }
      setLastResult(null)
      setCanReset(false)
      notifyInfo('Repair reverted', 'Input buffer restored to original')
    } else {
      notifyInfo('Nothing to revert', 'No repair has been applied')
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Header — REPAIR macro + pipeline info */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              DSP Restoration Suite
            </div>
            <div className="text-sm font-semibold">
              8 modules · real-time TypeScript DSP · no ML inference
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">REPAIR macro:</span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={macros.repair}
              onChange={(e) => setMacros({ repair: parseFloat(e.target.value) })}
              className="rain-range w-32"
              aria-label="Repair intensity"
            />
            <span className="text-sm font-mono font-bold text-rain-accent w-8">
              {macros.repair.toFixed(1)}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The REPAIR macro (0–10) controls the intensity of every restoration module — higher values
          apply more aggressive processing (deeper notches, lower detection thresholds, stronger
          spectral subtraction). Every module performs deterministic DSP against the loaded audio;
          every metric shown below is measured from the actual signal — no fabrication, no
          simulated processing.
        </p>
      </div>

      {/* Active module progress banner */}
      {activeModule && (
        <div className="rain-panel rounded-lg p-4 border-l-2" style={{ borderLeftColor: REPAIR_MODULES.find((m) => m.id === activeModule)?.color }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-rain-accent" />
              <span className="text-sm font-semibold">
                Running {REPAIR_MODULES.find((m) => m.id === activeModule)?.name}…
              </span>
            </div>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
          <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-rain-accent transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1">
            {progress.toFixed(0)}% · {REPAIR_MODULES.find((m) => m.id === activeModule)?.method}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="rain-panel rounded-lg p-4 border-l-2 border-red-500">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-red-400">Repair failed</div>
              <div className="text-xs text-muted-foreground mt-0.5">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Module grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPAIR_MODULES.map((mod) => {
          const isActive = activeModule === mod.id
          const isOtherActive = activeModule !== null && !isActive
          return (
            <div
              key={mod.id}
              className="rain-panel rounded-lg p-3 flex flex-col"
              style={{ borderTop: `2px solid ${mod.color}` }}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: mod.color }}
                  aria-hidden
                />
                <span className="text-[9px] font-mono uppercase text-muted-foreground">
                  {mod.id}
                </span>
              </div>
              <div className="text-xs font-semibold mb-1">{mod.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground mb-1">{mod.method}</div>
              <div className="text-[10px] text-muted-foreground leading-relaxed mb-3 flex-1">
                {mod.description}
              </div>
              <button
                onClick={() => handleRun(mod.id)}
                disabled={!fileName || activeModule !== null}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-rain-surface-2 border border-rain-border hover:border-rain-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isActive ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3" />
                )}
                {isActive
                  ? 'Processing…'
                  : isOtherActive
                    ? 'Busy'
                    : 'Run'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Last result panel — before/after + apply/reset */}
      {lastResult && (
        <ResultPanel
          result={lastResult}
          onApply={handleApply}
          onReset={handleReset}
          canReset={canReset}
        />
      )}

      {/* Apply / Reset bar — shown when a repair has been applied (canReset) and
          no pending result is open (the ResultPanel has its own apply button). */}
      {canReset && !lastResult && !activeModule && (
        <div className="rain-panel rounded-lg p-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10px] font-mono text-muted-foreground">
            Repair applied to input. Run more modules to chain, or reset to revert.
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-rain-surface-2 border border-rain-border hover:border-rain-accent/50 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Reset to original
          </button>
        </div>
      )}

      {/* Repair Spectrum Analysis — REAL measured metrics */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-rain-accent" />
            <div className="text-sm font-semibold">Repair Spectrum Analysis</div>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
            <Zap className="w-3 h-3 text-rain-accent" />
            <span>Measured from real audio · {fileName ? 'live' : 'no file loaded'}</span>
          </div>
        </div>
        {!fileName || !currentMetrics ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Load an audio file to measure repair metrics.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px] font-mono">
            <RepairMetric
              label="Noise Floor"
              before={lastResult?.metrics.before.noiseFloorDb}
              after={lastResult?.metrics.after.noiseFloorDb}
              current={currentMetrics.noiseFloorDb}
              format={(v) => `${v.toFixed(1)} dB`}
              betterIs="lower"
            />
            <RepairMetric
              label="DC Offset"
              before={lastResult?.metrics.before.dcOffsetPct}
              after={lastResult?.metrics.after.dcOffsetPct}
              current={currentMetrics.dcOffsetPct}
              format={(v) => `${v.toFixed(3)} %`}
              betterIs="lower"
            />
            <RepairMetric
              label="Clipping"
              before={lastResult?.metrics.before.clippedSamples}
              after={lastResult?.metrics.after.clippedSamples}
              current={currentMetrics.clippedSamples}
              format={(v) => `${Math.round(v)} samples`}
              betterIs="lower"
            />
            <RepairMetric
              label="Sibilance 5–8k"
              before={lastResult?.metrics.before.sibilanceDb}
              after={lastResult?.metrics.after.sibilanceDb}
              current={currentMetrics.sibilanceDb}
              format={(v) => `${v.toFixed(1)} dB`}
              betterIs="lower"
            />
            <RepairMetric
              label="Rumble < 30 Hz"
              before={lastResult?.metrics.before.rumbleDb}
              after={lastResult?.metrics.after.rumbleDb}
              current={currentMetrics.rumbleDb}
              format={(v) => `${v.toFixed(1)} dB`}
              betterIs="lower"
            />
            <RepairMetric
              label="Phase Corr."
              before={lastResult?.metrics.before.phaseCorrelation}
              after={lastResult?.metrics.after.phaseCorrelation}
              current={currentMetrics.phaseCorrelation}
              format={(v) => v.toFixed(3)}
              betterIs="higher"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result panel — shows before/after + module-specific measurements
// ---------------------------------------------------------------------------

function ResultPanel({
  result,
  onApply,
  onReset,
  canReset,
}: {
  result: RepairResult
  onApply: () => void
  onReset: () => void
  canReset: boolean
}) {
  const mod = REPAIR_MODULES.find((m) => m.id === result.moduleId)
  const specificEntries = Object.entries(result.metrics.improvement).filter(
    ([k]) => !k.endsWith('_delta'),
  )

  return (
    <div
      className="rain-panel rounded-lg p-4 border-l-2"
      style={{ borderLeftColor: mod?.color ?? '#AAFF00' }}
    >
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-rain-accent" />
          <div>
            <div className="text-sm font-semibold">{mod?.name} result</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {mod?.method} · {(result.duration / 1000).toFixed(2)}s · {result.sampleRate / 1000} kHz
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onApply}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-rain-accent text-black font-semibold hover:scale-[1.02] active:scale-95 transition-transform"
          >
            <Check className="w-3 h-3" /> Apply to master
          </button>
          {canReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-rain-surface-2 border border-rain-border hover:border-rain-accent/50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {specificEntries.length > 0 && (
        <div className="bg-rain-surface-2/60 rounded p-3 mb-3">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Module measurements
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono">
            {specificEntries.map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <span className="text-muted-foreground text-[9px]">{formatMetricLabel(k)}</span>
                <span className="text-rain-accent">{formatMetricValue(k, v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] font-mono text-muted-foreground">
        Apply this result to commit the repaired audio to the input buffer. Run additional modules
        to chain restoration passes (e.g. denoise → declip → dehum).
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Repair metric cell — shows before/after/current with color-coded status
// ---------------------------------------------------------------------------

function RepairMetric({
  label,
  before,
  after,
  current,
  format,
  betterIs,
}: {
  label: string
  before: number | undefined
  after: number | undefined
  current: number
  format: (v: number) => string
  betterIs: 'lower' | 'higher'
}) {
  // If we have a last result, show "after" (the repaired value). Otherwise show
  // the current measured value of the input buffer.
  const display = after !== undefined ? after : current
  // Status: compare to thresholds (very generous — just to color the dot)
  let status: 'good' | 'warn' | 'fail' = 'good'
  if (label.startsWith('Noise')) status = display < -70 ? 'good' : display < -55 ? 'warn' : 'fail'
  else if (label.startsWith('DC')) status = display < 0.1 ? 'good' : display < 0.5 ? 'warn' : 'fail'
  else if (label.startsWith('Clipping')) status = display === 0 ? 'good' : display < 100 ? 'warn' : 'fail'
  else if (label.startsWith('Sibilance')) status = display < -18 ? 'good' : display < -12 ? 'warn' : 'fail'
  else if (label.startsWith('Rumble')) status = display < -60 ? 'good' : display < -45 ? 'warn' : 'fail'
  else if (label.startsWith('Phase')) status = display > 0.8 ? 'good' : display > 0.3 ? 'warn' : 'fail'

  const color = status === 'good' ? '#AAFF00' : status === 'warn' ? '#F59E0B' : '#EF4444'

  // Improvement arrow: only if we have before AND after
  let improvement: number | undefined
  if (before !== undefined && after !== undefined) {
    improvement = betterIs === 'lower' ? before - after : after - before
  }

  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5 text-[9px]">{label}</div>
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span style={{ color }}>{format(display)}</span>
      </div>
      {improvement !== undefined && Math.abs(improvement) > 0.01 && (
        <div className="text-[9px] text-muted-foreground mt-0.5">
          {improvement > 0 ? '↓' : '↑'} {Math.abs(improvement).toFixed(2)} (
          {before !== undefined ? format(before) : '—'} →{' '}
          {after !== undefined ? format(after) : '—'})
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMetricLabel(key: string): string {
  // camelCase → Title Case with spaces
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function formatMetricValue(key: string, value: number): string {
  if (key.endsWith('Hz')) return `${value.toFixed(1)} Hz`
  if (key.endsWith('Db')) return `${value.toFixed(2)} dB`
  if (key.endsWith('Ms')) return `${value.toFixed(0)} ms`
  if (key.endsWith('Count') || key === 'clicksDetected' || key === 'clicksRepaired' || key === 'cracklesRemoved' || key === 'cracklesDetected' || key === 'harmonicsNotched' || key === 'resonancePeaksDetected' || key === 'resonancePeaksSuppressed' || key === 'clippedSamplesDetected' || key === 'clippedSamplesRepaired' || key === 'peaksList' || key === 'quietFramesAnalyzed') {
    return Math.round(value).toString()
  }
  if (key === 'oversubtractionFactor' || key === 'suppressionStrength' || key === 'notchDepthDb' || key === 'thresholdMarginDb' || key === 'detectionThreshold' || key === 'medianDiff' || key === 'madDiff' || key === 'hfMad') {
    return value.toFixed(3)
  }
  return value.toFixed(2)
}
