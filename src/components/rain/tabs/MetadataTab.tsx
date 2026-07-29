'use client'

/**
 * RAIN V6 — MetadataTab.
 *
 * Hosts the MetadataForm (Ditto-standard release metadata) with a header and
 * a live "Release Card" preview that mirrors the Spotify release-card layout
 * so the user sees instant visual feedback as they fill in the form.
 *
 * The form is the single source of truth — DistributeTab, ExportTab and
 * ProvenanceTab all read from the same Zustand `metadata` slice that this
 * form writes to.
 */

import * as React from 'react'
import { motion } from 'framer-motion'
import { Disc3, Music2, Tags } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MetadataForm } from '@/components/rain/forms/MetadataForm'
import { useSessionStore } from '@/lib/rain/store'
import { validateMetadata } from '@/lib/rain/metadata-validation'
import type { TrackMetadata } from '@/lib/rain/types'

// ---------------------------------------------------------------------------
// ReleaseCard — live preview that mirrors the Spotify release-card layout
// ---------------------------------------------------------------------------

function ReleaseCard({ metadata }: { metadata: TrackMetadata }) {
  const issues = React.useMemo(() => validateMetadata(metadata), [metadata])
  const ready = issues.length === 0

  const releaseTypeLabel = (metadata.releaseType ?? 'single').toUpperCase()
  const territoriesLabel = (metadata.territories ?? ['WORLDWIDE']).includes('WORLDWIDE')
    ? 'WORLDWIDE'
    : `${(metadata.territories ?? []).length} territories`

  // Pseudo cover-art: when no real artwork is loaded (we don't manage artwork
  // here — that lives on DistributeTab), show a deterministic gradient based
  // on the title hash. Gives instant visual identity.
  const coverGradient = React.useMemo(() => {
    const seed = (metadata.title || metadata.artist || 'RAIN').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
    const hue1 = (seed * 37) % 360
    const hue2 = (hue1 + 60) % 360
    return `linear-gradient(135deg, hsl(${hue1} 70% 35%) 0%, hsl(${hue2} 65% 25%) 100%)`
  }, [metadata.title, metadata.artist])

  return (
    <div
      className="rain-panel rounded-lg p-4 border-l-2 border-l-rain-accent/60"
      style={{ boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
            Release Card Preview
          </div>
          <div className="text-sm font-semibold">Live · Spotify-style</div>
        </div>
        {ready ? (
          <span className="text-[9px] font-mono text-rain-accent flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rain-accent rain-pulse" />
            READY
          </span>
        ) : (
          <span className="text-[9px] font-mono text-amber-400">
            {issues.length} ISSUE{issues.length === 1 ? '' : 'S'}
          </span>
        )}
      </div>

      <div className="flex gap-3">
        {/* Cover art */}
        <div
          className="relative w-24 h-24 rounded-md flex-shrink-0 flex items-center justify-center overflow-hidden border border-rain-border"
          style={{ background: coverGradient }}
        >
          <Disc3 className="w-10 h-10 text-white/40" />
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), transparent 60%)' }}
          />
        </div>
        {/* Details */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-[9px] font-mono text-rain-accent uppercase tracking-wider">
            {releaseTypeLabel}
          </div>
          <div
            className="text-sm font-semibold truncate"
            title={metadata.title || 'Untitled'}
          >
            {metadata.title || 'Untitled'}
          </div>
          <div
            className="text-xs text-muted-foreground truncate"
            title={metadata.artist || 'Unknown Artist'}
          >
            {metadata.artist || 'Unknown Artist'}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {metadata.genreSubgenre && (
              <Badge variant="outline" className="border-rain-border text-[9px] font-mono text-muted-foreground">
                <Tags className="w-2.5 h-2.5 mr-1" />
                {metadata.genreSubgenre}
              </Badge>
            )}
            {metadata.explicitLyrics === 'explicit' && (
              <Badge variant="outline" className="border-red-400/40 text-red-400 text-[9px] font-mono">
                E
              </Badge>
            )}
            {metadata.parentalAdvisory && (
              <Badge variant="outline" className="border-amber-400/40 text-amber-400 text-[9px] font-mono">
                PAL
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Detail rows */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
        <DetailRow label="ISRC" value={metadata.isrc || '—'} mono accent={Boolean(metadata.isrc)} />
        <DetailRow label="UPC" value={metadata.upc || '—'} mono accent={Boolean(metadata.upc)} />
        <DetailRow label="Release" value={metadata.releaseDate || '—'} />
        <DetailRow label="Year" value={metadata.year || '—'} />
        <DetailRow label="Lang" value={(metadata.language ?? 'eng').toUpperCase()} />
        <DetailRow label="Territories" value={territoriesLabel} />
        {metadata.iswc && <DetailRow label="ISWC" value={metadata.iswc} mono />}
        {metadata.pro && <DetailRow label="PRO" value={metadata.pro} />}
        {metadata.label && <DetailRow label="Label" value={metadata.label} />}
        {metadata.distributor && <DetailRow label="Distributor" value={metadata.distributor} />}
      </div>

      {/* Contributors preview */}
      {(metadata.contributors ?? []).length > 0 && (
        <div className="mt-3 pt-2 border-t border-rain-border">
          <div className="text-[9px] font-mono uppercase text-muted-foreground mb-1">
            Contributors ({(metadata.contributors ?? []).length})
          </div>
          <div className="flex flex-wrap gap-1">
            {(metadata.contributors ?? []).slice(0, 6).map((c, i) => (
              <span
                key={i}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rain-surface-2 border border-rain-border text-muted-foreground"
                title={`${c.role}${c.share ? ` · ${c.share}%` : ''}`}
              >
                {c.name || 'unnamed'}
                <span className="text-rain-accent/70 ml-1">{c.role}</span>
              </span>
            ))}
            {(metadata.contributors ?? []).length > 6 && (
              <span className="text-[9px] font-mono text-muted-foreground px-1">
                +{(metadata.contributors ?? []).length - 6} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* AI disclosure summary */}
      {metadata.aiDisclosure && (
        <div className="mt-3 pt-2 border-t border-rain-border">
          <div className="text-[9px] font-mono uppercase text-muted-foreground mb-1">
            AI Disclosure
          </div>
          <div className="flex flex-wrap gap-1">
            {(['vocals', 'instrumentation', 'composition', 'mixing', 'mastering'] as const).map((k) => {
              const v = metadata.aiDisclosure?.[k] ?? 'none'
              return (
                <span
                  key={k}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    v === 'none'
                      ? 'border-rain-border text-muted-foreground'
                      : v === 'assisted'
                        ? 'border-amber-400/40 text-amber-400'
                        : 'border-purple-500/40 text-purple-400'
                  }`}
                >
                  {k.slice(0, 4)}: {v}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-muted-foreground/70 uppercase">{label}</span>
      <span
        className={`truncate ${mono ? 'font-mono' : ''} ${accent ? 'text-rain-accent' : 'text-foreground/90'}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main MetadataTab
// ---------------------------------------------------------------------------

export function MetadataTab() {
  const metadata = useSessionStore((s) => s.metadata)

  return (
    <div className="space-y-4">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="rain-panel rounded-lg p-4"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 rounded-md bg-rain-accent/10 border border-rain-accent/30">
              <Music2 className="w-5 h-5 text-rain-accent" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
                Ditto-standard Release Metadata
              </div>
              <h2 className="text-lg font-semibold">Release Metadata</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
                Single source of truth for DDEX distribution, RAIN-CERT provenance, and embedded
                ID3/RIFF tags. Fill once — Distribute, Export, and Provenance tabs all read from this.
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Layout: form on left, sticky release-card preview on right */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <MetadataForm />

        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut', delay: 0.05 }}
          className="lg:sticky lg:top-16"
        >
          <ReleaseCard metadata={metadata} />
        </motion.div>
      </div>
    </div>
  )
}
