'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Music,
  Package,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { DSP_DELIVERY_PARTNERS } from '@/lib/rain/constants'
import { generateIsrc, generateUpc } from '@/lib/rain/provenance'
import { notifyInfo, notifyError, notifySuccess, notifyWarning } from '@/lib/rain/notifications'
import { audioEngine } from '@/lib/rain/audio-engine'
import {
  buildDdexErnXml,
  buildDistributionPackage,
  deleteDeliveryJob,
  loadDeliveryJobs,
  persistDeliveryJob,
  submitToLabelGrid,
  updateDeliveryJob,
  validateArtwork,
  validateDdex,
  type DeliveryJob,
  type DeliveryJobStatus,
} from '@/lib/rain/distribution'

const DISCLOSURE_FIELDS = [
  { key: 'vocals', label: 'Vocals' },
  { key: 'instrumentation', label: 'Instrumentation' },
  { key: 'composition', label: 'Composition' },
  { key: 'mixing', label: 'Mixing' },
  { key: 'mastering', label: 'Mastering' },
] as const

type DisclosureKey = typeof DISCLOSURE_FIELDS[number]['key']
type DisclosureValue = 'none' | 'assisted' | 'generated'

type BuildStatus = 'idle' | 'packaging' | 'packaged' | 'failed'

interface ArtworkState {
  file: File
  dimensions: [number, number]
  format: 'image/jpeg' | 'image/png'
  sizeBytes: number
  previewUrl: string
}

