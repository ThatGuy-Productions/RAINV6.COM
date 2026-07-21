'use client'

/**
 * RAIN V6 — AdminConsole (Enterprise Admin Door, Task ADMIN-DOOR-2)
 *
 * Full-screen overlay panel shown to Enterprise-tier admins. Renders real
 * system statistics + account list + recent renders pulled live from the
 * enterprise-gated admin API routes built in ADMIN-DOOR-1. The admin can
 * change any account's tier inline (PATCH /api/rain/admin/accounts/[id]/tier)
 * with optimistic UI + revert on error + sonner toast.
 *
 * No Math.random, no fabricated numbers — every value comes from a real
 * API response. Empty states are explicit ("No accounts yet", etc.).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import {
  ShieldCheck,
  Lock,
  LogOut,
  RefreshCw,
  X,
  Users,
  Disc3,
  Activity,
  Clock,
  TrendingUp,
  Database,
  Server,
  AlertCircle,
  Cpu,
  Zap,
  Music2,
  KeyRound,
  Sparkles,
  Filter,
} from 'lucide-react'

// ----------------------------------------------------------------------------
// Types (mirror the verified API response shapes from ADMIN-DOOR-1)
// ----------------------------------------------------------------------------

interface AdminConsoleProps {
  onClose: () => void
}

interface TierBreakdownRow {
  slug: string
  name: string
  accent: string
  count: number
}

interface StatsResponse {
  totals: {
    accounts: number
    renders: number
    sessions: number
    inferenceJobs: number
    activeSessions: number
  }
  tierBreakdown: TierBreakdownRow[]
  renderFormats: { format: string; count: number }[]
  renderVelocity: { last24h: number; last7d: number; last30d: number }
  sessionStatuses: { status: string; count: number }[]
  jobStatuses: { status: string; count: number }[]
  renderTimeMs: { avg: number | null; max: number | null }
  actor: { id: string; tier: string }
  generatedAt: string
  /** Beta analytics — activation/retention/funnel/feature-depth.
   *  May be absent on older snapshots; rendered defensively. */
  beta?: {
    activation: {
      totalSignups: number
      activatedUsers: number
      activationRate: number
      medianHoursToActivation: number | null
    }
    retention: { day: number; eligible: number; retained: number; rate: number }[]
    funnel: {
      signups: number
      sessionsCreated: number
      rendersCompleted: number
      exportsCompleted: number
      anonymousSessions: number
      anonymousRenders: number
      anonymousExports: number
    }
    avgFeatureDepth: number
  } | null
}

interface Account {
  id: string
  email: string
  name: string | null
  tier: string
  createdAt: string
  updatedAt: string
  renderCount: number
  activeTokens: number
  lastRenderAt: string | null
}

interface AccountsResponse {
  accounts: Account[]
  actor: { id: string; tier: string }
}

interface RenderRow {
  id: string
  sessionId: string
  userId: string
  userEmail: string
  userName: string | null
  userTier: string
  format: string
  loudnessLufs: number | null
  truePeakDbfs: number | null
  renderTimeMs: number | null
  outputFileHash: string | null
  createdAt: string
}

interface RendersResponse {
  renders: RenderRow[]
  actor: { id: string; tier: string }
}

interface TierPatchResponse {
  user: Account
  actor: { id: string; tier: string }
}

// ----------------------------------------------------------------------------
// Tier metadata (used as a fallback if the stats payload omits a tier row,
// and as the canonical list for the inline tier Select dropdown)
// ----------------------------------------------------------------------------

const TIER_ACCENTS: Record<string, string> = {
  casual: '#64748B',
  creator: '#06B6D4',
  independent: '#AAFF00',
  producer: '#F97316',
  studio: '#8B5CF6',
  label: '#D946EF',
  enterprise: '#10B981',
}

const TIER_NAMES: Record<string, string> = {
  casual: 'Casual',
  creator: 'Creator',
  independent: 'Independent',
  producer: 'Producer',
  studio: 'Studio',
  label: 'Label',
  enterprise: 'Enterprise',
}

const TIER_SLUGS = [
  'casual',
  'creator',
  'independent',
  'producer',
  'studio',
  'label',
  'enterprise',
] as const

