'use client'

/**
 * RAIN V6 — Studio Status Footer (with REAL engine telemetry)
 *
 * P2-METERS: Added an expandable telemetry strip that polls
 * audioEngine.getEngineTelemetry() at 1 Hz and displays REAL measurements:
 *   - CPU/DSP load (% of wall time spent in tick loop DSP work)
 *   - Memory (performance.memory.usedJSHeapSize / 1e6 — Chromium-only)
 *   - Sample rate + AudioContext state
 *   - Buffer duration + channel count
 *   - Render queue depth (in-flight renders)
 *   - Last render wall-clock time
 *   - Per-stage timing summary (slowest stage in ms)
 *
 * Every value comes from a real measurement in the audio engine — no static
 * numbers. The footer subscribes to audio-engine state at ~30 Hz for the
 * input/output VU meters (existing), and separately polls telemetry at 1 Hz
 * (new) to avoid noisy 60 Hz updates on these slower-moving metrics.
 */

import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/lib/rain/store'
import { audioEngine, type EngineTelemetry } from '@/lib/rain/audio-engine'
import { getAnonId } from '@/lib/rain/anon-id'

/** Small VU meter bar — horizontal, 8px tall, green→yellow→red gradient */
function VuMeter({ level, label }: { level: number; label: string }) {
  const pct = Math.min(100, Math.max(0, level * 100))
  // Color: green 0-60%, yellow 60-85%, red 85-100%
  const color =
    pct > 85 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#AAFF00'

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-mono text-muted-foreground/70 w-3">{label}</span>
      <div className="w-16 h-2 rounded-full bg-rain-surface-3 overflow-hidden relative">
        {/* Background gradient track */}
        <div
          className="absolute inset-0 opacity-20 rounded-full"
          style={{
            background: 'linear-gradient(90deg, #22C55E 0%, #F59E0B 60%, #EF4444 100%)',
          }}
        />
        {/* Active fill */}
        <div
          className="h-full rounded-full transition-all duration-75 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, #22C55E 0%, ${color} 100%)`,
            boxShadow: pct > 30 ? `0 0 6px -2px ${color}40` : 'none',
          }}
        />
      </div>
    </div>
  )
}

/** Compliance badge — tiny pill with colored dot */
function ComplianceBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rain-surface-3 border border-rain-border text-[9px] font-mono text-muted-foreground">
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

/** Format a millisecond duration for compact display. */
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

