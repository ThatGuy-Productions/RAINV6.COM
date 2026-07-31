'use client'

/**
 * RAIN V6 — Stems ZIP Upload Zone
 *
 * Drag-and-drop / click-to-browse component that accepts a `.zip` of
 * pre-separated stem audio files (WAV / MP3 / FLAC / OGG / M4A / AIFF).
 *
 * The ZIP is parsed client-side via `extractZip()` (PKZIP reader), each audio
 * entry is fuzzy-matched to one of the 12 canonical `StemKey` values via
 * `extractStemsFromZip()`, and each matched entry is decoded through
 * `audioEngine.decodeOnly()` (a state-free decode that does NOT clobber the
 * mastering tab's `inputBuffer`). The decoded channels are measured for RMS
 * + peak dBFS (replicating `stems.ts::measureRmsDb` / `measurePeakDb`) and
 * pushed into the Zustand store as `StemResult[]` — the existing per-stem UI
 * in `StemsTab` then lights up unchanged.
 *
 * Visual style mirrors the mastering `UploadZone` (rain-panel surface, lime
 * accent, font-mono uppercase labels, drag-over highlight, Framer Motion
 * entrance). A small "Download template .zip" link generates a tiny ZIP with
 * 12 placeholder filenames so artists know the expected naming.
 */

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileArchive,
  X,
  Check,
  AlertTriangle,
  Download as DownloadIcon,
  Loader2,
  FileAudio,
} from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'
import { notifyError, notifySuccess } from '@/lib/rain/notifications'
import { STEM_KEYS, STEM_LABELS, STEM_COLORS } from '@/lib/rain/constants'
import type { StemKey } from '@/lib/rain/types'
import type { StemResult } from '@/lib/rain/stems'
import { extractZip, type ZipEntry } from '@/lib/rain/zip-reader'
import { extractStemsFromZip, type MatchedStem } from '@/lib/rain/stem-matcher'

// ---------------------------------------------------------------------------
// Measurement helpers — replicate stems.ts::measureRmsDb / measurePeakDb so
// the RMS/peak pills in the per-stem card show real values for ZIP-loaded
// stems (not the AI-separation values).
// ---------------------------------------------------------------------------

function measureRmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -120
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)
  return 20 * Math.log10(Math.max(rms, 1e-7))
}

function measurePeakDb(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > p) p = a
  }
  return 20 * Math.log10(Math.max(p, 1e-7))
}

// ---------------------------------------------------------------------------
// Progress state
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'extracting' | 'decoding' | 'done' | 'error'

interface ProgressState {
  phase: Phase
  /** Human-readable label, e.g. "Decoding vocals.wav (3/8)…". */
  label: string
  /** 0..100 — drives the lime progress bar. */
  pct: number
}

interface SummaryState {
  matched: Array<{ key: StemKey; filename: string }>
  duplicates: Array<{ key: StemKey; filename: string }>
  unmatchedAudio: string[]
  nonAudioCount: number
}

// ---------------------------------------------------------------------------
// PKZIP writer for the template .zip (store-only, method 0). Tiny inline
// reimplementation — kept here so we don't pull the distribution.ts module
// (which is server-shaped and brings the whole DDEX pipeline into the bundle).
// ---------------------------------------------------------------------------

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    t[i] = c >>> 0
  }
  return t
}

function crc32(data: Uint8Array): number {
  const table = crc32Table()
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function buildStoreOnlyZip(filenames: string[]): Uint8Array {
  const enc = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  const dosTime = 0
  const dosDate = (1 << 5) | 1 // 1980-01-01 (minimum valid DOS date)

  for (const filename of filenames) {
    const nameBytes = enc.encode(filename)
    const data = new Uint8Array(0) // empty placeholder
    const crc = crc32(data)
    const size = 0

    // Local file header (30 bytes) + filename.
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true) // method 0 = store
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    localParts.push(local)

    // Central directory header (46 bytes) + filename.
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0)
  const centralOffset = offset

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, filenames.length, true)
  ev.setUint16(10, filenames.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralOffset, true)
  ev.setUint16(20, 0, true)

  const totalLen = localParts.reduce((s, p) => s + p.length, 0) + centralSize + 22
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of localParts) { out.set(p, pos); pos += p.length }
  for (const p of centralParts) { out.set(p, pos); pos += p.length }
  out.set(eocd, pos)
  return out
}

