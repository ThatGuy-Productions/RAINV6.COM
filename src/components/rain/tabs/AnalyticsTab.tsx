'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Boxes,
  Clock,
  HardDrive,
  History,
  Music,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { RenderHistory } from '@/components/rain/mastering/RenderHistory'
import {
  clearAllAnalytics,
  computeActivityAggregates,
  computeAnalytics,
  computeExportAggregates,
  computeMacroEvolution,
  computeQCAggregates,
  computeStageTimingAverages,
  formatBytes,
  formatMb,
  formatMs,
  loadAllAnalytics,
  type ActivityRecord,
  type AllAnalytics,
  type EngineStats,
  type ExportRecord,
  type PlatformBreakdownEntry,
  type QCRecord,
  type RenderTelemetryRecord,
} from '@/lib/rain/analytics'
import { PLATFORM_TARGETS } from '@/lib/rain/constants'
import type { MacroKey } from '@/lib/rain/types'

const PLATFORM_COLOR: Record<string, string> = {
  spotify: '#AAFF00',
  apple_music: '#00D4FF',
  youtube: '#F97316',
  tidal: '#8B5CF6',
  cd: '#D946EF',
}

// 7 macros → stable color mapping for the evolution chart.
const MACRO_COLORS: Record<MacroKey, string> = {
  brighten: '#AAFF00',
  glue: '#00D4FF',
  width: '#F97316',
  punch: '#EF4444',
  warmth: '#F59E0B',
  space: '#8B5CF6',
  repair: '#10B981',
}

const MACRO_LABELS: Record<MacroKey, string> = {
  brighten: 'Brighten',
  glue: 'Glue',
  width: 'Width',
  punch: 'Punch',
  warmth: 'Warmth',
  space: 'Space',
  repair: 'Repair',
}

const ALL_MACROS: MacroKey[] = ['brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair']

function platformLabel(slug: string): string {
  return PLATFORM_TARGETS.find((p) => p.slug === slug)?.label ?? slug.replace(/_/g, ' ')
}

function platformColor(slug: string): string {
  return PLATFORM_COLOR[slug] ?? '#84CC16'
}

function formatTrendPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