/** Format a memory size in MB for compact display. */
function fmtMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return 'N/A'
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** Format a buffer duration in seconds. */
function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function StudioStatusFooter() {
  const status = useSessionStore((s) => s.status)
  const progress = useSessionStore((s) => s.progress)
  const progressLabel = useSessionStore((s) => s.progressLabel)
  const activeStage = useSessionStore((s) => s.activeStage)
  const errorCode = useSessionStore((s) => s.errorCode)
  const rainScore = useSessionStore((s) => s.rainScore)
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)

  // Real-time audio levels from audio engine (existing — 30 Hz updates)
  const [inputLevel, setInputLevel] = useState(0)
  const [outputLevel, setOutputLevel] = useState(0)

  // P2-METERS: real engine telemetry — polled at 1 Hz to avoid noisy 60 Hz
  // updates on slow-moving metrics (CPU load, memory, sample rate, etc.).
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null)
  const [telemetryOpen, setTelemetryOpen] = useState(false)
  const telemetryTimerRef = useRef<number | null>(null)

  // Analytics tracking indicator — shows the anonymous ID (first 8 chars)
  // so users can see their free-beta usage is being captured for the
  // activation/retention/funnel. Click to copy the full ID.
  // Lazy init is SSR-safe (getAnonId returns null when window is undefined);
  // on client hydration it reads localStorage, so the badge appears after
  // mount without a re-render churn.
  const [anonId] = useState<string | null>(() => getAnonId())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const unsub = audioEngine.subscribe((state) => {
      const inLvl = Math.max(state.inputLevels.left, state.inputLevels.right)
      const outLvl = Math.max(state.outputLevels.left, state.outputLevels.right)
      setInputLevel(inLvl)
      setOutputLevel(outLvl)
    })
    return unsub
  }, [])

  // Poll telemetry at 1 Hz. We use a setInterval (not RAF) because these
  // metrics change slowly and we don't want to wake the GPU on every frame.
  useEffect(() => {
    const poll = () => {
      try {
        setTelemetry(audioEngine.getEngineTelemetry())
      } catch {
        // Engine not initialized yet — leave telemetry as null.
      }
    }
    poll() // immediate first sample
    telemetryTimerRef.current = window.setInterval(poll, 1000)
    return () => {
      if (telemetryTimerRef.current !== null) {
        window.clearInterval(telemetryTimerRef.current)
        telemetryTimerRef.current = null
      }
    }
  }, [])

  // LUFS delta between input and output
  const lufsDelta =
    inputAnalysis && outputAnalysis
      ? outputAnalysis.lufs - inputAnalysis.lufs
      : null

  // Status color logic
  const statusColor =
    status === 'failed' ? '#EF4444' :
    status === 'complete' ? '#AAFF00' :
    status === 'processing' ? '#F97316' :
    '#64748B'

  const isProcessing = status === 'processing'
  const isActive = status === 'processing' || status === 'complete'

  // P2-METERS: telemetry summary for the compact footer strip.
  // Find the slowest stage from the last render's per-stage timings.
  const stageEntries = telemetry
    ? Object.entries(telemetry.stageTimings) as Array<[string, number]>
    : []
  const slowestStage = stageEntries.length > 0
    ? stageEntries.reduce((max, [id, ms]) => (ms > max[1] ? [id, ms] : max), ['0', 0])
    : null

  // Color the CPU load: green < 30%, yellow 30-60%, red > 60%.
  const cpuColor = telemetry
    ? telemetry.cpuLoadPct > 60 ? '#EF4444'
    : telemetry.cpuLoadPct > 30 ? '#F59E0B' : '#AAFF00'
    : '#64748B'

  return (
    <footer className="border-t border-rain-border bg-rain-surface">
      {/* Main status bar */}
      <div className="px-4 py-2 flex items-center justify-between gap-4 text-[11px] font-mono">
        {/* Left section: status + progress */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5">
            {/* Status dot — larger with ring when active/processing */}
            <span className="relative flex items-center justify-center">
              <span
                className={`w-2.5 h-2.5 rounded-full ${isProcessing ? 'rain-pulse' : ''}`}
                style={{ backgroundColor: statusColor }}
              />
              {(isProcessing || isActive) && (
                <span
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{
                    backgroundColor: statusColor,
                    opacity: 0.3,
                  }}
                />
              )}
            </span>
            <span className="uppercase tracking-wider text-muted-foreground">
              {status === 'idle' ? 'Ready' : status === 'failed' ? `Error ${errorCode ?? ''}` : status === 'complete' ? 'Complete' : progressLabel || status}
            </span>
          </div>

          {/* Progress bar with glow when processing */}
          {isProcessing && (
            <div className="hidden md:flex items-center gap-2">
              <div className="w-32 h-1.5 bg-rain-border rounded-full overflow-hidden relative">
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${
                    isProcessing ? 'rain-glow-pulse' : ''
                  }`}
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, #AAFF00, #84CC16)',
                  }}
                />
              </div>
              <span className="text-muted-foreground">{activeStage}/16</span>
            </div>
          )}

          {/* P2-METERS: compact telemetry toggle button */}
          <button
            onClick={() => setTelemetryOpen((v) => !v)}
            className="hidden md:flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-rain-border text-muted-foreground hover:bg-rain-surface-2 transition-colors"
            aria-expanded={telemetryOpen}
            aria-label="Toggle engine telemetry"
            title="Engine telemetry (1 Hz)"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: cpuColor }}
            />
            TELEMETRY {telemetryOpen ? '▾' : '▸'}
          </button>
        </div>

        {/* Right section: VU meters, metrics, delta, score, compliance */}
        <div className="flex items-center gap-4">
          {/* VU meters — input and output */}
          {(inputLevel > 0.001 || outputLevel > 0.001 || inputAnalysis) && (
            <div className="hidden md:flex flex-col gap-0.5">
              <VuMeter label="I" level={inputLevel} />
              <VuMeter label="O" level={outputLevel} />
            </div>
          )}

          {/* Input metrics */}
          {inputAnalysis && (
            <div className="hidden md:flex items-center gap-3 text-muted-foreground">
              <span>
                IN <span className="text-foreground">{inputAnalysis.lufs.toFixed(1)}</span> LUFS
              </span>
              <span>
                <span className="text-foreground">{inputAnalysis.truePeak.toFixed(1)}</span> dBTP
              </span>
            </div>
          )}

          {/* Output metrics */}
          {outputAnalysis && (
            <div className="hidden md:flex items-center gap-3 text-muted-foreground">
              <span className="text-rain-accent">OUT</span>
              <span>
                <span className="text-rain-accent">{outputAnalysis.lufs.toFixed(1)}</span> LUFS
              </span>
              <span>
                <span className="text-rain-accent">{outputAnalysis.truePeak.toFixed(1)}</span> dBTP
              </span>
            </div>
          )}

          {/* LUFS delta indicator */}
          {lufsDelta !== null && (
            <span
              className="hidden md:inline-flex items-center text-[10px] font-mono font-semibold"
              style={{ color: lufsDelta < 0 ? '#AAFF00' : '#F97316' }}
            >
              Δ {lufsDelta < 0 ? '' : '+'}{lufsDelta.toFixed(1)} LU
            </span>
          )}

          {/* RAIN score */}
          {rainScore && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wider">RAIN</span>
              <span className="font-bold rain-gradient-text-lime">{rainScore.overall}</span>
            </div>
          )}

          {/* Compliance badges */}
          <div className="hidden lg:flex items-center gap-1.5">
            <ComplianceBadge label="BS.1770-4" color="#AAFF00" />
            <ComplianceBadge label="C2PA v2.2" color="#8B5CF6" />
            <ComplianceBadge label="EU AI Act" color="#00D4FF" />
          </div>

          {/* Analytics tracking indicator — shows the browser's anonymous ID
              so users can verify their free-beta usage is being captured.
              Click to copy the full ID. */}
          {anonId && (
            <button
              onClick={() => {
                navigator.clipboard?.writeText(anonId).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                }).catch(() => {})
              }}
              className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rain-surface-3 border border-rain-border text-[9px] font-mono text-muted-foreground hover:border-rain-accent/50 hover:text-rain-accent transition-colors"
              title={`Anonymous analytics ID (click to copy):\n${anonId}\n\nYour renders and exports are counted in the free-beta funnel using this ID. Sign up to persist sessions to your account.`}
              aria-label="Anonymous analytics tracking ID — click to copy"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 rain-pulse"
                style={{ backgroundColor: '#AAFF00' }}
              />
              {copied ? 'COPIED' : 'ANON'}
              <span className="text-muted-foreground/60">{anonId.slice(0, 8)}</span>
            </button>
          )}
        </div>
      </div>

      {/* P2-METERS: expandable engine telemetry strip — REAL measurements. */}
      {telemetryOpen && (
        <div className="px-4 py-2 border-t border-rain-border/50 bg-rain-surface-2/50 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-1.5 text-[9px] font-mono">
          {/* CPU/DSP load */}
          <TelemetryItem
            label="CPU/DSP"
            value={telemetry ? `${telemetry.cpuLoadPct.toFixed(1)}%` : '—'}
            sub="tick loop / wall"
            color={cpuColor}
          />
          {/* Memory */}
          <TelemetryItem
            label="Memory"
            value={telemetry ? fmtMb(telemetry.memoryUsedMB) : '—'}
            sub={telemetry?.memoryUsedMB !== null && telemetry?.memoryUsedMB !== undefined ? 'usedJSHeapSize' : 'not exposed'}
          />
          {/* Sample rate + context state */}
          <TelemetryItem
            label="Ctx"
            value={telemetry ? `${(telemetry.sampleRate / 1000).toFixed(0)}k` : '—'}
            sub={telemetry?.audioContextState ?? '—'}
            color={telemetry?.audioContextState === 'running' ? '#AAFF00' : '#F59E0B'}
          />
          {/* Buffer duration */}
          <TelemetryItem
            label="Buffer"
            value={telemetry ? fmtDuration(telemetry.bufferDuration) : '—'}
            sub={telemetry ? `${telemetry.bufferChannels}ch` : '—'}
          />
          {/* Render queue depth */}
          <TelemetryItem
            label="Queue"
            value={telemetry ? String(telemetry.queuedRenders) : '—'}
            sub="queued renders"
            color={(telemetry?.queuedRenders ?? 0) > 0 ? '#F97316' : undefined}
          />
          {/* Last render time */}
          <TelemetryItem
            label="Last render"
            value={telemetry ? fmtMs(telemetry.lastRenderMs) : '—'}
            sub="wall clock"
          />
          {/* Slowest stage */}
          <TelemetryItem
            label="Slowest stage"
            value={slowestStage ? `S${slowestStage[0]}` : '—'}
            sub={slowestStage ? fmtMs(slowestStage[1]) : '—'}
          />
          {/* Total stage timings count */}
          <TelemetryItem
            label="Stage timings"
            value={telemetry ? String(stageEntries.length) : '—'}
            sub="of 16 stages"
          />
        </div>
      )}
    </footer>
  )
}

/** Compact telemetry cell — label / value / sub-label. */
function TelemetryItem({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub: string
  color?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground/70 uppercase tracking-wider">{label}</span>
      <span
        className="font-bold"
        style={{ color: color ?? '#FFFFFF' }}
      >
        {value}
      </span>
      <span className="text-muted-foreground/60">{sub}</span>
    </div>
  )
}
