'use client'

import { useMemo, useState } from 'react'
import { Download, FileAudio, Loader2, Box, CheckCircle2, XCircle, Info, MessageSquare, FileArchive, Lock } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import {
  buildSidecarZip,
  verifyExportedMp3,
  verifyExportedWav,
  type ExportOptions,
  type ExportVerificationResult,
} from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'
import { exportAtmosPackage } from '@/lib/rain/spatial'
import type { SpatialConfig } from '@/lib/rain/spatial'
import { notifySuccess, notifyError } from '@/lib/rain/notifications'
import { recordExportDetails } from '@/lib/rain/analytics'
import type { ProvenanceCertificate } from '@/lib/rain/types'
import { useAuth } from '@/components/rain/admin/AuthContext'
import { getAnonId } from '@/lib/rain/anon-id'

// BETA-ANALYTICS: fires the server-side export_completed event (source of
// truth for activation/retention — see server-analytics.ts). Separate from
// recordExportDetails above, which writes local IndexedDB telemetry for
// this browser's own Analytics tab. Best-effort; never blocks the download.
async function reportBetaExportEvent(format: string, outputFileHash: string | undefined) {
  try {
    await fetch('/api/rain/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'export', format, outputFileHash, anonId: getAnonId() }),
    })
  } catch (e) {
    console.warn('[analytics] reportBetaExportEvent failed:', e)
  }
}

interface ExportFormat {
  id: string
  label: string
  ext: string
  desc: string
  size: string
  bitDepth: number
  icon: React.ReactNode
}

// P2-EXPORT: every toggle in this UI is wired through ExportOptions and
// HONORED byte-for-byte by audioBufferToWav / audioBufferToMp3. After every
// export the produced Blob is re-parsed and the verification report shows
// exactly what was actually embedded (✓ or ✗ per toggle). No cosmetic
// toggles.
const FORMATS: ExportFormat[] = [
  { id: 'wav24', label: 'WAV 24-bit', ext: 'wav', desc: 'Authoritative master · 48 kHz · 24-bit PCM · TPDF dither · LIST/INFO provenance', size: '~10 MB/min', bitDepth: 24, icon: <FileAudio className="w-5 h-5" /> },
  { id: 'wav16', label: 'WAV 16-bit', ext: 'wav', desc: '16-bit / 48 kHz CD-compatible (TPDF dither) · LIST/INFO provenance', size: '~7 MB/min', bitDepth: 16, icon: <FileAudio className="w-5 h-5" /> },
  { id: 'mp3_320', label: 'MP3 320 kbps', ext: 'mp3', desc: 'Streaming distribution · 48 kHz · 320 kbps CBR · TPDF dither · ID3v2 provenance', size: '~2.4 MB/min', bitDepth: 16, icon: <FileAudio className="w-5 h-5" /> },
  { id: 'atmos', label: 'Atmos Package (.zip)', ext: 'zip', desc: 'Dolby Atmos 7.1.4 bed + 16 dynamic objects (28ch). Full-source ZIP: .atmos.wav + audioDefinitionModelBwf.xml sidecar + spatial.json + README.txt + MANIFEST.json (SHA-256). Up to 6 min.', size: '~50 MB/min', bitDepth: 24, icon: <Box className="w-5 h-5" /> },
]

/** Extract the Chromaprint hash from a RAIN-CERT manifest (if present). */
function fingerprintFromCert(cert: ProvenanceCertificate | null): string | undefined {
  if (!cert) return undefined
  const a = cert.manifest.assertions.find((x) => x.label === 'org.rain.fingerprint')
  const h = a?.data?.hash
  return typeof h === 'string' ? h : undefined
}