function downloadTemplateZip() {
  // Generate placeholder filenames for all 12 canonical stems.
  const names = STEM_KEYS.map((k) => `${k}.wav`)
  const zip = buildStoreOnlyZip(names)
  // Cast to ArrayBuffer — same Uint8Array<ArrayBufferLike> variance fix as
  // used in distribution.ts:938 / audio-engine.ts:2653.
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'rain-stems-template.zip'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StemsUploadZone({ onDone }: { onDone?: (ok: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<ProgressState>({ phase: 'idle', label: '', pct: 0 })
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const setStemResults = useSessionStore((s) => s.setStemResults)

  // -------------------------------------------------------------------------
  // Core pipeline: ZIP bytes → StemResult[]
  // -------------------------------------------------------------------------

  const handleZipFile = useCallback(
    async (file: File) => {
      setErrorMsg(null)
      setSummary(null)
      setProgress({ phase: 'extracting', label: 'Reading ZIP…', pct: 2 })

      try {
        if (!file.name.toLowerCase().endsWith('.zip') && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
          throw new Error('Please upload a .zip file containing your stem audio files')
        }

        // ─── 1. Read + parse the ZIP ──────────────────────────────────────
        const arrayBuffer = await file.arrayBuffer()
        setProgress({ phase: 'extracting', label: 'Extracting ZIP entries…', pct: 8 })
        let entries: ZipEntry[]
        try {
          entries = await extractZip(arrayBuffer)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to parse ZIP'
          throw new Error(`Corrupt ZIP: ${msg}`)
        }
        if (entries.length === 0) {
          throw new Error('ZIP is empty')
        }

        // ─── 2. Match each audio entry to a canonical stem key ────────────
        const { matched, unmatchedAudio, nonAudio, duplicates } = extractStemsFromZip(entries)
        if (matched.length === 0) {
          throw new Error(
            unmatchedAudio.length > 0
              ? `No audio files in the ZIP matched a known stem name. Found ${unmatchedAudio.length} audio file(s) — see the template for expected naming.`
              : 'No audio files found in the ZIP',
          )
        }

        // ─── 3. Decode each matched entry through audioEngine.decodeOnly ──
        // decodeOnly does NOT touch inputBuffer / app state, so the mastering
        // tab's loaded track stays intact.
        const results: StemResult[] = []
        const total = matched.length
        for (let i = 0; i < total; i++) {
          const { entry, key }: MatchedStem = matched[i]
          const baseName = entry.filename.split('/').pop() ?? entry.filename
          setProgress({
            phase: 'decoding',
            label: `Decoding ${baseName} (${i + 1}/${total})…`,
            pct: 10 + Math.round((i / total) * 80),
          })
          // Yield a frame so the progress UI repaints before the (synchronous
          // DSP) decode call blocks on decodeAudioData.
          await new Promise<void>((r) => setTimeout(r, 0))

          // entry.data is a Uint8Array view; slice the exact byte range into a
          // standalone ArrayBuffer so decodeAudioData doesn't see trailing
          // bytes from the original zip buffer. Cast to ArrayBuffer — same
          // variance fix as elsewhere in the project (Uint8Array<ArrayBufferLike>
          // vs BufferSource<ArrayBuffer>).
          const stemBuffer = entry.data.buffer.slice(
            entry.data.byteOffset,
            entry.data.byteOffset + entry.data.byteLength,
          ) as ArrayBuffer
          let decoded: { channels: Float32Array[]; sampleRate: number }
          try {
            decoded = await audioEngine.decodeOnly(stemBuffer)
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'decode failed'
            throw new Error(`Failed to decode "${baseName}": ${msg}`)
          }

          // Ensure stereo — if mono, duplicate to both channels so the rest of
          // the stem pipeline (which assumes Float32Array[2]) is happy.
          let channels = decoded.channels
          if (channels.length === 1) {
            channels = [channels[0], channels[0].slice()]
          } else if (channels.length > 2) {
            // Downmix to stereo: keep first two channels (most stem exports
            // are stereo anyway).
            channels = [channels[0], channels[1]]
          }

          // Measure RMS + peak (max across channels, matching stems.ts).
          const rmsL = measureRmsDb(channels[0])
          const rmsR = channels.length > 1 ? measureRmsDb(channels[1]) : rmsL
          const peakL = measurePeakDb(channels[0])
          const peakR = channels.length > 1 ? measurePeakDb(channels[1]) : peakL
          const rms = Math.max(rmsL, rmsR)
          const peakDb = Math.max(peakL, peakR)

          results.push({
            key,
            label: STEM_LABELS[key],
            color: STEM_COLORS[key],
            channels,
            sampleRate: decoded.sampleRate,
            rms,
            peakDb,
          })
        }

        // ─── 4. Push results into the store ───────────────────────────────
        setStemResults(results, 'zip')
        setProgress({ phase: 'done', label: `Loaded ${results.length} stems from ZIP`, pct: 100 })
        setSummary({
          matched: results.map((r) => ({
            key: r.key,
            filename: matched.find((m) => m.key === r.key)!.entry.filename,
          })),
          duplicates: duplicates.map((d) => ({ key: d.key, filename: d.entry.filename })),
          unmatchedAudio: unmatchedAudio.map((e) => e.filename),
          nonAudioCount: nonAudio.length,
        })

        const skipMsg =
          unmatchedAudio.length > 0 || duplicates.length > 0 || nonAudio.length > 0
            ? ` · ${unmatchedAudio.length + duplicates.length} skipped`
            : ''
        notifySuccess('Stems loaded from ZIP', `${results.length} stems decoded${skipMsg}`)
        onDone?.(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to read ZIP'
        setErrorMsg(msg)
        setProgress({ phase: 'error', label: '', pct: 0 })
        notifyError('ZIP upload failed', msg)
        onDone?.(false)
      }
    },
    [setStemResults, onDone],
  )

  // -------------------------------------------------------------------------
  // Drag + drop handlers
  // -------------------------------------------------------------------------

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleZipFile(file)
    },
    [handleZipFile],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const reset = useCallback(() => {
    setProgress({ phase: 'idle', label: '', pct: 0 })
    setSummary(null)
    setErrorMsg(null)
  }, [])

  const isWorking = progress.phase === 'extracting' || progress.phase === 'decoding'
  const isDone = progress.phase === 'done'
  const isError = progress.phase === 'error'

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !isWorking && inputRef.current?.click()}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed transition-all p-6 text-center ${
          isDragging
            ? 'border-rain-accent bg-rain-accent/5 rain-glow-pulse scale-[1.02]'
            : isDone
              ? 'border-rain-accent/40 bg-rain-accent/5'
              : isError
                ? 'border-red-500/50 bg-red-500/5'
                : 'border-rain-border hover:border-rain-accent/50 bg-rain-surface-2/40'
        } ${isWorking ? 'pointer-events-none opacity-90' : ''}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isWorking) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        aria-label="Upload a ZIP of separated stems"
      >
        <label htmlFor="stems-file-input" className="sr-only">Upload stems ZIP file</label>
        <input
          id="stems-file-input"
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleZipFile(f)
            e.target.value = ''
          }}
          aria-label="Upload a ZIP of separated stems"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-2.5"
        >
          {/* Icon */}
          {isWorking ? (
            <Loader2 className="w-9 h-9 text-rain-accent animate-spin" />
          ) : isDone ? (
            <div className="w-9 h-9 rounded-full bg-rain-accent/15 border border-rain-accent/40 flex items-center justify-center">
              <Check className="w-5 h-5 text-rain-accent" strokeWidth={2.5} />
            </div>
          ) : isError ? (
            <div className="w-9 h-9 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center rain-glow-soft">
              <FileArchive className="w-5 h-5 text-rain-accent" />
            </div>
          )}

          {/* Label */}
          <div>
            <div className="text-sm font-semibold mb-0.5">
              {isWorking
                ? progress.label
                : isDone
                  ? progress.label
                  : isDragging
                    ? 'Drop ZIP to load stems'
                    : isError
                      ? 'Upload failed'
                      : 'Drop stem .zip or click to browse'}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {isWorking
                ? 'Parsing client-side · no upload to server'
                : isDone
                  ? 'Stems ready · gain / mute / solo below'
                  : '12 stems · vocals · drums · bass · kick · snare · hats · …'}
            </div>
          </div>

          {/* Error */}
          {isError && errorMsg && (
            <div className="mt-1 flex items-center gap-2 text-xs text-red-400 font-mono">
              <X className="w-3 h-3 shrink-0" />
              <span className="text-left break-words">{errorMsg}</span>
            </div>
          )}

          {/* Retry button */}
          {isError && (
            <button
              onClick={(e) => { e.stopPropagation(); reset() }}
              className="mt-1 text-[10px] font-mono px-2.5 py-1 rounded-md border border-rain-border hover:border-rain-accent/50 transition-colors"
            >
              Try again
            </button>
          )}
        </motion.div>

        {/* Progress bar */}
        <AnimatePresence>
          {isWorking && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 px-2"
            >
              <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-rain-accent"
                  animate={{ width: `${Math.max(3, Math.min(100, progress.pct))}%` }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                <span>{progress.phase === 'extracting' ? 'EXTRACTING' : 'DECODING'}</span>
                <span>{progress.pct.toFixed(0)}%</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Summary */}
      <AnimatePresence>
        {isDone && summary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rain-panel rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Check className="w-4 h-4 text-rain-accent shrink-0" />
                <div className="text-xs font-mono">
                  <span className="text-rain-accent font-semibold">{summary.matched.length} stems</span>
                  <span className="text-muted-foreground"> loaded from ZIP</span>
                  {(summary.unmatchedAudio.length > 0 || summary.duplicates.length > 0 || summary.nonAudioCount > 0) && (
                    <span className="text-muted-foreground">
                      {' '}· {summary.unmatchedAudio.length + summary.duplicates.length + summary.nonAudioCount} file(s) skipped
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={reset}
                className="text-[10px] font-mono px-2 py-1 rounded border border-rain-border hover:border-rain-accent/50 transition-colors shrink-0"
              >
                Upload another
              </button>
            </div>

            {/* Matched stem list */}
            <div className="flex flex-wrap gap-1.5">
              {summary.matched.map(({ key, filename }) => {
                const color = STEM_COLORS[key]
                const baseName = filename.split('/').pop() ?? filename
                return (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono border"
                    style={{ background: `${color}15`, color, borderColor: `${color}40` }}
                    title={filename}
                  >
                    <FileAudio className="w-2.5 h-2.5" />
                    <span className="uppercase">{key}</span>
                    <span className="opacity-60 truncate max-w-[120px]">{baseName}</span>
                  </span>
                )
              })}
            </div>

            {/* Duplicates warning */}
            {summary.duplicates.length > 0 && (
              <div className="flex items-start gap-2 text-[10px] font-mono text-amber-400">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">Duplicate stems (kept first):</span>
                  <ul className="mt-1 space-y-0.5 opacity-80">
                    {summary.duplicates.map((d, i) => (
                      <li key={i}>
                        <span className="uppercase text-amber-300">{d.key}</span> ← {d.filename.split('/').pop()}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Unmatched audio list */}
            {summary.unmatchedAudio.length > 0 && (
              <details className="text-[10px] font-mono text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  {summary.unmatchedAudio.length} unmatched audio file(s) — click to view
                </summary>
                <ul className="mt-1 space-y-0.5 opacity-70 max-h-40 overflow-y-auto">
                  {summary.unmatchedAudio.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template download + naming hint */}
      {!isWorking && !isDone && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[10px] font-mono text-muted-foreground leading-tight min-w-0">
            <span className="text-foreground">Expected naming:</span>{' '}
            vocals.wav · backing_vocals.wav · drums.wav · bass.wav · guitar.wav · piano.wav ·
            kick.wav · snare.wav · hats.wav · percussion.wav · ambience.wav · other.wav
          </div>
          <button
            onClick={downloadTemplateZip}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider text-rain-accent border border-rain-accent/30 hover:bg-rain-accent/10 transition-colors shrink-0"
          >
            <DownloadIcon className="w-3 h-3" />
            Template .zip
          </button>
        </div>
      )}
    </div>
  )
}