function tierAccent(slug: string): string {
  return TIER_ACCENTS[slug] ?? '#94A3B8'
}

function tierName(slug: string): string {
  return TIER_NAMES[slug] ?? slug
}

// ----------------------------------------------------------------------------
// Formatting helpers
// ----------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 0) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

function formatLufs(v: number | null): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v.toFixed(1)} LUFS`
}

function formatDb(v: number | null): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v.toFixed(1)} dB`
}

function shortHash(hash: string | null): string {
  if (!hash) return '—'
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function TierBadge({ tier, className = '' }: { tier: string; className?: string }) {
  const accent = tierAccent(tier)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${className}`}
      style={{
        color: accent,
        borderColor: `${accent}55`,
        backgroundColor: `${accent}14`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: accent }} />
      {tierName(tier)}
    </span>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  loading,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  value: number | string
  sublabel?: string
  loading?: boolean
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-rain-border/60 bg-rain-surface-2/60 p-5 transition-colors hover:border-rain-accent/40">
      <div
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-[0.07] blur-2xl transition-opacity group-hover:opacity-[0.15]"
        style={{ backgroundColor: '#AAFF00' }}
      />
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 text-rain-accent" />
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <span className="font-mono text-3xl font-semibold tabular-nums text-white">
            {value}
          </span>
        )}
      </div>
      {sublabel ? (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">{sublabel}</div>
      ) : null}
    </div>
  )
}

function VelocityTile({
  label,
  value,
  loading,
}: {
  label: string
  value: number
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border border-rain-border/50 bg-white/[0.02] p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
          {value}
        </div>
      )}
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">renders</div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
  right,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  title: string
  hint?: string
  right?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-rain-accent" />
        <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
        {hint ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {hint}
          </span>
        ) : null}
      </div>
      {right}
    </div>
  )
}

function EmptyState({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/60">
      <Icon className="size-6" />
      <div className="font-mono text-xs">{label}</div>
    </div>
  )
}

/** A single horizontal bar in the beta conversion funnel.
 *  Shows the step label, a proportional bar (auth portion solid + anonymous
 *  portion hatched), and the numeric count. `anon` is a subset of `value`. */
function BetaFunnelBar({
  label,
  value,
  anon,
  max,
  color,
}: {
  label: string
  value: number
  anon?: number
  max: number
  color: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const anonCount = anon ?? 0
  const authCount = value - anonCount
  const anonPct = value > 0 ? (anonCount / value) * 100 : 0
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="font-mono text-[10px] text-muted-foreground w-32 flex-shrink-0 truncate">
        {label}
      </span>
      <div className="flex-1 h-5 rounded-md bg-rain-surface-3 overflow-hidden relative">
        {/* Authenticated portion (solid) */}
        <div
          className="h-full transition-all duration-300 flex items-center justify-end pr-1.5"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}40, ${color})`,
          }}
        >
          {authCount > 0 && (
            <span className="font-mono text-[9px] font-bold text-black/80">{authCount}</span>
          )}
        </div>
        {/* Anonymous portion overlay (hatched pattern indicator) */}
        {anonCount > 0 && (
          <div
            className="absolute top-0 h-full transition-all duration-300 flex items-center justify-end pr-1.5"
            style={{
              left: `${pct - (pct * anonPct) / 100}%`,
              width: `${(pct * anonPct) / 100}%`,
              background: `repeating-linear-gradient(45deg, ${color}30, ${color}30 3px, ${color}15 3px, ${color}15 6px)`,
              borderLeft: `1px dashed ${color}60`,
            }}
          >
            <span className="font-mono text-[9px] font-bold text-white/70">{anonCount}</span>
          </div>
        )}
      </div>
      <span className="font-mono text-[10px] font-bold w-8 text-right flex-shrink-0">{value}</span>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export function AdminConsole({ onClose }: AdminConsoleProps) {
  const { user, isEnterprise, logout } = useAuth()

  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [renders, setRenders] = useState<RenderRow[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tierPatchingId, setTierPatchingId] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)

  // ---- Data fetching ----

  const fetchAll = useCallback(async (markRefreshing = false) => {
    if (markRefreshing) setRefreshing(true)
    try {
      const [statsRes, accountsRes, rendersRes] = await Promise.all([
        fetch('/api/rain/admin/stats', { cache: 'no-store' }),
        fetch('/api/rain/admin/accounts', { cache: 'no-store' }),
        fetch('/api/rain/admin/renders?limit=50', { cache: 'no-store' }),
      ])
      if (!statsRes.ok || !accountsRes.ok || !rendersRes.ok) {
        const failing = [
          statsRes.ok ? null : 'stats',
          accountsRes.ok ? null : 'accounts',
          rendersRes.ok ? null : 'renders',
        ]
          .filter(Boolean)
          .join(', ')
        throw new Error(`Failed to load: ${failing}`)
      }
      const [s, a, r] = (await Promise.all([
        statsRes.json(),
        accountsRes.json(),
        rendersRes.json(),
      ])) as [StatsResponse, AccountsResponse, RendersResponse]
      setStats(s)
      setAccounts(a.accounts ?? [])
      setRenders(r.renders ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    void fetchAll(false)
  }, [fetchAll])

  // 30s polling for stats only (keeps the overview live without thrashing
  // the accounts/renders tables).
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/rain/admin/stats', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as StatsResponse
          setStats(data)
        }
      } catch {
        // silent — polling failures don't surface to the user
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [polling])

  // ---- Actions ----

  const handleRefresh = useCallback(() => {
    void fetchAll(true)
  }, [fetchAll])

  const handleLogout = useCallback(async () => {
    await logout()
    onClose()
  }, [logout, onClose])

  const handleTierChange = useCallback(
    async (accountId: string, newTier: string, oldTier: string) => {
      if (newTier === oldTier) return
      // Optimistic update
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, tier: newTier } : a)),
      )
      setTierPatchingId(accountId)
      try {
        const res = await fetch(
          `/api/rain/admin/accounts/${encodeURIComponent(accountId)}/tier`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier: newTier }),
          },
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as TierPatchResponse
        // Apply canonical tier + updatedAt from server
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === accountId
              ? { ...a, tier: data.user.tier, updatedAt: data.user.updatedAt }
              : a,
          ),
        )
        toast.success('Tier updated', {
          description: `${shortId(accountId)} → ${tierName(newTier)}`,
        })
      } catch (e) {
        // Revert optimistic update
        setAccounts((prev) =>
          prev.map((a) => (a.id === accountId ? { ...a, tier: oldTier } : a)),
        )
        toast.error('Tier change failed', {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      } finally {
        setTierPatchingId(null)
      }
    },
    [],
  )

  // ---- Derived ----

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [accounts],
  )

  const tierBreakdown: TierBreakdownRow[] = useMemo(() => {
    if (stats?.tierBreakdown && stats.tierBreakdown.length > 0) {
      return stats.tierBreakdown
    }
    // Fallback (only used while stats are still loading) — zero counts.
    return TIER_SLUGS.map((slug) => ({
      slug,
      name: tierName(slug),
      accent: tierAccent(slug),
      count: 0,
    }))
  }, [stats])

  const maxTierCount = useMemo(
    () => Math.max(1, ...tierBreakdown.map((t) => t.count)),
    [tierBreakdown],
  )

  // ---- Auth gate (parent gates it, but be defensive) ----
  if (!isEnterprise || !user) return null

  // ---- Render ----

  const totals = stats?.totals
  const velocity = stats?.renderVelocity
  const renderTime = stats?.renderTimeMs

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(10,12,16,0.98)] backdrop-blur-xl">
      {/* Custom scrollbar styling (scoped via .rain-admin-scroll) */}
      <style>{`
        .rain-admin-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .rain-admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .rain-admin-scroll::-webkit-scrollbar-thumb {
          background: rgba(170, 255, 0, 0.18);
          border-radius: 4px;
        }
        .rain-admin-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(170, 255, 0, 0.32);
        }
        .rain-admin-scroll { scrollbar-width: thin; scrollbar-color: rgba(170,255,0,0.2) transparent; }
        @keyframes rain-pulse-dot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(170,255,0,0.6); }
          50% { opacity: 0.55; box-shadow: 0 0 0 4px rgba(170,255,0,0); }
        }
        .rain-pulse-dot { animation: rain-pulse-dot 1.8s ease-in-out infinite; }
      `}</style>

      {/* ============ HEADER ============ */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-rain-border/60 bg-rain-surface/80 px-6 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex size-9 items-center justify-center rounded-lg border border-rain-accent/40 bg-rain-accent/10">
            <ShieldCheck className="size-4 text-rain-accent" />
            <Lock className="absolute -bottom-1 -right-1 size-3 text-rain-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-tight text-white">
                RAIN Enterprise Console
              </h1>
              <span className="inline-flex items-center gap-1 rounded border border-rain-accent/40 bg-rain-accent/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-rain-accent">
                <span className="size-1 rounded-full bg-rain-accent" />
                Enterprise
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Admin Door · Task ADMIN-DOOR-2
            </div>
          </div>
        </div>

        {/* Center: actor identity */}
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 md:flex">
          <div className="flex items-center gap-2 rounded-lg border border-rain-border/60 bg-white/[0.02] px-3 py-1.5">
            <KeyRound className="size-3 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-white/90">{user.email}</span>
            <TierBadge tier={user.tier} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live polling indicator */}
          {polling ? (
            <span
              className="hidden items-center gap-1.5 rounded border border-rain-accent/30 bg-rain-accent/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-rain-accent sm:inline-flex"
              title="Auto-refresh every 30s"
            >
              <span className="rain-pulse-dot size-1.5 rounded-full bg-rain-accent" />
              Live
            </span>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border-rain-border/60 bg-white/[0.02] text-white/90 hover:bg-white/[0.05] hover:text-white"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="border-rain-border/60 bg-white/[0.02] text-white/90 hover:bg-white/[0.05] hover:text-white"
          >
            <LogOut className="size-3.5" />
            Logout
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:bg-white/[0.05] hover:text-white"
            aria-label="Close admin console"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* ============ MAIN SCROLL AREA ============ */}
      <div className="rain-admin-scroll flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1400px] space-y-8">
          {/* Error state */}
          {error ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-red-500/40 bg-red-500/[0.04] p-12 text-center">
              <AlertCircle className="size-8 text-red-400" />
              <div>
                <div className="text-sm font-semibold text-white">Failed to load admin data</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{error}</div>
              </div>
              <Button
                variant="outline"
                onClick={handleRefresh}
                className="border-rain-border/60 bg-white/[0.02] text-white hover:bg-white/[0.05]"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : null}

          {/* ============ OVERVIEW STAT CARDS ============ */}
          <section>
            <SectionHeader
              icon={Activity}
              title="System Overview"
              hint={
                stats?.generatedAt
                  ? `updated ${formatRelativeTime(stats.generatedAt)}`
                  : undefined
              }
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                icon={Users}
                label="Accounts"
                value={totals?.accounts ?? 0}
                loading={loading && !stats}
              />
              <StatCard
                icon={Disc3}
                label="Renders"
                value={totals?.renders ?? 0}
                loading={loading && !stats}
              />
              <StatCard
                icon={Music2}
                label="Sessions"
                value={totals?.sessions ?? 0}
                loading={loading && !stats}
              />
              <StatCard
                icon={Server}
                label="Active Sessions"
                value={totals?.activeSessions ?? 0}
                loading={loading && !stats}
                sublabel="live auth tokens"
              />
            </div>
          </section>

          {/* ============ TIER BREAKDOWN ============ */}
          <section>
            <SectionHeader
              icon={Users}
              title="Tier Breakdown"
              hint={`${tierBreakdown.reduce((sum, t) => sum + t.count, 0)} accounts`}
            />
            <div className="rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-5">
              {loading && !stats ? (
                <div className="space-y-3">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {tierBreakdown.map((tier) => {
                    const widthPct = (tier.count / maxTierCount) * 100
                    return (
                      <div key={tier.slug} className="flex items-center gap-3">
                        <div className="w-28 shrink-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: tier.accent }}
                            />
                            <span className="text-xs font-medium text-white/90">
                              {tier.name}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground/60">
                            {tier.slug}
                          </div>
                        </div>
                        <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-white/5 bg-white/[0.02]">
                          <div
                            className="flex h-full items-center justify-end rounded-md px-2 transition-all duration-500"
                            style={{
                              width: `${Math.max(widthPct, tier.count > 0 ? 8 : 0)}%`,
                              backgroundColor: `${tier.accent}22`,
                              boxShadow: `inset 0 0 0 1px ${tier.accent}55`,
                            }}
                          >
                            <span
                              className="font-mono text-xs font-semibold tabular-nums"
                              style={{ color: tier.accent }}
                            >
                              {tier.count}
                            </span>
                          </div>
                          {tier.count === 0 ? (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground/40">
                              0
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ============ RENDER VELOCITY + RENDER TIME ============ */}
          <section>
            <SectionHeader
              icon={TrendingUp}
              title="Render Velocity"
              hint="real render counts by window"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <VelocityTile
                label="Last 24 hours"
                value={velocity?.last24h ?? 0}
                loading={loading && !stats}
              />
              <VelocityTile
                label="Last 7 days"
                value={velocity?.last7d ?? 0}
                loading={loading && !stats}
              />
              <VelocityTile
                label="Last 30 days"
                value={velocity?.last30d ?? 0}
                loading={loading && !stats}
              />
              <div className="rounded-lg border border-rain-border/50 bg-white/[0.02] p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Clock className="size-3" />
                  Render Time
                </div>
                {loading && !stats ? (
                  <Skeleton className="mt-2 h-7 w-24" />
                ) : (
                  <div className="mt-1 flex items-baseline gap-3">
                    <div>
                      <span className="font-mono text-lg font-semibold tabular-nums text-white">
                        {formatMs(renderTime?.avg ?? null)}
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground/70">avg</span>
                    </div>
                    <div className="text-muted-foreground/40">/</div>
                    <div>
                      <span className="font-mono text-sm tabular-nums text-white/70">
                        {formatMs(renderTime?.max ?? null)}
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground/70">max</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ============ ACCOUNTS TABLE ============ */}
          <section>
            <SectionHeader
              icon={Users}
              title="Accounts"
              hint={`${sortedAccounts.length} total · sorted by created desc`}
              right={
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  inline tier editor
                </span>
              }
            />
            <div className="overflow-hidden rounded-xl border border-rain-border/60 bg-rain-surface-2/40">
              <div className="rain-admin-scroll max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-[1] bg-rain-surface-2/95 backdrop-blur">
                    <TableRow className="border-rain-border/60 hover:bg-transparent">
                      <TableHead className="pl-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Email
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Tier
                      </TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Renders
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Last Render
                      </TableHead>
                      <TableHead className="pr-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Created
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`skel-${i}`} className="border-rain-border/30">
                          {Array.from({ length: 5 }).map((__, j) => (
                            <TableCell key={j} className="py-3">
                              <Skeleton className="h-5 w-full max-w-[160px]" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : sortedAccounts.length === 0 ? (
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableCell colSpan={5} className="py-0">
                          <EmptyState icon={Users} label="No accounts yet" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedAccounts.map((acct) => (
                        <TableRow
                          key={acct.id}
                          className="border-rain-border/30 hover:bg-white/[0.02]"
                        >
                          <TableCell className="py-2.5 pl-4">
                            <div className="flex flex-col">
                              <span className="font-mono text-xs text-white/90">
                                {acct.email}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground/60">
                                {shortId(acct.id)}
                                {acct.name ? ` · ${acct.name}` : ''}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <Select
                                value={acct.tier}
                                disabled={tierPatchingId === acct.id}
                                onValueChange={(v) =>
                                  void handleTierChange(acct.id, v, acct.tier)
                                }
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="h-7 w-[150px] gap-1.5 border-rain-border/60 bg-white/[0.02] px-2 font-mono text-[11px] uppercase tracking-wider"
                                  style={{
                                    color: tierAccent(acct.tier),
                                    borderColor: `${tierAccent(acct.tier)}55`,
                                  }}
                                >
                                  <span
                                    className="size-1.5 rounded-full"
                                    style={{ backgroundColor: tierAccent(acct.tier) }}
                                  />
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-rain-border/70 bg-rain-surface-2 font-mono text-xs">
                                  {TIER_SLUGS.map((slug) => (
                                    <SelectItem
                                      key={slug}
                                      value={slug}
                                      className="gap-2 uppercase tracking-wider data-[highlighted]:bg-rain-accent/10"
                                      style={{ color: tierAccent(slug) }}
                                    >
                                      <span
                                        className="size-1.5 rounded-full"
                                        style={{ backgroundColor: tierAccent(slug) }}
                                      />
                                      {tierName(slug)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {tierPatchingId === acct.id ? (
                                <RefreshCw className="size-3 animate-spin text-rain-accent" />
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <span className="font-mono text-xs tabular-nums text-white/90">
                              {acct.renderCount}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {formatRelativeTime(acct.lastRenderAt)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 pr-4">
                            <span
                              className="font-mono text-[11px] text-muted-foreground"
                              title={formatDateTime(acct.createdAt)}
                            >
                              {formatRelativeTime(acct.createdAt)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>

          {/* ============ RECENT RENDERS TABLE ============ */}
          <section>
            <SectionHeader
              icon={Disc3}
              title="Recent Renders"
              hint={`${renders.length} shown · across all users`}
              right={
                stats?.totals ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {stats.totals.renders} total in system
                  </span>
                ) : null
              }
            />
            <div className="overflow-hidden rounded-xl border border-rain-border/60 bg-rain-surface-2/40">
              <div className="rain-admin-scroll max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-[1] bg-rain-surface-2/95 backdrop-blur">
                    <TableRow className="border-rain-border/60 hover:bg-transparent">
                      <TableHead className="pl-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Email
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Tier
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Format
                      </TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        LUFS
                      </TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        True Peak
                      </TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Render Time
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Output Hash
                      </TableHead>
                      <TableHead className="pr-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        Created
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`rskel-${i}`} className="border-rain-border/30">
                          {Array.from({ length: 8 }).map((__, j) => (
                            <TableCell key={j} className="py-3">
                              <Skeleton className="h-5 w-full max-w-[120px]" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : renders.length === 0 ? (
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableCell colSpan={8} className="py-0">
                          <EmptyState icon={Disc3} label="No renders yet" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      renders.map((r) => (
                        <TableRow
                          key={r.id}
                          className="border-rain-border/30 hover:bg-white/[0.02]"
                        >
                          <TableCell className="py-2.5 pl-4">
                            <div className="flex flex-col">
                              <span className="font-mono text-xs text-white/90">
                                {r.userEmail}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground/60">
                                {shortId(r.id)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <TierBadge tier={r.userTier} />
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className="inline-flex items-center rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/80">
                              {r.format || '—'}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums text-white/90">
                            {formatLufs(r.loudnessLufs)}
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums text-white/90">
                            {formatDb(r.truePeakDbfs)}
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums text-white/90">
                            {formatMs(r.renderTimeMs)}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span
                              className="font-mono text-[10px] text-muted-foreground/70"
                              title={r.outputFileHash ?? ''}
                            >
                              {shortHash(r.outputFileHash)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 pr-4">
                            <span
                              className="font-mono text-[11px] text-muted-foreground"
                              title={formatDateTime(r.createdAt)}
                            >
                              {formatRelativeTime(r.createdAt)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>

          {/* ============ BETA ANALYTICS (activation / retention / funnel) ============ */}
          {stats?.beta && (
            <section>
              <SectionHeader
                icon={Sparkles}
                title="Beta Analytics"
                hint="activation · retention · funnel · feature depth"
                right={
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    depth {stats.beta.avgFeatureDepth.toFixed(1)} tabs/user
                  </span>
                }
              />
              <div className="grid gap-3 md:grid-cols-2">
                {/* Activation card */}
                <div className="rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      Activation (7-day)
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      export within 7d of signup
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-bold rain-gradient-text-lime">
                      {(stats.beta.activation.activationRate * 100).toFixed(0)}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {stats.beta.activation.activatedUsers}/{stats.beta.activation.totalSignups} users
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 font-mono">
                    median time-to-activation:{' '}
                    {stats.beta.activation.medianHoursToActivation !== null
                      ? `${stats.beta.activation.medianHoursToActivation.toFixed(1)}h`
                      : '—'}
                  </div>
                </div>

                {/* Retention card */}
                <div className="rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      Retention cohorts
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      day-N return rate
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {stats.beta.retention.length === 0 && (
                      <div className="text-[11px] text-muted-foreground/60 italic">
                        No cohort data yet — needs signups + elapsed time.
                      </div>
                    )}
                    {stats.beta.retention.map((c) => (
                      <div key={c.day} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground w-12 flex-shrink-0">
                          D{c.day}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-rain-surface-3 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, c.rate * 100)}%`,
                              background:
                                c.rate > 0.4
                                  ? 'linear-gradient(90deg,#AAFF00,#84CC16)'
                                  : c.rate > 0.15
                                    ? 'linear-gradient(90deg,#F59E0B,#F97316)'
                                    : '#64748B',
                            }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground w-16 text-right flex-shrink-0">
                          {c.retained}/{c.eligible}
                        </span>
                        <span className="font-mono text-[10px] font-bold w-10 text-right flex-shrink-0">
                          {(c.rate * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Funnel card — full width, shows signup → session → render → export
                  with authenticated vs anonymous breakdown. */}
              <div className="mt-3 rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    <Filter className="w-3 h-3" />
                    Conversion funnel
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    distinct identities per step (auth + anon)
                  </span>
                </div>
                <BetaFunnelBar
                  label="Signups"
                  value={stats.beta.funnel.signups}
                  max={Math.max(
                    stats.beta.funnel.signups,
                    stats.beta.funnel.sessionsCreated,
                    stats.beta.funnel.rendersCompleted,
                    stats.beta.funnel.exportsCompleted,
                    1,
                  )}
                  color="#AAFF00"
                />
                <BetaFunnelBar
                  label="Sessions created"
                  value={stats.beta.funnel.sessionsCreated}
                  anon={stats.beta.funnel.anonymousSessions}
                  max={Math.max(
                    stats.beta.funnel.signups,
                    stats.beta.funnel.sessionsCreated,
                    stats.beta.funnel.rendersCompleted,
                    stats.beta.funnel.exportsCompleted,
                    1,
                  )}
                  color="#84CC16"
                />
                <BetaFunnelBar
                  label="Renders completed"
                  value={stats.beta.funnel.rendersCompleted}
                  anon={stats.beta.funnel.anonymousRenders}
                  max={Math.max(
                    stats.beta.funnel.signups,
                    stats.beta.funnel.sessionsCreated,
                    stats.beta.funnel.rendersCompleted,
                    stats.beta.funnel.exportsCompleted,
                    1,
                  )}
                  color="#F59E0B"
                />
                <BetaFunnelBar
                  label="Exports completed"
                  value={stats.beta.funnel.exportsCompleted}
                  anon={stats.beta.funnel.anonymousExports}
                  max={Math.max(
                    stats.beta.funnel.signups,
                    stats.beta.funnel.sessionsCreated,
                    stats.beta.funnel.rendersCompleted,
                    stats.beta.funnel.exportsCompleted,
                    1,
                  )}
                  color="#F97316"
                />
                {stats.beta.funnel.signups === 0 &&
                  stats.beta.funnel.sessionsCreated === 0 && (
                    <div className="mt-2 text-[11px] text-muted-foreground/60 italic">
                      No funnel activity yet — usage will appear here as anonymous
                      beta users load tracks and export.
                    </div>
                  )}
              </div>
            </section>
          )}

          {/* ============ FOOTER META ============ */}
          <section className="flex flex-wrap items-center justify-between gap-3 border-t border-rain-border/40 pt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3" />
                {stats?.actor?.tier ?? 'enterprise'} session
              </span>
              <span className="inline-flex items-center gap-1">
                <Database className="size-3" />
                live DB aggregates
              </span>
              <span className="inline-flex items-center gap-1">
                <Zap className="size-3" />
                no fabrication
              </span>
            </div>
            <div>
              {stats?.generatedAt
                ? `snapshot ${formatDateTime(stats.generatedAt)}`
                : 'loading…'}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
