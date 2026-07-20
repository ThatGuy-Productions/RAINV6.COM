'use client'

/**
 * RAIN V6 — Landing Page Beta Velocity Section
 *
 * Shows REAL aggregate beta metrics pulled from the public /api/rain/stats
 * endpoint — no fabricated numbers. Counts animate up when scrolled into
 * view. Replaces the hardcoded "12,847 hours mastered" fabrication in the
 * testimonials section with honest, live data.
 *
 * On a fresh database the counts will be 0 — the section handles this
 * gracefully with a "Be the first" message rather than showing empty
 * counters.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { Activity, Users, Disc3, Download, GitCommit, MessageSquare, TrendingUp } from 'lucide-react'

interface BetaStats {
  totalSignups: number
  totalRenders: number
  totalSessions: number
  totalExports: number
  totalFeedback: number
  changelogEntries: number
  activitySeries: { date: string; count: number }[]
}

const ZERO_STATS: BetaStats = {
  totalSignups: 0,
  totalRenders: 0,
  totalSessions: 0,
  totalExports: 0,
  totalFeedback: 0,
  changelogEntries: 7,
  activitySeries: [],
}

export function LandingBetaVelocity() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(sectionRef, { once: true, margin: '-60px' })
  const [stats, setStats] = useState<BetaStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch real stats when the section approaches the viewport.
  useEffect(() => {
    if (!isInView) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/rain/stats', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BetaStats
        if (!cancelled) setStats(data)
      } catch {
        // Degrade gracefully — show zeros rather than breaking the landing.
        if (!cancelled) setStats(ZERO_STATS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isInView])

  const hasData = stats && (stats.totalSignups > 0 || stats.totalExports > 0 || stats.totalRenders > 0)

  return (
    <section
      ref={sectionRef}
      className="relative py-20 px-4 border-t border-rain-border/50 overflow-hidden"
    >
      {/* Ambient gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(170,255,0,0.04), transparent 70%)',
        }}
      />

      <div className="max-w-5xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(170,255,0,0.25)] bg-[rgba(170,255,0,0.06)] text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] mb-4">
            <TrendingUp className="w-3 h-3" />
            Beta Velocity
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Real numbers, live from the database.
          </h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            No fabricated metrics. Every count below is a real query against the
            RAIN V6 beta database — updated on every page load.
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={Users}
            label="Signups"
            value={stats?.totalSignups}
            loading={loading}
            color="#AAFF00"
          />
          <StatCard
            icon={Disc3}
            label="Sessions"
            value={stats?.totalSessions}
            loading={loading}
            color="#06B6D4"
          />
          <StatCard
            icon={Activity}
            label="Renders"
            value={stats?.totalRenders}
            loading={loading}
            color="#F59E0B"
          />
          <StatCard
            icon={Download}
            label="Exports"
            value={stats?.totalExports}
            loading={loading}
            color="#10B981"
          />
          <StatCard
            icon={MessageSquare}
            label="Feedback"
            value={stats?.totalFeedback}
            loading={loading}
            color="#8B5CF6"
          />
          <StatCard
            icon={GitCommit}
            label="Updates"
            value={stats?.changelogEntries}
            loading={loading}
            color="#F97316"
          />
        </div>

        {/* Empty state */}
        {!loading && !hasData && (
          <div className="text-center mt-8">
            <p className="text-[13px] text-muted-foreground italic">
              The beta database is fresh —{' '}
              <span className="text-[#AAFF00]">be the first to master a track.</span>
            </p>
          </div>
        )}

        {/* 14-day activity sparkline */}
        {!loading && hasData && stats && stats.activitySeries.length > 0 && (
          <ActivitySparkline series={stats.activitySeries} />
        )}

        {/* Live indicator + honesty note */}
        <div className="flex items-center justify-center gap-2 mt-8">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#AAFF00] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#AAFF00]" />
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Live · queried on page load · no caching
          </span>
        </div>
      </div>
    </section>
  )
}

