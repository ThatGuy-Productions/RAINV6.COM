'use client'

/**
 * RAIN V6 — What's New panel (changelog)
 *
 * Slide-over panel triggered by the notifications bell in the studio top
 * bar. Surfaces recent features, fixes, and improvements so users (and
 * investors reviewing the beta) can see active development velocity.
 *
 * The changelog is versioned by build, with the latest entries at the top.
 * A localStorage flag tracks which entries the user has already seen, so
 * the bell's notification dot only appears when there's unseen content.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Bug, Wrench, CheckCircle2, GitCommit } from 'lucide-react'

// ── Changelog entries ──────────────────────────────────────────────────────
// `id` is a stable key used for the "seen" flag in localStorage.
// `version` is the build tag. `date` is the human-readable release date.
// `type` drives the icon + accent color.

type EntryType = 'feature' | 'fix' | 'improvement'

interface ChangelogEntry {
  id: string
  version: string
  date: string
  type: EntryType
  title: string
  description: string
}

const CHANGELOG: ChangelogEntry[] = [
  {
    id: 'v0.2.1-faq',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'feature',
    title: 'FAQ section + demo keyboard shortcut',
    description:
      'New FAQ section on the landing page answering the 6 most common beta questions (privacy, quality, formats, pricing, provenance, timeline). The landing demo now supports Space-to-play/pause when in view.',
  },
  {
    id: 'v0.2.1-demo-audio',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'feature',
    title: 'Interactive mastering demo with audio',
    description:
      'The landing page demo now plays actual audio. Drag the before/after slider to hear the lowpass filter open up and the gain increase in real time — the mastering difference is audible, not just visual.',
  },
  {
    id: 'v0.2.1-auth',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'feature',
    title: 'User accounts: Sign Up, Sign In, Logout',
    description:
      'Free-tier registration with anonymous-activity carryover. Returning users can sign in. Account dropdown menu with tier badge, profile info, and logout. Sessions and renders persist to your account.',
  },
  {
    id: 'v0.2.1-anon-analytics',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'improvement',
    title: 'Anonymous analytics pipeline',
    description:
      'Anonymous beta usage (session loads, renders, exports) now flows into the Event table with a per-browser anonId. The admin console funnel shows authenticated vs anonymous breakdown. Sign up to attribute your activity to an account.',
  },
  {
    id: 'v0.2.1-export-fix',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'fix',
    title: 'Export tab crash fixed',
    description:
      'The Export tab crashed on open due to missing icon imports and undefined auth state. Fixed: FileArchive/Lock imports, wired useAuth(), implemented real server-side source ZIP endpoint for Enterprise download.',
  },
  {
    id: 'v0.2.1-tier-gate',
    version: 'v0.2.1',
    date: 'Jul 2026',
    type: 'fix',
    title: 'Enterprise tier-gate security fix',
    description:
      'Fixed a critical bug where the enterprise tier gate was effectively open to anonymous users (tierRank fallback returned 0 for unknown slugs). Added a proper TIER_PRECEDENCE ladder with exact-match guard.',
  },
  {
    id: 'v0.2.0-build',
    version: 'v0.2.0',
    date: 'Jul 2026',
    type: 'feature',
    title: 'RAIN V6 free public beta launch',
    description:
      'Studio-grade mastering, 12-stem separation, Dolby Atmos binaural, Ed25519 RAIN-CERT provenance, DDEX distribution — all running on a deterministic in-browser DSP engine. Audio never leaves your device on the free path.',
  },
]

// ── Type metadata ──────────────────────────────────────────────────────────
const TYPE_META: Record<EntryType, { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string; label: string }> = {
  feature: { icon: Sparkles, accent: '#AAFF00', label: 'New' },
  fix: { icon: Bug, accent: '#EF4444', label: 'Fix' },
  improvement: { icon: Wrench, accent: '#06B6D4', label: 'Improved' },
}

// ── Seen-state management ──────────────────────────────────────────────────
const SEEN_KEY = 'rain_whatsnew_seen'

function getSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function markAllSeen(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(CHANGELOG.map((e) => e.id)))
  } catch {
    // localStorage disabled — non-critical
  }
}

/** Count unseen entries. Used by the bell to show/hide the notification dot. */
export function getUnseenCount(): number {
  const seen = getSeenIds()
  return CHANGELOG.filter((e) => !seen.has(e.id)).length
}

// ── Panel component ────────────────────────────────────────────────────────

interface WhatsNewPanelProps {
  open: boolean
  onClose: () => void
}

export function WhatsNewPanel({ open, onClose }: WhatsNewPanelProps) {
  // Mark all as seen when the panel is opened (after a short delay so the
  // user actually sees the "new" badges first). Dispatches a custom event
  // so the bell badge can update its count immediately.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      markAllSeen()
      window.dispatchEvent(new CustomEvent('rain:whatsnew-seen'))
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed top-0 right-0 bottom-0 z-[71] w-full max-w-md bg-[rgba(14,16,22,0.98)] border-l border-[rgba(170,255,0,0.15)] flex flex-col"
            style={{ boxShadow: '-24px 0 80px -12px rgba(0,0,0,0.7)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
                  <GitCommit className="w-4 h-4 text-[#AAFF00]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">What's New</h2>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {CHANGELOG.length} updates · latest {CHANGELOG[0].version}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close what's new panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Changelog list */}
            <div className="flex-1 overflow-y-auto rain-admin-scroll">
              <div className="px-5 py-4 space-y-4">
                {CHANGELOG.map((entry, i) => {
                  const meta = TYPE_META[entry.type]
                  const Icon = meta.icon
                  const isLast = i === CHANGELOG.length - 1
                  return (
                    <div key={entry.id} className="relative pl-8">
                      {/* Timeline connector */}
                      {!isLast && (
                        <div
                          className="absolute left-[11px] top-7 bottom-0 w-px"
                          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                          aria-hidden
                        />
                      )}
                      {/* Timeline dot */}
                      <div
                        className="absolute left-0 top-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: `${meta.accent}15`,
                          border: `1px solid ${meta.accent}40`,
                        }}
                      >
                        <Icon className="w-3 h-3" style={{ color: meta.accent }} />
                      </div>
                      {/* Content */}
                      <div className="pb-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              color: meta.accent,
                              background: `${meta.accent}10`,
                              border: `1px solid ${meta.accent}25`,
                            }}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {entry.version} · {entry.date}
                          </span>
                        </div>
                        <h3 className="text-[13px] font-semibold mb-1 leading-tight">
                          {entry.title}
                        </h3>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {entry.description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground/60 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-[#AAFF00]/60" />
                Marked as seen
              </span>
              <button
                onClick={onClose}
                className="text-[11px] font-mono text-muted-foreground hover:text-[#AAFF00] transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