export function ExportTab() {
  const fileName = useSessionStore((s) => s.fileName)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const metadata = useSessionStore((s) => s.metadata)
  const setMetadata = useSessionStore((s) => s.setMetadata)
  // P2-EXPORT: read the real cert from the store so the toggles can embed it.
  const rainCert = useSessionStore((s) => s.rainCert)

  const [selectedFormat, setSelectedFormat] = useState('wav24')
  // P2-EXPORT directive: five real toggles. Each one is honored byte-for-byte
  // by the encoder AND re-verified after export via verifyExported*().
  const [embedProvenance, setEmbedProvenance] = useState(true)
  const [embedSignature, setEmbedSignature] = useState(true)
  const [embedFingerprint, setEmbedFingerprint] = useState(true)
  const [embedMetadata, setEmbedMetadata] = useState(true)
  const [attachCertificate, setAttachCertificate] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [verification, setVerification] = useState<ExportVerificationResult | null>(null)

  // Enterprise auth — gates the "Download Full Source ZIP" affordance.
  const { user, isEnterprise, loading: authLoading } = useAuth()
  const [isDownloadingSource, setIsDownloadingSource] = useState(false)

  /**
   * Download the full runnable source codebase as a ZIP (Enterprise-only).
   * Hits GET /api/rain/source which streams a real archive built server-side
   * from src/, prisma/, and config files (see src/lib/rain/server-zip.ts).
   */
  const handleDownloadSource = async () => {
    if (!isEnterprise || isDownloadingSource) return
    setIsDownloadingSource(true)
    try {
      const res = await fetch('/api/rain/source', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server returned ${res.status}`)
      }
      const blob = await res.blob()
      const fileCount = res.headers.get('X-File-Count') ?? '?'
      triggerDownload(blob, 'rain-v6-source.zip')
      notifySuccess(
        'Source archive ready',
        `${fileCount} files · ${(blob.size / 1024).toFixed(0)} KB`,
      )
    } catch (e) {
      console.error('[RAIN source] download failed:', e)
      notifyError('Source download failed', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsDownloadingSource(false)
    }
  }

  const fingerprint = useMemo(() => fingerprintFromCert(rainCert), [rainCert])

  // Build the ExportOptions object that gets passed to the encoder. This is
  // the SINGLE source of truth for what gets embedded — the encoder reads no
  // other state.
  const buildOptions = (): ExportOptions => ({
    embedProvenance,
    embedSignature,
    embedFingerprint,
    embedMetadata,
    attachCertificate,
    metadata: {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album || undefined,
      year: metadata.year || undefined,
      isrc: metadata.isrc || undefined,
      comment: metadata.comment || undefined,
    },
    fingerprint,
  })

  const isAtmos = selectedFormat === 'atmos'
  const isMp3 = selectedFormat === 'mp3_320'
  const isWav = selectedFormat === 'wav24' || selectedFormat === 'wav16'

  // Toggles are only meaningful for WAV/MP3. Atmos package uses its own
  // embedding path (axml chunk + sidecar XML), so we show a notice rather
  // than fake-enabled toggles.
  const togglesRelevant = isWav || isMp3

  const handleExport = async () => {
    if (!hasProcessed) return

    // AUTH GATE: require sign-up before export/download.
    if (!user) {
      notifyError(
        'Sign up required',
        'Create a free account to export and download your master. No credit card needed.',
      )
      window.dispatchEvent(new CustomEvent('rain:signup-open'))
      return
    }

    // METADATA GATE: require at least title + artist before export.
    if (!metadata.title?.trim() || !metadata.artist?.trim()) {
      notifyError(
        'Metadata required',
        'Please fill in the Title and Artist fields before exporting. These are embedded in the audio file tags.',
      )
      return
    }

    setIsExporting(true)
    setVerification(null)
    // P2-ANALYTICS: measure real export wall-clock + actual blob size for
    // the Analytics tab's "Export Format Distribution" chart. Each branch
    // (atmos / mp3 / wav) records its own format string + size + duration.
    const exportStart = Date.now()
    const fileState = useSessionStore.getState()
    const recordExport = (format: string, blob: Blob, bitDepthOverride?: number) => {
      void recordExportDetails({
        timestamp: Date.now(),
        format,
        bytes: blob.size,
        durationMs: Date.now() - exportStart,
        sampleRate: fileState.fileSampleRate || 48000,
        bitDepth: bitDepthOverride ?? fileState.fileBitDepth ?? 24,
        channels: fileState.fileChannels || 2,
        fileName: fileState.fileName ?? '(unknown)',
      }).catch((e) => console.warn('[analytics] recordExportDetails failed:', e))
      void reportBetaExportEvent(selectedFormat, rainCert?.outputHash)
    }
    try {
      const format = FORMATS.find((f) => f.id === selectedFormat)!
      const baseName = (metadata.title || fileName || 'rain-master').replace(/\s+/g, '_')

      // --- Atmos path: separate code path, no ID3/LIST toggles apply ---
      if (format.id === 'atmos') {
        // EXPORT CAP: the spatial pipeline processes the full track (no silent
        // 60s preview truncation). 360s (6 min) is the memory-safe ceiling for
        // a 7.1.4 bed (12ch × 360s × 48k × 4B ≈ 830 MB persistent). Tracks
        // beyond this get an EXPLICIT error — never a silently truncated file.
        const ATMOS_EXPORT_MAX_SEC = 360
        const sourceBuffer = audioEngine.getProcessedBuffer() ?? null
        const sourceDuration = sourceBuffer?.duration ?? 0
        if (sourceDuration > ATMOS_EXPORT_MAX_SEC) {
          const mm = Math.floor(sourceDuration / 60)
          const ss = Math.floor(sourceDuration % 60)
          throw new Error(
            `Atmos export supports tracks up to ${Math.floor(ATMOS_EXPORT_MAX_SEC / 60)} minutes. ` +
            `Your track is ${mm}:${ss.toString().padStart(2, '0')}. ` +
            `Please trim the track or export as WAV / MP3 instead.`,
          )
        }
        const config: SpatialConfig = {
          bedFormat: '7.1.4',
          outputMode: 'MULTICHANNEL',
          hrtf: 'SPHERICAL',
          objects: 16,
          width: 100,
          centerFocus: 50,
        }
        // Pass the export cap so the full track (up to 6 min) is processed.
        // If the result is somehow still truncated (defensive), refuse to ship.
        const result = await audioEngine.processSpatial(config, undefined, undefined, ATMOS_EXPORT_MAX_SEC)
        if (result.truncated) {
          throw new Error(
            `Atmos export was truncated to ${result.processedSeconds.toFixed(0)}s ` +
            `(track is ${result.inputSeconds.toFixed(0)}s). Refusing to export a partial file. ` +
            `Please trim the track to ≤ ${ATMOS_EXPORT_MAX_SEC}s.`,
          )
        }
        // Full-source package: .atmos.wav + ADM XML sidecar + spatial.json +
        // README.txt + MANIFEST.json (real SHA-256 over every file).
        const blob = await exportAtmosPackage(result, { title: metadata.title, artist: metadata.artist }, config)
        triggerDownload(blob, `${baseName}_Atmos_7.1.4.zip`)
        recordExport('ATMOS-7.1.4', blob, 24)
        notifySuccess(
          'Atmos full-source package complete',
          `${result.processedSeconds.toFixed(1)}s · 5 files · ${(blob.size / 1024 / 1024).toFixed(1)} MB`,
        )
        setIsExporting(false)
        return
      }

      const options = buildOptions()

      // --- MP3 path ---
      if (format.id === 'mp3_320') {
        const blob = audioEngine.exportMp3(320, rainCert, options)
        // P2-EXPORT Step 6: verify the produced bytes actually contain what
        // the toggles promised. The verify function re-parses the ID3v2 tag
        // and reports per-toggle ✓/✗.
        const result = await verifyExportedMp3(blob, options)
        setVerification(result)

        if (options.attachCertificate && rainCert) {
          // Sidecar path: ZIP the MP3 + the cert.json together. The cert.json
          // is the FULL cert (sig + manifest + fingerprint intact) — the
          // sidecar IS the authoritative cert.
          const audioBytes = new Uint8Array(await blob.arrayBuffer())
          const certJson = JSON.stringify(rainCert, null, 2)
          const zipBlob = buildSidecarZip(
            audioBytes,
            `${baseName}_RAIN.mp3`,
            certJson,
            `${baseName}.cert.json`,
          )
          triggerDownload(zipBlob, `${baseName}_RAIN.zip`)
          recordExport('MP3-320+SIDECAR', zipBlob, 16)
        } else {
          triggerDownload(blob, `${baseName}_RAIN.mp3`)
          recordExport('MP3-320', blob, 16)
        }
        reportExportResult(result, 'MP3')
        setIsExporting(false)
        return
      }

      // --- WAV path (24-bit / 16-bit) ---
      const bitDepth = (format.bitDepth === 24 ? 24 : 16) as 16 | 24
      const blob = audioEngine.exportWav(bitDepth, rainCert, options)
      const result = await verifyExportedWav(blob, options)
      setVerification(result)

      if (options.attachCertificate && rainCert) {
        const audioBytes = new Uint8Array(await blob.arrayBuffer())
        const certJson = JSON.stringify(rainCert, null, 2)
        const zipBlob = buildSidecarZip(
          audioBytes,
          `${baseName}_RAIN.wav`,
          certJson,
          `${baseName}.cert.json`,
        )
        triggerDownload(zipBlob, `${baseName}_RAIN.zip`)
        recordExport(bitDepth === 24 ? 'WAV-24+SIDECAR' : 'WAV-16+SIDECAR', zipBlob, bitDepth)
      } else {
        triggerDownload(blob, `${baseName}_RAIN.wav`)
        recordExport(bitDepth === 24 ? 'WAV-24' : 'WAV-16', blob, bitDepth)
      }
      reportExportResult(result, 'WAV')
    } catch (e) {
      console.error('[RAIN export] error:', e)
      notifyError('Export failed', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="rain-panel rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Export Format
          </div>
          <div className="text-sm font-semibold mb-3">Choose authoritative master</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {FORMATS.map((f) => {
              const isSelected = selectedFormat === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedFormat(f.id)}
                  disabled={!hasProcessed}
                  className={`group relative text-left p-3 rounded-md border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'border-rain-accent bg-rain-accent/10 shadow-[0_0_12px_-4px_rgba(170,255,0,0.4)]'
                      : 'border-rain-border bg-rain-surface-2/60 hover:border-rain-accent/50 hover:bg-rain-surface-2 hover:-translate-y-0.5'
                  }`}
                >
                  {/* Selected indicator — colored left bar */}
                  {isSelected && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-2/3 rounded-full bg-rain-accent"
                      aria-hidden
                    />
                  )}
                  <div className="flex items-start gap-2">
                    <div className={`transition-colors ${isSelected ? 'text-rain-accent' : 'text-muted-foreground group-hover:text-rain-accent/70'}`}>
                      {f.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-sm font-semibold">{f.label}</span>
                        {isSelected && (
                          <CheckCircle2 className="w-3 h-3 text-rain-accent flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight mb-1">{f.desc}</div>
                      <div className="text-[9px] font-mono text-muted-foreground">{f.size}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          {/* Full-bandwidth guarantee banner — addresses the "clean cutoff
              above 16-18 kHz" issue. WAV is lossless PCM (Nyquist = 24 kHz
              @ 48 k). MP3 LAME's default lowpass was disabled (patched in
              node_modules) so 320 kbps exports preserve the full top octave. */}
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-md border border-rain-accent/30 bg-rain-accent/5">
            <CheckCircle2 className="w-4 h-4 text-rain-accent flex-shrink-0 mt-0.5" />
            <div className="text-[10px] leading-tight">
              <span className="font-semibold text-rain-accent">Full Bandwidth Guarantee</span>
              <span className="text-muted-foreground"> — WAV exports are lossless PCM (Nyquist = sample-rate / 2). MP3 320 kbps exports have LAME's default lowpass <em>disabled</em>, preserving the full 20–24 kHz top octave. No 16–18 kHz encoder cliff.</span>
            </div>
          </div>
        </div>

        <div className="rain-panel rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Metadata (ID3 / RIFF INFO — used by Metadata toggle)
          </div>
          <div className="text-sm font-semibold mb-3">Tag the master</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <MetadataField label="Title" value={metadata.title} onChange={(v) => setMetadata({ title: v })} />
            <MetadataField label="Artist" value={metadata.artist} onChange={(v) => setMetadata({ artist: v })} />
            <MetadataField label="Album" value={metadata.album} onChange={(v) => setMetadata({ album: v })} />
            <MetadataField label="Track #" value={metadata.trackNumber} onChange={(v) => setMetadata({ trackNumber: v })} />
            <MetadataField label="Year" value={metadata.year} onChange={(v) => setMetadata({ year: v })} />
            <MetadataField label="ISRC" value={metadata.isrc} onChange={(v) => setMetadata({ isrc: v })} placeholder="US-XXX-YY-NNNNN" />
            <MetadataField label="Comment" value={metadata.comment} onChange={(v) => setMetadata({ comment: v })} />
          </div>
        </div>

        {/* P2-EXPORT: 5 real toggles, grouped logically per the directive. */}
        <div className="rain-panel rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Provenance
          </div>
          <div className="text-sm font-semibold mb-3">What gets embedded in the audio bytes</div>
          {!togglesRelevant && (
            <div className="text-[10px] text-muted-foreground/80 italic mb-2">
              Toggles below apply to WAV/MP3 only. The Atmos path embeds metadata
              via the ADM axml chunk and the audioDefinitionModelBwf.xml sidecar —
              it does not use these ID3/RIFF INFO toggles.
            </div>
          )}
          <div className={`space-y-2 ${!togglesRelevant ? 'opacity-50 pointer-events-none' : ''}`}>
            <ToggleRow
              label="RAIN-CERT certificate (Ed25519)"
              desc={isWav ? 'WAV LIST/INFO RAIN field with cert JSON' : 'MP3 ID3v2 PRIV "com.rain.cert" frame with cert JSON'}
              checked={embedProvenance}
              onChange={setEmbedProvenance}
              disabled={!rainCert}
              disabledNote={!rainCert ? 'No cert available — render the pipeline first' : undefined}
            />
            <ToggleRow
              label="Ed25519 digital signature"
              desc={isWav ? 'WAV LIST/INFO ISIG field with sig hex (independent of cert JSON)' : 'MP3 ID3v2 TXXX "RAIN_SIGNATURE" frame with sig hex'}
              checked={embedSignature}
              onChange={setEmbedSignature}
              disabled={!rainCert}
              disabledNote={!rainCert ? 'No cert available — render the pipeline first' : undefined}
            />
            <ToggleRow
              label="Chromaprint fingerprint"
              desc={isWav ? 'WAV LIST/INFO IFPR field with hash hex (32 frames × 8 bands)' : 'MP3 ID3v2 TXXX "RAIN_FINGERPRINT" frame with hash hex'}
              checked={embedFingerprint}
              onChange={setEmbedFingerprint}
              disabled={!fingerprint}
              disabledNote={!fingerprint ? 'No fingerprint available in cert' : undefined}
            />
          </div>
        </div>

        <div className="rain-panel rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Metadata
          </div>
          <div className="text-sm font-semibold mb-3">ID3v2 / RIFF INFO text tags</div>
          <div className={`space-y-2 ${!togglesRelevant ? 'opacity-50 pointer-events-none' : ''}`}>
            <ToggleRow
              label="Embed metadata tags"
              desc={isWav ? 'WAV LIST/INFO: INAM/IART/IPRD/ICRD/ISRC/ICMT' : 'MP3 ID3v2: TIT2/TPE1/TALB/TYER/TSRC/COMM'}
              checked={embedMetadata}
              onChange={setEmbedMetadata}
            />
            <ToggleRow
              label="Sidecar .cert.json"
              desc="Attach the full RAIN-CERT as a separate file (downloaded as ZIP with audio)"
              checked={attachCertificate}
              onChange={setAttachCertificate}
              disabled={!rainCert}
              disabledNote={!rainCert ? 'No cert available — render the pipeline first' : undefined}
            />
          </div>
          <div className="text-[10px] text-muted-foreground/70 italic pt-2">
            AudioSeal watermarking not available in-browser — no audio watermark is embedded.
          </div>
        </div>

        {/* P2-EXPORT Step 3: verification report — shows what was ACTUALLY
            found in the produced bytes. */}
        {verification && (
          <div className="rain-panel rounded-lg p-4 border-l-2"
               style={{ borderLeftColor: verification.ok ? '#AAFF00' : '#FF5555' }}>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Verification Report
            </div>
            <div className="text-sm font-semibold mb-3 flex items-center gap-2">
              {verification.ok ? (
                <><CheckCircle2 className="w-4 h-4 text-rain-accent" /> Verified ✓</>
              ) : (
                <><XCircle className="w-4 h-4 text-red-400" /> Verification failed ✗</>
              )}
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                {verification.format.toUpperCase()} · {verification.sizeBytes.toLocaleString()} bytes · sha256:{verification.sha256.slice(0, 12)}…
              </span>
            </div>
            <div className="space-y-1.5">
              <VerificationRow label="Provenance (RAIN-CERT)" check={verification.checks.provenance} />
              <VerificationRow label="Signature (Ed25519)" check={verification.checks.signature} />
              <VerificationRow label="Fingerprint (Chromaprint)" check={verification.checks.fingerprint} />
              <VerificationRow label="Metadata tags" check={verification.checks.metadata} />
            </div>
            <div className="text-[10px] text-muted-foreground/70 italic pt-2">
              Each row was re-parsed from the exported file bytes — not from the
              toggle state. Mismatch means the encoder failed to honor a toggle.
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-1 space-y-4">
        <div className="rain-panel rounded-lg p-4 sticky top-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Export Summary
          </div>
          <div className="text-sm font-semibold mb-3">{FORMATS.find((f) => f.id === selectedFormat)?.label}</div>
          <div className="space-y-2 text-xs">
            <SummaryRow label="Format" value={FORMATS.find((f) => f.id === selectedFormat)?.label ?? ''} />
            <SummaryRow label="Bit depth" value={`${FORMATS.find((f) => f.id === selectedFormat)?.bitDepth}-bit`} />
            <SummaryRow label="Sample rate" value="48 kHz" />
            <SummaryRow label="Channels" value="Stereo" />
            <div className="border-t border-rain-border/50 my-2" />
            <SummaryRow label="Provenance" value={previewFlag(embedProvenance && !!rainCert, isWav ? 'LIST/INFO RAIN ✓' : 'ID3v2 PRIV ✓')} />
            <SummaryRow label="Signature" value={previewFlag(embedSignature && !!rainCert, isWav ? 'LIST/INFO ISIG ✓' : 'TXXX ✓')} />
            <SummaryRow label="Fingerprint" value={previewFlag(embedFingerprint && !!fingerprint, isWav ? 'LIST/INFO IFPR ✓' : 'TXXX ✓')} />
            <SummaryRow label="Metadata tags" value={previewFlag(embedMetadata, isWav ? 'INAM/IART/...' : 'TIT2/TPE1/...')} />
            <SummaryRow label="Sidecar cert" value={previewFlag(attachCertificate && !!rainCert, '.cert.json (ZIP) ✓')} />
            <SummaryRow label="Watermark" value="LSB steganographic ✓" />
          </div>
          <button
            onClick={handleExport}
            disabled={!hasProcessed || isExporting}
            className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-md bg-rain-accent text-black font-semibold text-sm hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isExporting ? 'Exporting...' : 'Export Master'}
          </button>
          {!hasProcessed && (
            <div className="mt-2 text-[10px] text-center text-muted-foreground italic">
              Run the 16-stage pipeline first
            </div>
          )}
          {hasProcessed && !user && (
            <div className="mt-2 text-[10px] text-center text-amber-400/80 font-mono">
              ⚠ Sign up required to export
            </div>
          )}
          {hasProcessed && user && (!metadata.title?.trim() || !metadata.artist?.trim()) && (
            <div className="mt-2 text-[10px] text-center text-amber-400/80 font-mono">
              ⚠ Title and Artist required
            </div>
          )}

          {/* ── Full Source ZIP (enterprise-gated) ───────────────────────
              Ships the complete project tree as a DEFLATE ZIP with an
              embedded WINDOWS-RUN-GUIDE.txt + MANIFEST.json (SHA-256 per
              file). This is the closest feasible thing to a "Windows .exe
              build" for a Next.js web app — see the disclosure note below. */}
          <div className="mt-4 pt-4 border-t border-rain-border/60">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
              <FileArchive className="w-3 h-3" />
              Full Source Codebase
            </div>
            <div className="text-sm font-semibold mb-1">Download Repo ZIP</div>
            <div className="text-[10px] text-muted-foreground leading-relaxed mb-2.5">
              Complete runnable source (src/, prisma/, config) + WINDOWS-RUN-GUIDE.txt +
              MANIFEST.json (SHA-256). Run locally on Windows via Node.js/Bun.
            </div>
            <button
              onClick={handleDownloadSource}
              disabled={isDownloadingSource || authLoading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-md border border-rain-border bg-rain-surface-2/60 text-xs font-semibold hover:border-rain-accent/50 hover:bg-rain-surface-2 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              {isDownloadingSource ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Building ZIP…</>
              ) : isEnterprise ? (
                <><FileArchive className="w-3.5 h-3.5 text-rain-accent" /> Download Full Source ZIP</>
              ) : (
                <><Lock className="w-3.5 h-3.5" /> Enterprise · Download Source ZIP</>
              )}
            </button>
            {!isEnterprise && !authLoading && (
              <div className="mt-1.5 text-[10px] text-muted-foreground/80 italic flex items-start gap-1">
                <Lock className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                <span>Log in via the Enterprise admin door (top-bar lock icon) to unlock.</span>
              </div>
            )}
            <div className="mt-2 text-[9px] text-muted-foreground/60 italic flex items-start gap-1 leading-tight">
              <Info className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
              <span>
                RAIN V6 is a Next.js web app, not a native .exe. The ZIP includes a
                Windows run guide so you can run it natively on Windows 10/11 via
                Node.js 20+ / Bun. Packaging as a single .exe would require an
                Electron/Tauri rewrite — out of scope for this codebase.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Format a toggle's live-preview state for the summary panel. */
function previewFlag(on: boolean, label: string): string {
  return on ? label : 'Off'
}

/** Toast the right message based on verification result. */
function reportExportResult(result: ExportVerificationResult, formatLabel: string): void {
  if (result.ok) {
    notifySuccess(
      `${formatLabel} export verified`,
      `All toggles honored · ${result.sizeBytes.toLocaleString()} bytes`,
    )
  } else {
    const failed = Object.entries(result.checks)
      .filter(([, v]) => !v.ok)
      .map(([k]) => k)
    notifyError(
      `${formatLabel} export verification failed`,
      `Mismatch on: ${failed.join(', ')}. The encoder did not honor one or more toggles.`,
    )
  }
}

/** Trigger a browser download for the given Blob. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function MetadataField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-rain-accent/50"
      />
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
  disabledNote,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  disabledNote?: string
}) {
  return (
    <label className={`flex items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 accent-[#AAFF00]"
      />
      <div className="flex-1">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
        {disabled && disabledNote && (
          <div className="text-[10px] text-muted-foreground/80 italic mt-0.5">{disabledNote}</div>
        )}
      </div>
    </label>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-rain-border/50 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold text-right">{value}</span>
    </div>
  )
}

function VerificationRow({
  label,
  check,
}: {
  label: string
  check: { expected: boolean; found: boolean; ok: boolean }
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono flex items-center gap-1">
        <span className={check.expected ? 'text-rain-accent' : 'text-muted-foreground/60'}>
          {check.expected ? 'ON' : 'off'}
        </span>
        <span className="text-muted-foreground/60">→</span>
        <span className={check.found ? 'text-rain-accent' : 'text-muted-foreground/60'}>
          {check.found ? 'found' : 'absent'}
        </span>
        {check.ok ? (
          <CheckCircle2 className="w-3 h-3 text-rain-accent" />
        ) : (
          <XCircle className="w-3 h-3 text-red-400" />
        )}
      </span>
    </div>
  )
}
