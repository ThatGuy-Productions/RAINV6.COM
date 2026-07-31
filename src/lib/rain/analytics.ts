'use client'

/**
 * RAIN V6 — Real Analytics Engine
 *
 * Derives EVERY displayed analytics metric from actual stored data:
 *   - `renderHistory` (Zustand store, RenderLogEntry[]) — last 20 renders, in-memory
 *   - `engineStats`   (IndexedDB, single-record) — cumulative counters
 *   - `renders`       (IndexedDB) — per-render telemetry w/ 16-stage timings
 *   - `qc`            (IndexedDB) — per-render QC pass/warn/fail breakdown
 *   - `exports`       (IndexedDB) — per-export format + bytes + duration
 *   - `activity`      (IndexedDB) — undo / redo / repair / AI-query events
 *
 * NO fabricated numbers, NO Math.random, NO hardcoded sample arrays.
 * If there is no data, downstream components show "No data" / "—".
 *
 * The `RenderLogEntry.duration` field is the *audio* file duration in SECONDS
 * (not render-wall-clock time — that is tracked separately via `recordRenderStat`).
 * This makes the storage-size formula physically meaningful:
 *   bytes = duration_sec * sampleRate * bitDepth * channels / 8
 */

import type { RenderLogEntry } from './store'
import type { MacroValues } from './types'
import { PLATFORM_TARGETS, PIPELINE_STAGES } from './constants'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DailyMetric {
  /** Local date label MM-DD */
  date: string
  /** Number of renders that day */
  renders: number
  /** Audio minutes processed that day (sum of entry.duration / 60) */
  minutes: number
  /** Mean RAIN Score across that day's renders (0 if no renders) */
  score: number
  /** Cumulative storage estimate in MB (running sum across the window) */
  storageMb: number
}

export interface EngineStats {
  totalRenders: number
  totalDspTimeMs: number
  totalAiTimeMs: number
  totalExportTimeMs: number
  firstRenderAt: number | null
  lastRenderAt: number | null
  /** Number of AI Co-Master queries (incremented in recordAiStat). */
  aiCallCount: number
  /** Number of WAV/MP3/Atmos exports (incremented in recordExportDetails). */
  exportCount: number
  /** Cumulative exported bytes (incremented in recordExportDetails). */
  totalExportBytes: number
  /** Number of repair module runs (incremented in recordActivity('repair')). */
  repairCount: number
  /** Number of macro undo invocations (incremented in recordActivity('undo')). */
  undoCount: number
  /** Number of macro redo invocations (incremented in recordActivity('redo')). */
  redoCount: number
}

export interface PlatformBreakdownEntry {
  platform: string
  count: number
  avgScore: number
  avgLufsDelta: number
  pct: number
}

export interface ScoreHistoryEntry {
  timestamp: number
  score: number
  platform: string
}

// ---------------------------------------------------------------------------
// Per-event record types (persisted to IndexedDB stores)
// ---------------------------------------------------------------------------

/** One row per render — captures everything we need for analytics + audit. */
export interface RenderTelemetryRecord {
  id: string
  timestamp: number
  renderDurationMs: number
  audioDurationSec: number
  genre: string
  platform: string
  format: string
  bitDepth: number
  sampleRate: number
  channels: number
  fileName: string
  rainScore: number
  inputLufs: number
  outputLufs: number
  outputTruePeak: number
  macroValues: MacroValues
  /** Per-stage DSP time in ms (keys: 1..16, mirroring PIPELINE_STAGES ids). */
  stageTimings: Record<number, number>
}

export type QCStatus = 'pass' | 'warn' | 'fail'

export interface QCRecord {
  id: string
  timestamp: number
  renderId: string | null
  platform: string
  passCount: number
  warnCount: number
  failCount: number
  categories: Record<string, { pass: number; warn: number; fail: number }>
  checks: Array<{ id: string; status: QCStatus }>
}

export interface ExportRecord {
  id: string
  timestamp: number
  format: string
  bytes: number
  durationMs: number
  sampleRate: number
  bitDepth: number
  channels: number
  fileName: string
}

export interface ActivityRecord {
  id: string
  timestamp: number
  type: string
  details?: Record<string, unknown>
}

/**
 * P2-METERS — Most-used macro values across all render history.
 *
 * Each macro (brighten/glue/width/punch/warmth/space/repair) is reported as
 * its arithmetic mean across all logged renders, plus the most common
 * rounded-to-integer value (mode). Real aggregate of past render settings —
 * NOT a sample array, NOT random.
 */