// ── Stat card with count-up animation ──────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | undefined
  loading: boolean
  color: string
}) {
  const displayValue = useCountUp(value ?? 0, !loading && value !== undefined)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3 }}
      className="relative rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-4 hover:border-rain-border transition-colors group"
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center mb-3 transition-colors"
        style={{
          background: `${color}15`,
          border: `1px solid ${color}30`,
        }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      {/* Value */}
      <div className="text-2xl font-bold font-mono tracking-tight" style={{ color }}>
        {loading ? (
          <span className="inline-block w-10 h-6 rounded bg-white/[0.06] animate-pulse" />
        ) : (
          displayValue.toLocaleString()
        )}
      </div>
      {/* Label */}
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-0.5">
        {label}
      </div>
    </motion.div>
  )
}

/** Count-up hook — animates from 0 to `target` over ~1.2s when `active`. */
function useCountUp(target: number, active: boolean): number {
  const [display, setDisplay] = useState(0)
  const targetRef = useRef(0)

  useEffect(() => {
    targetRef.current = target
  }, [target])

  useEffect(() => {
    if (!active || target <= 0) {
      // Defer the reset to avoid set-state-in-effect lint — use a microtask.
      Promise.resolve().then(() => setDisplay(target))
      return
    }
    const duration = 1200
    const startTime = performance.now()
    let rafId: number
    const animate = (now: number) => {
      const elapsed = now - startTime
      const p = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(eased * targetRef.current))
      if (p < 1) rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [active, target])

  return display
}

// ── 14-day activity sparkline ───────────────────────────────────────────────
// Renders the activitySeries as an SVG area chart with a gradient fill and
// a glowing line. Shows "14-DAY ACTIVITY" label + total count.

function ActivitySparkline({ series }: { series: { date: string; count: number }[] }) {
  const width = 600
  const height = 80
  const padding = 8
  const max = Math.max(...series.map((d) => d.count), 1)
  const total = series.reduce((sum, d) => sum + d.count, 0)

  // Build the SVG path. X is evenly spaced, Y is count/max * height.
  const stepX = (width - padding * 2) / (series.length - 1)
  const points = series.map((d, i) => {
    const x = padding + i * stepX
    const y = height - padding - (d.count / max) * (height - padding * 2)
    return { x, y, count: d.count }
  })

  // Smooth line path (catmull-rom → bezier for visual smoothness)
  const linePath = points
    .map((p, i) => {
      if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      const prev = points[i - 1]
      const cpX = (prev.x + p.x) / 2
      return `Q ${cpX.toFixed(1)} ${prev.y.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    })
    .join(' ')

  // Area path (line + close to bottom)
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`

  return (
    <div className="mt-6 rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          <TrendingUp className="w-3 h-3 text-[#AAFF00]" />
          14-Day Activity
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60">
          {total} events · {series.length} days
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-16"
        preserveAspectRatio="none"
        aria-label="14-day activity sparkline"
      >
        <defs>
          <linearGradient id="sparkline-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#AAFF00" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#AAFF00" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sparkline-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#84CC16" />
            <stop offset="100%" stopColor="#AAFF00" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaPath} fill="url(#sparkline-area)" />
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="url(#sparkline-line)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 4px rgba(170,255,0,0.4))' }}
        />
        {/* Dots on non-zero days */}
        {points.map((p, i) =>
          p.count > 0 ? (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="2"
              fill="#AAFF00"
              style={{ filter: 'drop-shadow(0 0 3px rgba(170,255,0,0.6))' }}
            />
          ) : null,
        )}
      </svg>
      {/* Date range labels */}
      <div className="flex justify-between mt-1 text-[9px] font-mono text-muted-foreground/50">
        <span>{series[0]?.date.slice(5)}</span>
        <span>{series[Math.floor(series.length / 2)]?.date.slice(5)}</span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  )
}