function formatTrendScore(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}`
}

/** Human-readable label for an ActivityRecord.type. */
function activityTypeLabel(type: string): string {
  switch (type) {
    case 'undo': return 'Undo'
    case 'redo': return 'Redo'
    case 'repair': return 'Repair run'
    case 'ai-query': return 'AI Co-Master query'
    case 'render': return 'Render'
    case 'export': return 'Export'
    case 'preset-apply': return 'Preset applied'
    default: return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ')
  }
}

export function AnalyticsTab() {
  const renderHistory = useSessionStore((s) => s.renderHistory)
  const clearRenderHistory = useSessionStore((s) => s.clearRenderHistory)
  const fileSampleRate = useSessionStore((s) => s.fileSampleRate)
  const fileBitDepth = useSessionStore((s) => s.fileBitDepth)
  const fileChannels = useSessionStore((s) => s.fileChannels)
  // macroHistory is the in-memory undo/redo stack (session-only). Used for
  // the Macro Evolution chart at the bottom — honestly labelled as
  // "current session" since it's not persisted across reloads.
  const macroHistory = useSessionStore((s) => s.macroHistory)

  // Real persisted analytics — loaded from IndexedDB on mount + on every
  // statsVersion bump (post-clear or post-render).
  const [all, setAll] = useState<AllAnalytics | null>(null)
  const [statsVersion, setStatsVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadAllAnalytics().then((data) => {
      if (!cancelled) setAll(data)
    })
    return () => {
      cancelled = true
    }
  }, [statsVersion])

  // Pure computeAnalytics() over the in-memory renderHistory (last 20
  // renders, Zustand store). We overlay the persisted EngineStats from
  // IndexedDB so the Engine Utilization panel shows real cumulative numbers.
  const summary = useMemo(() => {
    const base = computeAnalytics(renderHistory)
    if (all?.engineStats) {
      base.engineStats = all.engineStats
    }
    return base
  }, [renderHistory, all, fileSampleRate, fileBitDepth, fileChannels])

  // Persisted-record aggregations — every one of these is a pure function
  // over real IndexedDB rows. Empty arrays yield zeros / empty arrays.
  const qcAgg = useMemo(
    () => computeQCAggregates(all?.qc ?? []),
    [all?.qc],
  )
  const exportAgg = useMemo(
    () => computeExportAggregates(all?.exports ?? []),
    [all?.exports],
  )
  const activityAgg = useMemo(
    () => computeActivityAggregates(all?.activity ?? []),
    [all?.activity],
  )
  const stageAgg = useMemo(
    () => computeStageTimingAverages(all?.renders ?? []),
    [all?.renders],
  )
  const macroEvolution = useMemo(
    () => computeMacroEvolution(macroHistory),
    [macroHistory],
  )

  const engineStats: EngineStats | null = all?.engineStats ?? null
  const hasRenders = renderHistory.length > 0
  const hasPersistedRenders = (all?.renders?.length ?? 0) > 0
  const hasQC = (all?.qc?.length ?? 0) > 0
  const hasExports = (all?.exports?.length ?? 0) > 0
  const hasActivity = (all?.activity?.length ?? 0) > 0
  const hasMacroHistory = macroEvolution.length >= 2

  // Engine utilization averages — REAL data only.
  const dspAvgMs = engineStats && engineStats.totalRenders > 0
    ? engineStats.totalDspTimeMs / engineStats.totalRenders
    : null
  // aiCallCount is now a real counter (incremented in recordAiStat).
  const aiCount = engineStats?.aiCallCount ?? 0
  const aiAvgMs = engineStats && engineStats.totalAiTimeMs > 0 && aiCount > 0
    ? engineStats.totalAiTimeMs / aiCount
    : null
  const exportCount = engineStats?.exportCount ?? 0
  const exportAvgMs = engineStats && exportCount > 0 && engineStats.totalExportTimeMs > 0
    ? engineStats.totalExportTimeMs / exportCount
    : null

  // KPI: "Audio Processed" replaces the fabricated "Minutes Saved" metric.
  // `summary.totalMinutes` is the real sum of every render's audio-file
  // duration in seconds / 60 — derived entirely from renderHistory.
  const totalAudioMinutes = summary.totalMinutes

  const handleClearAnalytics = async () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Clear all persisted analytics?\n\n• IndexedDB engine stats + per-render telemetry + QC history + export history + activity log will all be wiped.\n• In-memory render history will also be cleared.\n\nThis cannot be undone.',
      )
      if (!ok) return
    }
    await clearAllAnalytics()
    clearRenderHistory()
    setAll(null)
    setStatsVersion((v) => v + 1)
  }

  return (
    <div className="space-y-4">
      {/* Render History */}
      <RenderHistory />

      {/* KPI cards — every value comes from real persisted data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Music className="w-4 h-4" />}
          label="Renders (30d)"
          value={String(summary.daily.reduce((a, b) => a + b.renders, 0))}
          trend={formatTrendPct(summary.trend.rendersDeltaPct)}
          trendUp={summary.trend.rendersDeltaPct === null ? null : summary.trend.rendersDeltaPct >= 0}
          color="#AAFF00"
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          label="Audio Processed"
          value={hasRenders ? `${totalAudioMinutes.toFixed(1)}m` : '—'}
          trend={`real · ${summary.totalRenders} renders`}
          trendUp={null}
          color="#00D4FF"
        />
        <KpiCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="Avg RAIN Score"
          value={hasRenders ? summary.avgScore.toFixed(1) : '—'}
          trend={formatTrendScore(summary.trend.scoreDelta)}
          trendUp={summary.trend.scoreDelta === null ? null : summary.trend.scoreDelta >= 0}
          color="#8B5CF6"
        />
        <KpiCard
          icon={<HardDrive className="w-4 h-4" />}
          label="Storage Used"
          value={hasRenders ? formatMb(summary.totalStorageMb) : '—'}
          trend={`${fileSampleRate / 1000}k · ${fileBitDepth}-bit · ${fileChannels}ch`}
          trendUp={null}
          color="#F97316"
        />
      </div>

      {/* Empty-state banner */}
      {!hasRenders && (
        <div className="rain-panel rounded-lg p-6 text-center">
          <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <div className="text-sm font-semibold mb-1">No renders yet</div>
          <div className="text-xs text-muted-foreground">
            Run your first master to populate analytics. Every chart here derives
            from your real render history — no demo data is ever shown.
          </div>
        </div>
      )}

      {/* Daily activity chart — real per-day counts from renderHistory */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Render Activity · last 30 days
            </div>
            <div className="text-sm font-semibold">Daily renders with RAIN Score trend</div>
          </div>
          <TrendingUp className="w-4 h-4 text-rain-accent" />
        </div>
        {hasRenders ? (
          <DailyActivityChart
            days={summary.daily}
            maxRenders={Math.max(1, ...summary.daily.map((d) => d.renders))}
          />
        ) : (
          <div className="h-40 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
            No renders in the last 30 days
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* RAIN Score history — real per-render series */}
        <div className="rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">RAIN Score History</div>
            <div className="text-[9px] font-mono text-muted-foreground">
              {summary.scoreHistory.length} renders
            </div>
          </div>
          {summary.scoreHistory.length >= 2 ? (
            <ScoreHistoryChart entries={summary.scoreHistory} />
          ) : (
            <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
              Run more masters to see history
            </div>
          )}
        </div>

        {/* Platform distribution — real counts */}
        <div className="rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Platform Distribution</div>
            <div className="text-[9px] font-mono text-muted-foreground">
              {summary.platformBreakdown.length} platforms
            </div>
          </div>
          {summary.platformBreakdown.length > 0 ? (
            <div className="space-y-2">
              {summary.platformBreakdown.map((p) => (
                <PlatformRow key={p.platform} entry={p} />
              ))}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
              No data — render a master to populate platform breakdown
            </div>
          )}
        </div>
      </div>

      {/* Per-platform breakdown table */}
      {hasRenders && summary.platformBreakdown.length > 0 && (
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">Per-Platform Breakdown</div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-[9px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-rain-surface-2/95 backdrop-blur">
                <tr>
                  <th className="text-left p-2">Platform</th>
                  <th className="text-right p-2">Renders</th>
                  <th className="text-right p-2">Avg Score</th>
                  <th className="text-right p-2">Avg LUFS Δ</th>
                  <th className="text-right p-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {summary.platformBreakdown.map((p) => {
                  const targetLufs = PLATFORM_TARGETS.find((t) => t.slug === p.platform)?.targetLufs ?? null
                  return (
                    <tr key={p.platform} className="border-t border-rain-border/40">
                      <td className="p-2 flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: platformColor(p.platform) }}
                          aria-hidden
                        />
                        <span className="text-foreground">{platformLabel(p.platform)}</span>
                        {targetLufs !== null && (
                          <span className="text-muted-foreground/60">({targetLufs} LUFS)</span>
                        )}
                      </td>
                      <td className="text-right p-2 text-foreground">{p.count}</td>
                      <td className="text-right p-2 text-rain-accent">{p.avgScore.toFixed(1)}</td>
                      <td
                        className="text-right p-2"
                        style={{
                          color: Math.abs(p.avgLufsDelta) < 1 ? '#AAFF00' : Math.abs(p.avgLufsDelta) < 2 ? '#F97316' : '#EF4444',
                        }}
                      >
                        {p.avgLufsDelta >= 0 ? '+' : ''}{p.avgLufsDelta.toFixed(2)} LU
                      </td>
                      <td className="text-right p-2 text-muted-foreground">{p.pct.toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Engine Utilization — REAL timings from IndexedDB */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-rain-accent" />
          <div className="text-sm font-semibold">Engine Utilization</div>
          <div className="ml-auto text-[9px] font-mono text-muted-foreground">
            persisted · IndexedDB
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <EngineMetric
            label="DSP avg"
            value={dspAvgMs !== null ? formatMs(dspAvgMs) : '—'}
            sub={engineStats && engineStats.totalRenders > 0 ? `${engineStats.totalRenders} renders` : 'no renders yet'}
          />
          <EngineMetric
            label="AI avg"
            value={aiAvgMs !== null ? formatMs(aiAvgMs) : '—'}
            sub={aiCount > 0 ? `${aiCount} queries · ${(engineStats?.totalAiTimeMs ?? 0 / 1000).toFixed(1)}s total` : 'no AI calls yet'}
          />
          <EngineMetric
            label="Export avg"
            value={exportAvgMs !== null ? formatMs(exportAvgMs) : '—'}
            sub={exportCount > 0 ? `${exportCount} exports · ${formatBytes(engineStats?.totalExportBytes ?? 0)} total` : 'no exports yet'}
          />
          <EngineMetric
            label="Engine mode"
            value="CPU"
            sub="WebAudio · no GPU"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-rain-border/30">
          <EngineMetric
            label="Memory"
            value={summary.memoryMb !== null ? formatMb(summary.memoryMb) : 'N/A'}
            sub={summary.memoryMb !== null ? 'usedJSHeapSize' : 'not exposed'}
          />
          <EngineMetric
            label="Total DSP"
            value={engineStats ? formatMs(engineStats.totalDspTimeMs) : '—'}
            sub="cumulative"
          />
          <EngineMetric
            label="First render"
            value={engineStats?.firstRenderAt ? new Date(engineStats.firstRenderAt).toLocaleDateString() : '—'}
            sub={engineStats?.firstRenderAt ? new Date(engineStats.firstRenderAt).toLocaleTimeString() : 'never'}
          />
          <EngineMetric
            label="Last render"
            value={engineStats?.lastRenderAt ? new Date(engineStats.lastRenderAt).toLocaleDateString() : '—'}
            sub={engineStats?.lastRenderAt ? new Date(engineStats.lastRenderAt).toLocaleTimeString() : 'never'}
          />
        </div>
      </div>

      {/* Per-stage DSP time — real averages from per-render telemetry */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Per-Stage DSP Time</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Averaged across {stageAgg.sampleCount} persisted render{stageAgg.sampleCount === 1 ? '' : 's'}
            </div>
          </div>
          <Clock className="w-4 h-4 text-rain-accent" />
        </div>
        {hasPersistedRenders ? (
          <StageTimingChart averages={stageAgg.averages} />
        ) : (
          <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
            No persisted renders yet — run a master to populate per-stage timings
          </div>
        )}
      </div>

      {/* QC history — real pass / warn / fail rates from IndexedDB */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">QC Pass Rate</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {qcAgg.total} checks across {all?.qc?.length ?? 0} render{((all?.qc?.length ?? 0) === 1) ? '' : 's'}
              </div>
            </div>
            <History className="w-4 h-4 text-rain-accent" />
          </div>
          {hasQC ? (
            <QCChart
              passRate={qcAgg.passRate}
              warnRate={qcAgg.warnRate}
              failRate={qcAgg.failRate}
              topFailures={qcAgg.topFailures}
            />
          ) : (
            <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
              No QC history yet — run a master to populate QC pass/fail rates
            </div>
          )}
        </div>

        {/* Export format distribution — real per-format counts + bytes */}
        <div className="rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Export Format Distribution</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {exportAgg.total} exports · {formatBytes(exportAgg.totalBytes)} total
              </div>
            </div>
            <Boxes className="w-4 h-4 text-rain-accent" />
          </div>
          {hasExports ? (
            <ExportChart byFormat={exportAgg.byFormat} avgMs={exportAgg.avgMs} />
          ) : (
            <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
              No exports yet — export a master to populate format distribution
            </div>
          )}
        </div>
      </div>

      {/* Macro Evolution — session-only macroHistory (honestly labelled) */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Macro Evolution</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Current session · {macroEvolution.length} state{macroEvolution.length === 1 ? '' : 's'} captured · resets on reload
            </div>
          </div>
          <Activity className="w-4 h-4 text-rain-accent" />
        </div>
        {hasMacroHistory ? (
          <MacroEvolutionChart points={macroEvolution} />
        ) : (
          <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
            Adjust macros in the Mastering tab to see evolution (undo/redo history)
          </div>
        )}
      </div>

      {/* User Activity Log — real per-event records from IndexedDB */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">User Activity Log</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {activityAgg.total} event{activityAgg.total === 1 ? '' : 's'} persisted · {activityAgg.byType.length} type{activityAgg.byType.length === 1 ? '' : 's'}
            </div>
          </div>
          <Activity className="w-4 h-4 text-rain-accent" />
        </div>
        {hasActivity ? (
          <ActivityPanel
            byType={activityAgg.byType}
            recent={activityAgg.recent}
            engineStats={engineStats}
          />
        ) : (
          <div className="h-32 flex items-center justify-center text-[10px] font-mono text-muted-foreground text-center">
            No user activity recorded yet — undo/redo, run repair modules, or query the AI Co-Master to populate
          </div>
        )}
      </div>

      {/* Clear Analytics */}
      <div className="rain-panel rounded-lg p-3 flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">Reset analytics:</span>{' '}
          clears IndexedDB engine stats, per-render telemetry, QC history, export history, activity log, and in-memory render history.
        </div>
        <button
          onClick={handleClearAnalytics}
          className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/60 transition-colors"
          aria-label="Clear analytics data"
        >
          <Trash2 className="w-3 h-3" />
          Clear Analytics
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily activity chart — bars sized by real per-day render count
// ---------------------------------------------------------------------------

function DailyActivityChart({
  days,
  maxRenders,
}: {
  days: Array<{ date: string; renders: number; score: number; storageMb: number }>
  maxRenders: number
}) {
  return (
    <>
      <div className="h-40 flex items-end gap-1">
        {days.map((d, i) => {
          const h = maxRenders > 0 ? (d.renders / maxRenders) * 100 : 0
          const hasRenders = d.renders > 0
          return (
            <div key={i} className="flex-1 group relative">
              <div
                className="rounded-t transition-all"
                style={{
                  height: `${hasRenders ? Math.max(h, 4) : 2}%`,
                  background: hasRenders
                    ? 'linear-gradient(180deg, #AAFF00 0%, #84CC16 100%)'
                    : 'rgba(255,255,255,0.05)',
                  minHeight: '2px',
                  opacity: hasRenders ? 0.85 : 1,
                }}
              />
              <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block">
                <div className="bg-rain-surface-3 border border-rain-border rounded p-2 text-[10px] whitespace-nowrap shadow-xl">
                  <div className="font-mono text-muted-foreground">{d.date}</div>
                  <div className="font-mono text-rain-accent">
                    {d.renders} renders · score {d.score.toFixed(1)}
                  </div>
                  <div className="font-mono text-muted-foreground/80">
                    {formatMb(d.storageMb)} cumulative
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-2">
        <span>{days[0]?.date ?? ''}</span>
        <span>Today</span>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Score history chart — real per-render score line over time
// ---------------------------------------------------------------------------

function ScoreHistoryChart({
  entries,
}: {
  entries: Array<{ timestamp: number; score: number; platform: string }>
}) {
  const W = 300
  const H = 120
  const PAD = 8
  const minScore = 50
  const maxScore = 100

  if (entries.length < 2) return null

  const xs = entries.map((_, i) =>
    PAD + (i / (entries.length - 1)) * (W - 2 * PAD),
  )
  const ys = entries.map((e) => {
    const clamped = Math.max(minScore, Math.min(maxScore, e.score))
    return H - PAD - ((clamped - minScore) / (maxScore - minScore)) * (H - 2 * PAD)
  })

  const points = xs.map((x, i) => `${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ')
  const areaPoints = `${xs[0].toFixed(2)},${H - PAD} ${points} ${xs[xs.length - 1].toFixed(2)},${H - PAD}`

  const refLine = (score: number) => {
    const clamped = Math.max(minScore, Math.min(maxScore, score))
    return H - PAD - ((clamped - minScore) / (maxScore - minScore)) * (H - 2 * PAD)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      <defs>
        <linearGradient id="scoreFillReal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#AAFF00" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#AAFF00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD} x2={W - PAD} y1={refLine(90)} y2={refLine(90)}
        stroke="#AAFF00" strokeOpacity="0.2" strokeDasharray="2 3" />
      <line x1={PAD} x2={W - PAD} y1={refLine(75)} y2={refLine(75)}
        stroke="#F97316" strokeOpacity="0.2" strokeDasharray="2 3" />
      <polygon points={areaPoints} fill="url(#scoreFillReal)" />
      <polyline points={points} fill="none" stroke="#AAFF00" strokeWidth="2" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="2" fill="#AAFF00" />
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Platform distribution row
// ---------------------------------------------------------------------------

function PlatformRow({ entry }: { entry: PlatformBreakdownEntry }) {
  const color = platformColor(entry.platform)
  return (
    <div>
      <div className="flex justify-between text-[10px] font-mono mb-0.5">
        <span className="text-muted-foreground">{platformLabel(entry.platform)}</span>
        <span style={{ color }}>
          {entry.pct.toFixed(0)}% · {entry.count}
        </span>
      </div>
      <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${entry.pct}%`, background: color }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-0.5">
        <span>avg {entry.avgScore.toFixed(1)}</span>
        <span>
          Δ {entry.avgLufsDelta >= 0 ? '+' : ''}{entry.avgLufsDelta.toFixed(1)} LU
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-stage DSP time chart — real averages from RenderTelemetryRecord[]
// ---------------------------------------------------------------------------

function StageTimingChart({
  averages,
}: {
  averages: Array<{ id: number; name: string; avgMs: number; samples: number }>
}) {
  const maxMs = Math.max(1, ...averages.map((a) => a.avgMs))
  return (
    <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
      {averages.map((a) => {
        const pct = (a.avgMs / maxMs) * 100
        return (
          <div key={a.id} className="flex items-center gap-2 text-[10px] font-mono">
            <div className="w-6 text-muted-foreground/70 text-right shrink-0">{a.id}</div>
            <div className="w-32 text-foreground/80 truncate" title={a.name}>{a.name}</div>
            <div className="flex-1 h-3 bg-rain-surface-3 rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm transition-all"
                style={{
                  width: `${Math.max(2, pct)}%`,
                  background: 'linear-gradient(90deg, #AAFF00 0%, #84CC16 100%)',
                }}
              />
            </div>
            <div className="w-16 text-right text-rain-accent shrink-0">
              {formatMs(a.avgMs)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// QC chart — real pass/warn/fail rates + top failures
// ---------------------------------------------------------------------------

function QCChart({
  passRate,
  warnRate,
  failRate,
  topFailures,
}: {
  passRate: number
  warnRate: number
  failRate: number
  topFailures: Array<{ id: string; fails: number; occurrences: number }>
}) {
  const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`
  return (
    <div className="space-y-3">
      {/* Horizontal stacked bar */}
      <div>
        <div className="flex h-3 rounded-sm overflow-hidden bg-rain-surface-3">
          <div style={{ width: `${passRate * 100}%`, background: '#AAFF00' }} title={`Pass ${fmtPct(passRate)}`} />
          <div style={{ width: `${warnRate * 100}%`, background: '#F59E0B' }} title={`Warn ${fmtPct(warnRate)}`} />
          <div style={{ width: `${failRate * 100}%`, background: '#EF4444' }} title={`Fail ${fmtPct(failRate)}`} />
        </div>
        <div className="flex justify-between text-[9px] font-mono mt-1">
          <span className="text-rain-accent">Pass {fmtPct(passRate)}</span>
          <span className="text-orange-400">Warn {fmtPct(warnRate)}</span>
          <span className="text-red-400">Fail {fmtPct(failRate)}</span>
        </div>
      </div>
      {/* Top failures list */}
      {topFailures.length > 0 && topFailures.some((f) => f.fails > 0) && (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Most-failed checks
          </div>
          <div className="space-y-0.5">
            {topFailures
              .filter((f) => f.fails > 0)
              .map((f) => (
                <div key={f.id} className="flex justify-between text-[10px] font-mono">
                  <span className="text-foreground/80 truncate" title={f.id}>{f.id.replace(/^qc_/, '').replace(/_/g, ' ')}</span>
                  <span className="text-red-400 shrink-0 ml-2">
                    {f.fails}/{f.occurrences} fail
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export format distribution chart
// ---------------------------------------------------------------------------

function ExportChart({
  byFormat,
  avgMs,
}: {
  byFormat: Array<{ format: string; count: number; bytes: number; pct: number }>
  avgMs: number
}) {
  const maxCount = Math.max(1, ...byFormat.map((b) => b.count))
  return (
    <div className="space-y-2">
      {byFormat.map((f) => {
        const pct = (f.count / maxCount) * 100
        return (
          <div key={f.format}>
            <div className="flex justify-between text-[10px] font-mono mb-0.5">
              <span className="text-foreground/80">{f.format}</span>
              <span className="text-rain-accent">
                {f.count} · {formatBytes(f.bytes)} · {f.pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(2, pct)}%`, background: '#00D4FF' }}
              />
            </div>
          </div>
        )
      })}
      <div className="text-[9px] font-mono text-muted-foreground/70 pt-1 border-t border-rain-border/30 mt-2">
        Avg export time: {formatMs(avgMs)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Macro Evolution chart — 7-line sparkline over macroHistory indices
// ---------------------------------------------------------------------------

function MacroEvolutionChart({
  points,
}: {
  points: Array<{ index: number; macros: Record<MacroKey, number> }>
}) {
  const W = 600
  const H = 140
  const PAD = 24
  const MIN = 0
  const MAX = 10
  if (points.length < 2) return null

  const xFor = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD)
  const yFor = (v: number) => H - PAD - ((v - MIN) / (MAX - MIN)) * (H - 2 * PAD)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        {/* gridlines at 0, 5, 10 */}
        {[0, 5, 10].map((v) => (
          <line key={v} x1={PAD} x2={W - PAD} y1={yFor(v)} y2={yFor(v)}
            stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
        ))}
        {ALL_MACROS.map((key) => {
          const path = points
            .map((p, i) => `${xFor(i).toFixed(2)},${yFor(p.macros[key]).toFixed(2)}`)
            .join(' ')
          return (
            <polyline
              key={key}
              points={path}
              fill="none"
              stroke={MACRO_COLORS[key]}
              strokeWidth="1.5"
              strokeOpacity="0.85"
            />
          )
        })}
        {/* Latest-value markers */}
        {ALL_MACROS.map((key) => {
          const last = points[points.length - 1]
          return (
            <circle
              key={`dot-${key}`}
              cx={xFor(points.length - 1)}
              cy={yFor(last.macros[key])}
              r="2.5"
              fill={MACRO_COLORS[key]}
            />
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-mono mt-1">
        {ALL_MACROS.map((key) => (
          <span key={key} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: MACRO_COLORS[key] }} aria-hidden />
            <span className="text-muted-foreground">{MACRO_LABELS[key]}</span>
          </span>
        ))}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/60 mt-1">
        Macro history is in-memory (Zustand store) — it tracks every distinct
        macro state the UI displayed, including undos/redos and AI suggestions.
        Not persisted across browser reloads.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity log panel — per-type counts + recent events
// ---------------------------------------------------------------------------

function ActivityPanel({
  byType,
  recent,
  engineStats,
}: {
  byType: Array<{ type: string; count: number; lastAt: number | null }>
  recent: ActivityRecord[]
  engineStats: EngineStats | null
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {/* Per-type counts */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Activity by type
        </div>
        <div className="space-y-1">
          {byType.map((t) => (
            <div key={t.type} className="flex justify-between text-[10px] font-mono">
              <span className="text-foreground/80">{activityTypeLabel(t.type)}</span>
              <span className="text-rain-accent">{t.count}</span>
            </div>
          ))}
          {byType.length === 0 && (
            <div className="text-[10px] font-mono text-muted-foreground/60">No events recorded</div>
          )}
        </div>
        {engineStats && (
          <div className="text-[9px] font-mono text-muted-foreground/60 mt-3 pt-2 border-t border-rain-border/30">
            Undo: {engineStats.undoCount} · Redo: {engineStats.redoCount} · Repair: {engineStats.repairCount} · AI: {engineStats.aiCallCount}
          </div>
        )}
      </div>
      {/* Recent events */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Recent events
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {recent.map((r) => (
            <div key={r.id} className="text-[10px] font-mono flex justify-between gap-2">
              <span className="text-foreground/80 truncate">
                {activityTypeLabel(r.type)}
                {r.details && 'moduleId' in r.details ? ` · ${String(r.details.moduleId)}` : ''}
              </span>
              <span className="text-muted-foreground/60 shrink-0">
                {new Date(r.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  icon,
  label,
  value,
  trend,
  trendUp,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  trend: string
  trendUp: boolean | null
  color: string
}) {
  return (
    <div className="rain-panel rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ color, background: `${color}15`, border: `1px solid ${color}40` }}
        >
          {icon}
        </div>
        {trendUp !== null && (
          <span
            className="text-[10px] font-mono flex items-center gap-0.5"
            style={{ color: trendUp ? '#AAFF00' : '#F97316' }}
          >
            {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend}
          </span>
        )}
        {trendUp === null && (
          <span className="text-[10px] font-mono text-muted-foreground">{trend}</span>
        )}
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  )
}

function EngineMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div className="text-sm font-mono font-bold">{value}</div>
      <div className="text-[9px] text-muted-foreground">{sub}</div>
    </div>
  )
}