export interface MacroUsageStats {
  /** Mean value across all logged renders, per macro key. */
  means: Record<string, number>
  /** Most common rounded value (mode), per macro key. */
  modes: Record<string, number>
  /** Number of renders the stats were derived from. */
  sampleCount: number
}

/**
 * P2-METERS — Genre distribution entry.
 * Each entry is one genre slug with its render count and share of total.
 */
export interface GenreDistributionEntry {
  genre: string
  count: number
  pct: number
}

export interface AnalyticsSummary {
  /** Last 30 days, oldest → today */
  daily: DailyMetric[]
  totalRenders: number
  avgScore: number
  totalMinutes: number
  totalStorageMb: number
  platformBreakdown: PlatformBreakdownEntry[]
  /** Chronological (oldest → newest) */
  scoreHistory: ScoreHistoryEntry[]
  /**
   * Cumulative engine counters. The pure `computeAnalytics` function returns
   * `EMPTY_ENGINE_STATS` here; the AnalyticsTab overlays the real IndexedDB
   * values via `loadEngineStats` / `loadAllAnalytics`.
   */
  engineStats: EngineStats
  memoryMb: number | null
  /** Real trend deltas: last 7d vs previous 7d (renders/score). */
  trend: {
    rendersDeltaPct: number | null
    scoreDelta: number | null
  }
  /**
   * P2-METERS: real statistics over the render history.
   *   - avgLufsLast10: arithmetic mean of `outputLufs` over the last 10
   *     renders (or all renders if fewer than 10). null when no renders.
   *   - scoreTrendDirection: 'improving' | 'declining' | 'stable' | 'insufficient'
   *     — derived from comparing the last 5 renders' scores to the previous 5.
   *   - scoreTrendDelta: signed score delta (last5 avg − prev5 avg).
   *   - macroUsage: aggregate macro-value stats (mean + mode per macro).
   *   - genreDistribution: per-genre render count + share of total.
   */
  avgLufsLast10: number | null
  scoreTrendDirection: 'improving' | 'declining' | 'stable' | 'insufficient'
  scoreTrendDelta: number | null
  macroUsage: MacroUsageStats
  genreDistribution: GenreDistributionEntry[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30

/** Store defaults — see store.ts fileSampleRate/fileBitDepth/fileChannels. */
const DEFAULT_SAMPLE_RATE = 48000
const DEFAULT_BIT_DEPTH = 24
const DEFAULT_CHANNELS = 2

export const EMPTY_ENGINE_STATS: EngineStats = {
  totalRenders: 0,
  totalDspTimeMs: 0,
  totalAiTimeMs: 0,
  totalExportTimeMs: 0,
  firstRenderAt: null,
  lastRenderAt: null,
  aiCallCount: 0,
  exportCount: 0,
  totalExportBytes: 0,
  repairCount: 0,
  undoCount: 0,
  redoCount: 0,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function mmdd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

function getPlatformTargetLufs(platform: string): number | null {
  const target = PLATFORM_TARGETS.find((p) => p.slug === platform)
  return target ? target.targetLufs : null
}

/** Audio file size estimate in MB given duration in seconds. */
function audioSizeMb(durationSec: number): number {
  return (durationSec * DEFAULT_SAMPLE_RATE * DEFAULT_BIT_DEPTH * DEFAULT_CHANNELS) / 8 / 1e6
}

function safeMemoryMb(): number | null {
  if (typeof performance === 'undefined') return null
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
  if (mem && typeof mem.usedJSHeapSize === 'number') {
    return mem.usedJSHeapSize / 1e6
  }
  return null
}

// ---------------------------------------------------------------------------
// computeAnalytics — pure function, no IO
// ---------------------------------------------------------------------------

export function computeAnalytics(renderHistory: RenderLogEntry[]): AnalyticsSummary {
  const now = new Date()
  const todayStart = startOfLocalDay(now)

  // ---- Daily window (last 30 days, oldest → today) ----
  const daily: DailyMetric[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dayStart = new Date(todayStart.getTime() - i * DAY_MS)
    const dayStartMs = dayStart.getTime()
    const dayEndMs = dayStartMs + DAY_MS

    const dayRenders = renderHistory.filter(
      (r) => r.timestamp >= dayStartMs && r.timestamp < dayEndMs,
    )
    const renders = dayRenders.length
    // duration is in SECONDS (audio). Sum → seconds; /60 → minutes.
    const minutes = dayRenders.reduce((acc, r) => acc + r.duration / 60, 0)
    const score = renders > 0
      ? dayRenders.reduce((acc, r) => acc + r.rainScore, 0) / renders
      : 0
    const dayStorageMb = dayRenders.reduce((acc, r) => acc + audioSizeMb(r.duration), 0)

    daily.push({
      date: mmdd(dayStart),
      renders,
      minutes,
      score,
      storageMb: dayStorageMb,
    })
  }

  // Make storage cumulative across the 30-day window
  let cumulative = 0
  for (const d of daily) {
    cumulative += d.storageMb
    d.storageMb = cumulative
  }

  // ---- Totals across ALL history (not just 30 days) ----
  const totalRenders = renderHistory.length
  const avgScore = totalRenders > 0
    ? renderHistory.reduce((a, b) => a + b.rainScore, 0) / totalRenders
    : 0
  const totalMinutes = renderHistory.reduce((a, b) => a + b.duration / 60, 0)
  const totalStorageMb = renderHistory.reduce((a, b) => a + audioSizeMb(b.duration), 0)

  // ---- Platform breakdown ----
  const platformMap = new Map<string, RenderLogEntry[]>()
  for (const r of renderHistory) {
    const arr = platformMap.get(r.platform) ?? []
    arr.push(r)
    platformMap.set(r.platform, arr)
  }
  const platformBreakdown: PlatformBreakdownEntry[] = Array.from(platformMap.entries())
    .map(([platform, entries]) => {
      const count = entries.length
      const entriesAvgScore = entries.reduce((a, b) => a + b.rainScore, 0) / count
      const targetLufs = getPlatformTargetLufs(platform)
      const avgLufsDelta = targetLufs !== null
        ? entries.reduce((a, b) => a + (b.outputLufs - targetLufs), 0) / count
        : 0
      const pct = totalRenders > 0 ? (count / totalRenders) * 100 : 0
      return { platform, count, avgScore: entriesAvgScore, avgLufsDelta, pct }
    })
    .sort((a, b) => b.count - a.count)

  // ---- Score history (chronological) ----
  const scoreHistory: ScoreHistoryEntry[] = renderHistory
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((r) => ({ timestamp: r.timestamp, score: r.rainScore, platform: r.platform }))

  // ---- Trend: last 7 days vs previous 7 days ----
  const last7Start = todayStart.getTime() - 7 * DAY_MS
  const prev7Start = todayStart.getTime() - 14 * DAY_MS
  const last7 = renderHistory.filter((r) => r.timestamp >= last7Start)
  const prev7 = renderHistory.filter(
    (r) => r.timestamp >= prev7Start && r.timestamp < last7Start,
  )
  const rendersDeltaPct = prev7.length > 0
    ? ((last7.length - prev7.length) / prev7.length) * 100
    : last7.length > 0 ? null : null // null = no baseline
  const last7Avg = last7.length > 0 ? last7.reduce((a, b) => a + b.rainScore, 0) / last7.length : null
  const prev7Avg = prev7.length > 0 ? prev7.reduce((a, b) => a + b.rainScore, 0) / prev7.length : null
  const scoreDelta = last7Avg !== null && prev7Avg !== null ? last7Avg - prev7Avg : null

  // ---- P2-METERS: avg LUFS over last 10 renders (real, not sample data) ----
  const sortedByTime = renderHistory.slice().sort((a, b) => a.timestamp - b.timestamp)
  const last10 = sortedByTime.slice(-10)
  const avgLufsLast10 = last10.length > 0
    ? last10.reduce((a, b) => a + b.outputLufs, 0) / last10.length
    : null

  // ---- P2-METERS: score trend direction (last 5 vs previous 5) ----
  // Compares the mean RAIN score of the most recent 5 renders against the
  // 5 renders before that. Direction is 'improving' if delta > +0.5,
  // 'declining' if delta < -0.5, 'stable' if |delta| <= 0.5, and
  // 'insufficient' if we don't have at least 5 renders in each window.
  const last5 = sortedByTime.slice(-5)
  const prev5 = sortedByTime.slice(-10, -5)
  let scoreTrendDirection: 'improving' | 'declining' | 'stable' | 'insufficient' = 'insufficient'
  let scoreTrendDelta: number | null = null
  if (last5.length === 5 && prev5.length === 5) {
    const last5Avg = last5.reduce((a, b) => a + b.rainScore, 0) / 5
    const prev5Avg = prev5.reduce((a, b) => a + b.rainScore, 0) / 5
    scoreTrendDelta = last5Avg - prev5Avg
    if (scoreTrendDelta > 0.5) scoreTrendDirection = 'improving'
    else if (scoreTrendDelta < -0.5) scoreTrendDirection = 'declining'
    else scoreTrendDirection = 'stable'
  }

  // ---- P2-METERS: most-used macro values (mean + mode per macro key) ----
  // Real aggregate over renderHistory. For each of the 7 macros, compute the
  // arithmetic mean and the mode (most common rounded-to-integer value).
  // Returns zero-filled stats when renderHistory is empty.
  const MACRO_KEYS: Array<keyof MacroValues> = [
    'brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair',
  ]
  const macroUsage: MacroUsageStats = {
    means: {},
    modes: {},
    sampleCount: renderHistory.length,
  }
  for (const key of MACRO_KEYS) {
    if (renderHistory.length === 0) {
      macroUsage.means[key] = 0
      macroUsage.modes[key] = 0
      continue
    }
    let sum = 0
    const roundedCounts = new Map<number, number>()
    for (const r of renderHistory) {
      const v = r.macroValues[key]
      sum += v
      const rounded = Math.round(v)
      roundedCounts.set(rounded, (roundedCounts.get(rounded) ?? 0) + 1)
    }
    macroUsage.means[key] = sum / renderHistory.length
    // Mode = rounded value with the highest count. Ties broken by lower value.
    let modeVal = 0
    let modeCount = -1
    for (const [val, cnt] of Array.from(roundedCounts.entries()).sort((a, b) => a[0] - b[0])) {
      if (cnt > modeCount) {
        modeCount = cnt
        modeVal = val
      }
    }
    macroUsage.modes[key] = modeVal
  }

  // ---- P2-METERS: genre distribution (real per-genre render counts) ----
  const genreMap = new Map<string, number>()
  for (const r of renderHistory) {
    genreMap.set(r.genre, (genreMap.get(r.genre) ?? 0) + 1)
  }
  const genreDistribution: GenreDistributionEntry[] = Array.from(genreMap.entries())
    .map(([genre, count]) => ({
      genre,
      count,
      pct: totalRenders > 0 ? (count / totalRenders) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    daily,
    totalRenders,
    avgScore,
    totalMinutes,
    totalStorageMb,
    platformBreakdown,
    scoreHistory,
    engineStats: { ...EMPTY_ENGINE_STATS },
    memoryMb: safeMemoryMb(),
    trend: { rendersDeltaPct, scoreDelta },
    avgLufsLast10,
    scoreTrendDirection,
    scoreTrendDelta,
    macroUsage,
    genreDistribution,
  }
}

// ---------------------------------------------------------------------------
// IndexedDB persistence for EngineStats + per-event records
// Pattern mirrors provenance.ts `withDb` — connection is closed in finally.
//
// Schema v2 (this audit) adds 4 new object stores alongside the existing
// `engineStats` single-record store:
//   - `renders`   — one row per render (telemetry + 16-stage timings)
//   - `qc`        — one row per render QC snapshot
//   - `exports`   — one row per WAV/MP3/Atmos export
//   - `activity`  — one row per user action (undo / redo / repair / ai-query)
// All stores are append-only with autoincrement numeric keys; queries use
// openCursor + collect. We don't bother with indexes — every analytics
// query walks the full list once on AnalyticsTab mount, which is cheap for
// the expected scale (hundreds of rows, not millions).
// ---------------------------------------------------------------------------

const ANALYTICS_DB = 'rain-analytics'
const STATS_STORE = 'engineStats'
const STATS_KEY = 'current'
const RENDER_STORE = 'renders'
const QC_STORE = 'qc'
const EXPORT_STORE = 'exports'
const ACTIVITY_STORE = 'activity'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ANALYTICS_DB, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      // v1 store — cumulative counters (single record, keyed 'current').
      if (!db.objectStoreNames.contains(STATS_STORE)) {
        db.createObjectStore(STATS_STORE)
      }
      // v2 stores — per-event append-only logs.
      if (!db.objectStoreNames.contains(RENDER_STORE)) {
        db.createObjectStore(RENDER_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(QC_STORE)) {
        db.createObjectStore(QC_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(EXPORT_STORE)) {
        db.createObjectStore(EXPORT_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(ACTIVITY_STORE)) {
        db.createObjectStore(ACTIVITY_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T> | T): Promise<T> {
  const db = await openDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

// Generic read-all helper for any of the v2 append-only stores. The generic
// is constrained to records with a numeric `timestamp` so the sort below
// type-checks — every record type we persist (renders / qc / exports /
// activity) has a top-level `timestamp: number` field.
function readAll<T extends { timestamp: number }>(storeName: string): Promise<T[]> {
  return withDb((db) => new Promise<T[]>((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => {
      const arr = (req.result ?? []) as T[]
      // Sort oldest → newest by timestamp for predictable aggregation.
      arr.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      resolve(arr)
    }
    req.onerror = () => reject(req.error)
  }))
}

function putRecord<T extends { id: string }>(storeName: string, record: T): Promise<void> {
  return withDb((db) => new Promise<void>((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      // DB still on v1 schema (upgrade hasn't fired for this connection).
      // Silently drop — analytics must never break the render flow.
      resolve()
      return
    }
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function clearStore(storeName: string): Promise<void> {
  return withDb((db) => new Promise<void>((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve()
      return
    }
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function newId(prefix: string): string {
  // crypto.randomUUID when available; deterministic fallback otherwise.
  // No Math.random — keeps the "no random data" guarantee (this is identity,
  // not analytics data, but the linter grep would flag Math.random anywhere).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${(typeof performance !== 'undefined' && performance.now
    ? Math.floor(performance.now() * 1000)
    : 0)}`
}

export async function loadEngineStats(): Promise<EngineStats> {
  if (typeof indexedDB === 'undefined') return { ...EMPTY_ENGINE_STATS }
  try {
    return await withDb((db) => new Promise<EngineStats>((resolve, reject) => {
      const tx = db.transaction(STATS_STORE, 'readonly')
      const store = tx.objectStore(STATS_STORE)
      const req = store.get(STATS_KEY)
      req.onsuccess = () => {
        const stored = req.result as EngineStats | undefined
        // Merge with EMPTY_ENGINE_STATS so newly-added counters default to 0
        // when reading a v1-shaped record from an older session.
        resolve({
          ...EMPTY_ENGINE_STATS,
          ...(stored ?? {}),
        })
      }
      req.onerror = () => reject(req.error)
    }))
  } catch {
    return { ...EMPTY_ENGINE_STATS }
  }
}

async function saveEngineStats(stats: EngineStats): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await withDb((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STATS_STORE, 'readwrite')
      tx.objectStore(STATS_STORE).put(stats, STATS_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
  } catch (e) {
    console.warn('[analytics] saveEngineStats failed:', e)
  }
}

/**
 * Record timing for a single render pass.
 * `dspTimeMs` = wall-clock time of the 16-stage render (Date.now diff).
 * `aiTimeMs` = optional — pass 0 here; AI-suggest timings are recorded
 *              separately via `recordAiStat` since they happen outside the
 *              render flow.
 */
export async function recordRenderStat(dspTimeMs: number, aiTimeMs = 0): Promise<EngineStats> {
  const current = await loadEngineStats()
  const now = Date.now()
  const next: EngineStats = {
    ...current,
    totalRenders: current.totalRenders + 1,
    totalDspTimeMs: current.totalDspTimeMs + Math.max(0, dspTimeMs),
    totalAiTimeMs: current.totalAiTimeMs + Math.max(0, aiTimeMs),
    firstRenderAt: current.firstRenderAt ?? now,
    lastRenderAt: now,
  }
  await saveEngineStats(next)
  return next
}

/** Record AI Co-Master suggestion latency (separate from render flow). */
export async function recordAiStat(aiTimeMs: number): Promise<EngineStats> {
  const current = await loadEngineStats()
  const next: EngineStats = {
    ...current,
    totalAiTimeMs: current.totalAiTimeMs + Math.max(0, aiTimeMs),
    aiCallCount: current.aiCallCount + 1,
  }
  await saveEngineStats(next)
  // Also append an activity record so the activity log + charts see it.
  await recordActivity('ai-query', { latencyMs: Math.max(0, aiTimeMs) }).catch(() => {
    /* swallow — analytics failure must not break AI flow */
  })
  return next
}

/** Record WAV export latency (cumulative counter only — prefer recordExportDetails). */
export async function recordExportStat(exportTimeMs: number): Promise<EngineStats> {
  const current = await loadEngineStats()
  const next: EngineStats = {
    ...current,
    totalExportTimeMs: current.totalExportTimeMs + Math.max(0, exportTimeMs),
  }
  await saveEngineStats(next)
  return next
}

// ---------------------------------------------------------------------------
// Per-event recorders — write one row to the matching IndexedDB store.
// Every recorder swallows errors so analytics can never break the user flow.
// ---------------------------------------------------------------------------

/**
 * Persist a full per-render telemetry record. Also bumps the cumulative
 * EngineStats counters (totalRenders, totalDspTimeMs) so callers don't need
 * to call recordRenderStat separately.
 */
export async function recordRenderTelemetry(
  record: Omit<RenderTelemetryRecord, 'id'>,
): Promise<RenderTelemetryRecord> {
  const full: RenderTelemetryRecord = { ...record, id: newId('render') }
  await putRecord(RENDER_STORE, full).catch((e) => {
    console.warn('[analytics] recordRenderTelemetry failed:', e)
  })
  // Bump cumulative counters atomically.
  await recordRenderStat(record.renderDurationMs, 0).catch(() => {
    /* swallow */
  })
  return full
}

/** Persist a per-render QC snapshot. */
export async function recordQCResult(
  record: Omit<QCRecord, 'id'>,
): Promise<QCRecord> {
  const full: QCRecord = { ...record, id: newId('qc') }
  await putRecord(QC_STORE, full).catch((e) => {
    console.warn('[analytics] recordQCResult failed:', e)
  })
  return full
}

/**
 * Persist a per-export record (format, bytes, latency). Also bumps the
 * cumulative EngineStats counters (exportCount, totalExportBytes,
 * totalExportTimeMs) so callers don't need to call recordExportStat separately.
 */
export async function recordExportDetails(
  record: Omit<ExportRecord, 'id'>,
): Promise<ExportRecord> {
  const full: ExportRecord = { ...record, id: newId('export') }
  await putRecord(EXPORT_STORE, full).catch((e) => {
    console.warn('[analytics] recordExportDetails failed:', e)
  })
  // Bump cumulative counters atomically.
  const current = await loadEngineStats()
  const next: EngineStats = {
    ...current,
    exportCount: current.exportCount + 1,
    totalExportBytes: current.totalExportBytes + Math.max(0, record.bytes),
    totalExportTimeMs: current.totalExportTimeMs + Math.max(0, record.durationMs),
  }
  await saveEngineStats(next).catch(() => {
    /* swallow */
  })
  return full
}

/**
 * Persist a user-activity event. Bumps the matching cumulative counter
 * (undoCount / redoCount / repairCount) when `type` is one of the recognised
 * keys; arbitrary `type` strings (e.g. 'preset-apply', 'render-start') are
 * still logged without bumping any counter.
 */
export async function recordActivity(
  type: string,
  details?: Record<string, unknown>,
): Promise<ActivityRecord> {
  const full: ActivityRecord = {
    id: newId('activity'),
    timestamp: Date.now(),
    type,
    ...(details !== undefined ? { details } : {}),
  }
  await putRecord(ACTIVITY_STORE, full).catch((e) => {
    console.warn('[analytics] recordActivity failed:', e)
  })
  // Bump matching cumulative counter so the KPI cards can show real counts
  // without re-reading the full activity log.
  if (type === 'undo' || type === 'redo' || type === 'repair') {
    const current = await loadEngineStats()
    const next: EngineStats = { ...current }
    if (type === 'undo') next.undoCount = current.undoCount + 1
    else if (type === 'redo') next.redoCount = current.redoCount + 1
    else if (type === 'repair') next.repairCount = current.repairCount + 1
    await saveEngineStats(next).catch(() => {
      /* swallow */
    })
  }
  return full
}

// ---------------------------------------------------------------------------
// Loaders — read all rows from each store (oldest → newest).
// ---------------------------------------------------------------------------

export function loadRenderTelemetry(): Promise<RenderTelemetryRecord[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return readAll<RenderTelemetryRecord>(RENDER_STORE).catch(() => [])
}

export function loadQCHistory(): Promise<QCRecord[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return readAll<QCRecord>(QC_STORE).catch(() => [])
}

export function loadExportHistory(): Promise<ExportRecord[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return readAll<ExportRecord>(EXPORT_STORE).catch(() => [])
}

export function loadActivityLog(): Promise<ActivityRecord[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([])
  return readAll<ActivityRecord>(ACTIVITY_STORE).catch(() => [])
}

/** Aggregated payload — what AnalyticsTab actually renders. */
export interface AllAnalytics {
  engineStats: EngineStats
  renders: RenderTelemetryRecord[]
  qc: QCRecord[]
  exports: ExportRecord[]
  activity: ActivityRecord[]
}

/** One-shot load of every persisted analytics stream (for AnalyticsTab mount). */
export async function loadAllAnalytics(): Promise<AllAnalytics> {
  const [engineStats, renders, qc, exports, activity] = await Promise.all([
    loadEngineStats(),
    loadRenderTelemetry(),
    loadQCHistory(),
    loadExportHistory(),
    loadActivityLog(),
  ])
  return { engineStats, renders, qc, exports, activity }
}

/** Wipe persisted engine stats back to empty (Clear Analytics button). */
export async function clearEngineStats(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await withDb((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STATS_STORE, 'readwrite')
      tx.objectStore(STATS_STORE).put({ ...EMPTY_ENGINE_STATS }, STATS_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
  } catch (e) {
    console.warn('[analytics] clearEngineStats failed:', e)
  }
}

/** Wipe ALL analytics data (cumulative stats + every per-event store). */
export async function clearAllAnalytics(): Promise<void> {
  await clearEngineStats()
  await Promise.all([
    clearStore(RENDER_STORE),
    clearStore(QC_STORE),
    clearStore(EXPORT_STORE),
    clearStore(ACTIVITY_STORE),
  ]).catch((e) => console.warn('[analytics] clearAllAnalytics partial fail:', e))
}

// ---------------------------------------------------------------------------
// Aggregations — pure functions over the loaded record arrays.
// Every output is derived from real records; empty inputs yield zeros.
// ---------------------------------------------------------------------------

export interface QCAggregates {
  total: number
  passRate: number  // 0..1 across all checks of all renders
  warnRate: number
  failRate: number
  /** Most-failed check IDs, sorted desc by fail count. */
  topFailures: Array<{ id: string; fails: number; occurrences: number }>
  /** Per-category pass/warn/fail tallies. */
  categories: Record<string, { pass: number; warn: number; fail: number }>
}

export function computeQCAggregates(qc: QCRecord[]): QCAggregates {
  if (qc.length === 0) {
    return {
      total: 0,
      passRate: 0,
      warnRate: 0,
      failRate: 0,
      topFailures: [],
      categories: {},
    }
  }
  const totals = { pass: 0, warn: 0, fail: 0 }
  const categories: Record<string, { pass: number; warn: number; fail: number }> = {}
  const failCounts = new Map<string, { fails: number; occurrences: number }>()

  // QCRecord.categories is the per-category tally for a single render;
  // QCRecord.checks is the per-check list. We use `checks` for the per-id
  // failure ranking (more granular) and `categories` for the rollup.
  for (const r of qc) {
    for (const cat of Object.keys(r.categories)) {
      const c = r.categories[cat]
      const acc = categories[cat] ?? { pass: 0, warn: 0, fail: 0 }
      acc.pass += c.pass
      acc.warn += c.warn
      acc.fail += c.fail
      categories[cat] = acc
      totals.pass += c.pass
      totals.warn += c.warn
      totals.fail += c.fail
    }
    for (const chk of r.checks) {
      const acc = failCounts.get(chk.id) ?? { fails: 0, occurrences: 0 }
      acc.occurrences += 1
      if (chk.status === 'fail') acc.fails += 1
      failCounts.set(chk.id, acc)
    }
  }
  const total = totals.pass + totals.warn + totals.fail
  const topFailures = Array.from(failCounts.entries())
    .map(([id, v]) => ({ id, fails: v.fails, occurrences: v.occurrences }))
    .sort((a, b) => b.fails - a.fails)
    .slice(0, 6)
  return {
    total,
    passRate: total > 0 ? totals.pass / total : 0,
    warnRate: total > 0 ? totals.warn / total : 0,
    failRate: total > 0 ? totals.fail / total : 0,
    topFailures,
    categories,
  }
}

export interface ExportAggregates {
  total: number
  totalBytes: number
  avgMs: number  // average export wall-clock
  /** Per-format count + byte total. */
  byFormat: Array<{ format: string; count: number; bytes: number; pct: number }>
}

export function computeExportAggregates(exports: ExportRecord[]): ExportAggregates {
  if (exports.length === 0) {
    return { total: 0, totalBytes: 0, avgMs: 0, byFormat: [] }
  }
  const total = exports.length
  const totalBytes = exports.reduce((a, b) => a + Math.max(0, b.bytes), 0)
  const totalMs = exports.reduce((a, b) => a + Math.max(0, b.durationMs), 0)
  const byFormatMap = new Map<string, { count: number; bytes: number }>()
  for (const e of exports) {
    const acc = byFormatMap.get(e.format) ?? { count: 0, bytes: 0 }
    acc.count += 1
    acc.bytes += Math.max(0, e.bytes)
    byFormatMap.set(e.format, acc)
  }
  const byFormat = Array.from(byFormatMap.entries())
    .map(([format, v]) => ({
      format,
      count: v.count,
      bytes: v.bytes,
      pct: total > 0 ? (v.count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
  return { total, totalBytes, avgMs: total > 0 ? totalMs / total : 0, byFormat }
}

export interface ActivityAggregates {
  total: number
  /** Per-type count, sorted desc. */
  byType: Array<{ type: string; count: number; lastAt: number | null }>
  /** Last N activity records for the log panel (newest first). */
  recent: ActivityRecord[]
}

export function computeActivityAggregates(
  activity: ActivityRecord[],
  recentLimit = 20,
): ActivityAggregates {
  if (activity.length === 0) {
    return { total: 0, byType: [], recent: [] }
  }
  const byTypeMap = new Map<string, { count: number; lastAt: number | null }>()
  for (const a of activity) {
    const acc = byTypeMap.get(a.type) ?? { count: 0, lastAt: null }
    acc.count += 1
    if (a.timestamp > (acc.lastAt ?? 0)) acc.lastAt = a.timestamp
    byTypeMap.set(a.type, acc)
  }
  const byType = Array.from(byTypeMap.entries())
    .map(([type, v]) => ({ type, count: v.count, lastAt: v.lastAt }))
    .sort((a, b) => b.count - a.count)
  // Recent: newest first (input is oldest → newest).
  const recent = activity.slice(-recentLimit).reverse()
  return { total: activity.length, byType, recent }
}

export interface StageTimingAverages {
  /** Per-stage average ms across all renders. */
  averages: Array<{ id: number; name: string; avgMs: number; samples: number }>
  /** Total render count used to compute the averages. */
  sampleCount: number
}

export function computeStageTimingAverages(
  renders: RenderTelemetryRecord[],
): StageTimingAverages {
  const sampleCount = renders.length
  const sums = new Map<number, number>()
  const counts = new Map<number, number>()
  for (const r of renders) {
    for (const [k, v] of Object.entries(r.stageTimings)) {
      const id = Number(k)
      if (!Number.isFinite(id)) continue
      sums.set(id, (sums.get(id) ?? 0) + Math.max(0, v))
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const averages = PIPELINE_STAGES.map((stage) => {
    const samples = counts.get(stage.id) ?? 0
    const sum = sums.get(stage.id) ?? 0
    return {
      id: stage.id,
      name: stage.name,
      avgMs: samples > 0 ? sum / samples : 0,
      samples,
    }
  })
  return { averages, sampleCount }
}

export interface MacroEvolutionPoint {
  /** Index in the macroHistory array (0-based). */
  index: number
  /** Macro values at this point. */
  macros: MacroValues
}

/**
 * Project the in-memory `macroHistory` array (Zustand, session-only) into a
 * chart-friendly series. We don't persist macroHistory to IndexedDB — it's a
 * linear undo/redo stack that resets every session, so cross-session macro
 * evolution isn't meaningful. The Analytics tab shows the current session's
 * macro trajectory, honestly labelled as such.
 */
export function computeMacroEvolution(
  macroHistory: MacroValues[],
): MacroEvolutionPoint[] {
  return macroHistory.map((macros, index) => ({ index, macros }))
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by AnalyticsTab + engine metrics)
// ---------------------------------------------------------------------------

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

export function formatMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 MB'
  if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** Format a byte count as B / KB / MB / GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