export function DistributeTab() {
  const metadata = useSessionStore((s) => s.metadata)
  const setMetadata = useSessionStore((s) => s.setMetadata)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['spotify', 'apple_music', 'youtube', 'tidal'])
  const [disclosure, setDisclosure] = useState<Record<DisclosureKey, DisclosureValue>>({
    vocals: 'assisted',
    instrumentation: 'none',
    composition: 'none',
    mixing: 'none',
    mastering: 'assisted',
  })
  const [buildStatus, setBuildStatus] = useState<BuildStatus>('idle')
  const [buildError, setBuildError] = useState<string | null>(null)
  const [artwork, setArtwork] = useState<ArtworkState | null>(null)
  const [artworkError, setArtworkError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<DeliveryJob[]>([])
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lastBuildSha, setLastBuildSha] = useState<string | null>(null)

  const refreshJobs = useCallback(async () => {
    const loaded = await loadDeliveryJobs()
    setJobs(loaded)
  }, [])

  useEffect(() => {
    refreshJobs()
  }, [refreshJobs])

  const handleGenerateIdentifiers = () => {
    setMetadata({ isrc: generateIsrc(), upc: generateUpc() })
  }

  // Build the DDEX ERN 4.3.2 XML string from the current metadata, selected
  // platforms, and AI disclosure state. Memoised so the preview doesn't
  // regenerate MessageId / MessageCreatedDateTime on every render.
  const ddexXml = useMemo(() => {
    return buildDdexErnXml({
      title: metadata.title || 'Untitled',
      artist: metadata.artist || 'Unknown Artist',
      album: metadata.album,
      genre: metadata.genre,
      genreSubgenre: metadata.genreSubgenre,
      year: metadata.year,
      isrc: metadata.isrc || 'USXXX2400001',
      upc: metadata.upc || '000000000000',
      iswc: metadata.iswc,
      releaseDate: metadata.releaseDate || new Date().toISOString().slice(0, 10),
      originalReleaseDate: metadata.originalReleaseDate,
      releaseType: metadata.releaseType,
      label: metadata.label,
      distributor: metadata.distributor,
      pLine: metadata.copyrightHolder,
      cLine: metadata.copyrightYear
        ? `${metadata.copyrightYear} ${metadata.copyrightHolder ?? metadata.publisher ?? metadata.artist ?? ''}`.trim()
        : undefined,
      publisher: metadata.publisher,
      pro: metadata.pro,
      masterOwner: metadata.masterOwner,
      language: metadata.language,
      explicitLyrics: metadata.explicitLyrics,
      parentalAdvisory: metadata.parentalAdvisory,
      territories: metadata.territories,
      contributors: metadata.contributors,
      aiDisclosure: metadata.aiDisclosure ?? disclosure,
      targetDsps: selectedPlatforms,
      dspLabels: Object.fromEntries(DSP_DELIVERY_PARTNERS.map((p) => [p.slug, p.label])),
    })
  }, [metadata, disclosure, selectedPlatforms])

  const ddexValidation = useMemo(() => validateDdex(ddexXml), [ddexXml])

  const handleArtworkSelected = async (file: File | null) => {
    if (!file) return
    setArtworkError(null)
    const result = await validateArtwork(file)
    if (!result.ok) {
      setArtwork(null)
      setArtworkError(result.error)
      notifyError('Artwork rejected', result.error)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    // Revoke the previous preview URL if any.
    if (artwork) URL.revokeObjectURL(artwork.previewUrl)
    setArtwork({
      file,
      dimensions: result.dimensions,
      format: result.format,
      sizeBytes: result.sizeBytes,
      previewUrl,
    })
    notifySuccess(
      'Artwork validated',
      `${result.dimensions[0]}×${result.dimensions[1]} ${result.format}`,
    )
  }

  // Build the full distribution package: render WAV + MP3, validate DDEX,
  // compute SHA-256 over every asset, ZIP everything, persist to the
  // IndexedDB delivery queue, and trigger a download.
  const handleBuildPackage = async () => {
    if (!metadata.isrc) {
      notifyError('ISRC required', 'Generate or enter an ISRC before packaging.')
      return
    }
    if (!hasProcessed) {
      notifyError(
        'No master to package',
        'Run the mastering pipeline first — distribution packages the rendered output, not the raw input.',
      )
      return
    }
    const processedBuffer = audioEngine.getProcessedBuffer()
    if (!processedBuffer) {
      notifyError('No processed buffer', 'Mastering pipeline has no output to package.')
      return
    }
    if (!ddexValidation.ok) {
      notifyError(
        'DDEX validation failed',
        ddexValidation.errors.join('; '),
      )
      return
    }
    setBuildStatus('packaging')
    setBuildError(null)
    try {
      const result = await buildDistributionPackage(
        processedBuffer,
        {
          title: metadata.title || 'Untitled',
          artist: metadata.artist || 'Unknown Artist',
          album: metadata.album,
          genre: metadata.genre,
          // TASK B: pass through the new Ditto-standard fields from the
          // metadata store (single source of truth on the Metadata tab).
          genreSubgenre: metadata.genreSubgenre,
          year: metadata.year,
          isrc: metadata.isrc,
          upc: metadata.upc,
          iswc: metadata.iswc,
          releaseDate: metadata.releaseDate || new Date().toISOString().slice(0, 10),
          originalReleaseDate: metadata.originalReleaseDate,
          releaseType: metadata.releaseType,
          label: metadata.label,
          distributor: metadata.distributor,
          pLine: metadata.copyrightHolder,
          cLine: metadata.copyrightYear
            ? `${metadata.copyrightYear} ${metadata.copyrightHolder ?? metadata.publisher ?? metadata.artist ?? ''}`.trim()
            : undefined,
          publisher: metadata.publisher,
          pro: metadata.pro,
          masterOwner: metadata.masterOwner,
          language: metadata.language,
          explicitLyrics: metadata.explicitLyrics,
          parentalAdvisory: metadata.parentalAdvisory,
          territories: metadata.territories,
          contributors: metadata.contributors,
          durationSeconds: processedBuffer.duration,
          // Prefer the metadata.aiDisclosure (single source of truth) but fall
          // back to the local `disclosure` state for backwards compatibility
          // (older sessions may have local state set from before the metadata
          // form existed).
          aiDisclosure: metadata.aiDisclosure ?? disclosure,
          targetDsps: selectedPlatforms,
          dspLabels: Object.fromEntries(DSP_DELIVERY_PARTNERS.map((p) => [p.slug, p.label])),
        },
        artwork?.file,
      )

      // Persist the job to the IndexedDB delivery queue.
      const now = Date.now()
      const job: DeliveryJob = {
        id: result.manifest.releaseId,
        releaseId: result.manifest.releaseId,
        status: 'packaged',
        manifest: result.manifest,
        packageSha256: result.packageSha256,
        packageSizeBytes: result.packageBytes.byteLength,
        createdAt: now,
        updatedAt: now,
      }
      await persistDeliveryJob(job, result.packageBytes)
      await refreshJobs()
      setLastBuildSha(result.packageSha256)
      setBuildStatus('packaged')

      // Trigger a real download of the ZIP.
      const url = URL.createObjectURL(result.packageBlob)
      const a = document.createElement('a')
      a.href = url
      const safeTitle = (metadata.title || 'rain-release').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 64) || 'rain-release'
      a.download = `${safeTitle}_RAIN_DDEX.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      notifyInfo(
        'Distribution package built',
        `ZIP ${formatBytes(result.packageBytes.byteLength)} · SHA-256 ${result.packageSha256.slice(0, 12)}… · queued for delivery`,
      )
    } catch (e) {
      console.error('[RAIN distribute] build error:', e)
      setBuildStatus('failed')
      setBuildError(e instanceof Error ? e.message : 'Unknown error')
      notifyError('Failed to build package', e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const handleSubmit = async (job: DeliveryJob) => {
    if (job.status === 'submitting') return
    setSubmittingJobId(job.id)
    try {
      const result = await submitToLabelGrid(job)
      if (result.ok) {
        notifySuccess('Delivered to LabelGrid', result.providerResponse.slice(0, 120))
      } else if (result.requiresCredentials) {
        notifyWarning(
          'Credentials required',
          'LABELGRID_API_KEY env var not set — package is built but not submitted. Set the env var in .env and restart the dev server to enable delivery.',
        )
      } else {
        notifyError('Delivery failed', result.error)
      }
      await refreshJobs()
    } finally {
      setSubmittingJobId(null)
    }
  }

  const handleRetry = async (job: DeliveryJob) => {
    await updateDeliveryJob(job.id, { status: 'packaged', error: undefined })
    await refreshJobs()
  }

  const handleDelete = async (job: DeliveryJob) => {
    await deleteDeliveryJob(job.id)
    await refreshJobs()
  }

  const togglePlatform = (slug: string) => {
    setSelectedPlatforms((p) => p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug])
  }

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              DDEX ERN 4.3.2 Distribution Pipeline
            </div>
            <div className="text-sm font-semibold">Real package · SHA-256 manifest · delivery queue</div>
          </div>
          <div className="flex items-center gap-2">
            <BuildStatusBadge status={buildStatus} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
          <DdexInfo label="ERN Version" value="4.3.2" />
          <DdexInfo label="Schema" value="ern/43" />
          <DdexInfo label="Disclosure Fields" value="5 (EU AI Act §50)" />
          <DdexInfo label="Output" value=".zip (ern+manifest+assets)" />
        </div>
        {!ddexValidation.ok && (
          <div className="mt-3 text-[10px] font-mono text-orange-400 bg-orange-400/10 rounded p-2 flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div>
              <div className="uppercase tracking-wider mb-1">DDEX validation</div>
              {ddexValidation.errors.map((err, i) => (
                <div key={i}>· {err}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Release metadata */}
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">Release Metadata</div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Title" value={metadata.title} onChange={(v) => setMetadata({ title: v })} />
              <Field label="Artist" value={metadata.artist} onChange={(v) => setMetadata({ artist: v })} />
              <Field label="Album" value={metadata.album} onChange={(v) => setMetadata({ album: v })} />
              <Field label="Year" value={metadata.year} onChange={(v) => setMetadata({ year: v })} />
              <Field label="ISRC" value={metadata.isrc} onChange={(v) => setMetadata({ isrc: v })} placeholder="US-XXX-YY-NNNNN" />
              <Field label="UPC" value={metadata.upc} onChange={(v) => setMetadata({ upc: v })} placeholder="12-digit UPC" />
            </div>
            <button
              onClick={handleGenerateIdentifiers}
              className="text-xs px-3 py-1.5 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors"
            >
              Generate ISRC + UPC
            </button>
          </div>
        </div>

        {/* AI Disclosure */}
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-1">AI Involvement Disclosure</div>
          <div className="text-[10px] text-muted-foreground mb-3">Required for EU AI Act Article 50 compliance</div>
          <div className="space-y-2">
            {DISCLOSURE_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between">
                <span className="text-xs">{f.label}</span>
                <div className="flex gap-1">
                  {(['none', 'assisted', 'generated'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setDisclosure((d) => ({ ...d, [f.key]: v }))}
                      className={`text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                        disclosure[f.key] === v
                          ? v === 'none' ? 'bg-rain-accent text-black'
                          : v === 'assisted' ? 'bg-orange-400 text-black'
                          : 'bg-purple-500 text-white'
                          : 'bg-rain-surface-2 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Artwork upload */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Cover Artwork</div>
            <div className="text-[10px] text-muted-foreground">JPEG/PNG · square 1:1 · 1400×1400 to 3000×3000 · ≤ 25 MB</div>
          </div>
          {artwork && (
            <button
              onClick={() => {
                URL.revokeObjectURL(artwork.previewUrl)
                setArtwork(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rain-border bg-rain-surface-2 hover:border-orange-400/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => handleArtworkSelected(e.target.files?.[0] ?? null)}
        />
        {artwork ? (
          <div className="flex items-center gap-3">
            <img
              src={artwork.previewUrl}
              alt="Cover art preview"
              className="w-20 h-20 rounded object-cover border border-rain-border"
            />
            <div className="flex-1 text-xs space-y-1">
              <div className="font-mono text-rain-accent">{artwork.dimensions[0]}×{artwork.dimensions[1]} · {artwork.format}</div>
              <div className="text-muted-foreground">{formatBytes(artwork.sizeBytes)} · {artwork.file.name}</div>
              <div className="text-[10px] text-rain-accent/70 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Validated against DSP spec
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-rain-border rounded-lg p-6 hover:border-rain-accent/50 transition-colors flex flex-col items-center gap-2 text-muted-foreground"
          >
            <Upload className="w-5 h-5" />
            <div className="text-xs">Click to upload cover art (optional)</div>
            {artworkError && (
              <div className="text-[10px] text-orange-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {artworkError}
              </div>
            )}
          </button>
        )}
      </div>

      {/* Platform selection */}
      <div className="rain-panel rounded-lg p-4">
        <div className="text-sm font-semibold mb-3">Target DSPs ({selectedPlatforms.length} selected)</div>
        <div className="text-[10px] text-muted-foreground mb-3 italic">
          Each selected DSP emits a &lt;Deal&gt; block in the ERN XML inside the ZIP.
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-96 overflow-y-auto rain-scrollbar">
          {DSP_DELIVERY_PARTNERS.map((p) => (
            <button
              key={p.slug}
              onClick={() => togglePlatform(p.slug)}
              className={`flex items-center gap-2 p-2 rounded-md border transition-colors text-left ${
                selectedPlatforms.includes(p.slug)
                  ? 'border-rain-accent bg-rain-accent/10'
                  : 'border-rain-border bg-rain-surface-2/60 hover:border-rain-accent/50'
              }`}
            >
              <Music className={`w-3 h-3 flex-shrink-0 ${selectedPlatforms.includes(p.slug) ? 'text-rain-accent' : 'text-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{p.label}</div>
                <div className="text-[9px] font-mono text-muted-foreground truncate">
                  {p.requiresIsrc ? 'ISRC req.' : 'No ISRC'} · {p.territoryRestrictions.length > 0 ? p.territoryRestrictions.join(', ') : 'Worldwide'}
                </div>
              </div>
              {selectedPlatforms.includes(p.slug) && (
                <CheckCircle2 className="w-3 h-3 text-rain-accent flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* DDEX XML preview */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">DDEX ERN 4.3.2 XML Preview</div>
          <span className="text-[9px] font-mono text-muted-foreground">ern/43/release-notification.xsd</span>
        </div>
        <pre className="text-[10px] font-mono bg-rain-surface-2 rounded p-3 overflow-x-auto rain-scrollbar text-muted-foreground max-h-96 overflow-y-auto">
{ddexXml}
        </pre>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={handleBuildPackage}
          disabled={buildStatus === 'packaging' || !metadata.isrc || !hasProcessed}
          className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-rain-accent text-black font-semibold text-sm hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100"
        >
          {buildStatus === 'packaging' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
          {buildStatus === 'packaging' ? 'Building ZIP…' : 'Build Distribution Package'}
        </button>
      </div>
      <div className="text-[10px] text-right text-muted-foreground -mt-2 space-y-0.5">
        {!metadata.isrc && <div>Generate or enter an ISRC to enable packaging.</div>}
        {!hasProcessed && <div>Run the mastering pipeline first — the package wraps the rendered master.</div>}
        {buildStatus === 'packaged' && lastBuildSha && (
          <div className="text-rain-accent font-mono">Last package SHA-256: {lastBuildSha.slice(0, 24)}…</div>
        )}
        {buildStatus === 'failed' && buildError && (
          <div className="text-orange-400">Build failed: {buildError}</div>
        )}
      </div>

      {/* Delivery Queue */}
      <DeliveryQueue
        jobs={jobs}
        submittingJobId={submittingJobId}
        onSubmit={handleSubmit}
        onRetry={handleRetry}
        onDelete={handleDelete}
        onRefresh={refreshJobs}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delivery queue section
// ---------------------------------------------------------------------------

function DeliveryQueue({
  jobs,
  submittingJobId,
  onSubmit,
  onRetry,
  onDelete,
  onRefresh,
}: {
  jobs: DeliveryJob[]
  submittingJobId: string | null
  onSubmit: (job: DeliveryJob) => void
  onRetry: (job: DeliveryJob) => void
  onDelete: (job: DeliveryJob) => void
  onRefresh: () => void
}) {
  return (
    <div className="rain-panel rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Delivery Queue</div>
          <div className="text-[10px] text-muted-foreground">
            Persisted to IndexedDB · {jobs.length} job{jobs.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-6 text-center">
          No delivery jobs yet. Build a package above to add one to the queue.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isSubmitting={submittingJobId === job.id}
              onSubmit={() => onSubmit(job)}
              onRetry={() => onRetry(job)}
              onDelete={() => onDelete(job)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JobRow({
  job,
  isSubmitting,
  onSubmit,
  onRetry,
  onDelete,
}: {
  job: DeliveryJob
  isSubmitting: boolean
  onSubmit: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  return (
    <div className="border border-rain-border rounded-md p-3 bg-rain-surface-2/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusPill status={job.status} />
            <span className="text-xs font-semibold truncate">{job.manifest.title || 'Untitled'}</span>
            <span className="text-[10px] font-mono text-muted-foreground">{job.manifest.isrc}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
            <div>
              <span className="text-foreground/70">ZIP:</span> {formatBytes(job.packageSizeBytes)} ·{' '}
              <span className="text-foreground/70">SHA-256:</span> {job.packageSha256.slice(0, 16)}…
            </div>
            <div>
              <span className="text-foreground/70">Built:</span> {new Date(job.createdAt).toLocaleString()}
              {job.deliveredAt && (
                <> · <span className="text-rain-accent">Delivered:</span> {new Date(job.deliveredAt).toLocaleString()}</>
              )}
              {job.submittedAt && !job.deliveredAt && (
                <> · <span className="text-orange-400">Submitted:</span> {new Date(job.submittedAt).toLocaleString()}</>
              )}
            </div>
            <div>
              <span className="text-foreground/70">Assets:</span>{' '}
              {job.manifest.assets.length} files ·{' '}
              <span className="text-foreground/70">UPC:</span> {job.manifest.upc}
              {job.manifest.artwork && (
                <> · <span className="text-foreground/70">Cover:</span> {job.manifest.artwork.width}×{job.manifest.artwork.height}</>
              )}
            </div>
            {job.error && (
              <div className="text-orange-400 mt-1 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span className="break-all">{job.error}</span>
              </div>
            )}
            {job.providerResponse && job.status === 'delivered' && (
              <div className="text-rain-accent mt-1 truncate">
                Provider: {job.providerResponse.slice(0, 120)}
                {job.providerResponse.length > 120 ? '…' : ''}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          {job.status === 'packaged' && (
            <button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-rain-accent text-black hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 flex items-center gap-1"
            >
              {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Submit
            </button>
          )}
          {job.status === 'failed' && (
            <button
              onClick={onRetry}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          )}
          {job.status === 'submitting' && (
            <button
              disabled
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rain-border bg-rain-surface-2 opacity-50 flex items-center gap-1"
            >
              <Loader2 className="w-3 h-3 animate-spin" /> Submitting
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rain-border bg-rain-surface-2 hover:border-orange-400/50 transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function BuildStatusBadge({ status }: { status: BuildStatus }) {
  const colors: Record<BuildStatus, string> = {
    idle: '#64748B',
    packaging: '#F59E0B',
    packaged: '#AAFF00',
    failed: '#F97316',
  }
  const labels: Record<BuildStatus, string> = {
    idle: 'idle',
    packaging: 'packaging',
    packaged: 'packaged',
    failed: 'failed',
  }
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded"
      style={{ color: colors[status], background: `${colors[status]}15` }}
    >
      {labels[status]}
    </span>
  )
}

function StatusPill({ status }: { status: DeliveryJobStatus }) {
  const colors: Record<DeliveryJobStatus, string> = {
    pending: '#64748B',
    packaged: '#AAFF00',
    submitting: '#F59E0B',
    delivered: '#10B981',
    failed: '#F97316',
  }
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
      style={{ color: colors[status], background: `${colors[status]}15` }}
    >
      {status}
    </span>
  )
}

function DdexInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="text-rain-accent">{value}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-rain-accent/50"
      />
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
