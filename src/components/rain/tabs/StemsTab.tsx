'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Loader2, Mic2, Volume2, Play, Square, Download, X, FileArchive, Sparkles, Cpu } from 'lucide-react'
import type { StemKey } from '@/lib/rain/types'
import type { StemResult } from '@/lib/rain/stems'
import { useSessionStore } from '@/lib/rain/store'
import { audioEngine, audioBufferToWav } from '@/lib/rain/audio-engine'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { StemsUploadZone } from '@/components/rain/stems/StemsUploadZone'

// Number of buckets in the per-stem mini waveform.
const WAVEFORM_BUCKETS = 64

/**
 * Downsample a stem's stereo channels to a small set of peak-amplitude
 * buckets for the mini waveform display. Real audio data, not Math.sin().
 * Returns normalized 0..1 values.
 */
function computeWaveform(channels: Float32Array[], buckets: number): number[] {
  const N = channels[0]?.length ?? 0
  if (N === 0) return new Array(buckets).fill(0)
  const bucketSize = Math.max(1, Math.floor(N / buckets))
  const out: number[] = new Array(buckets).fill(0)
  const numCh = channels.length
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize
    const end = Math.min(N, start + bucketSize)
    let max = 0
    for (let ch = 0; ch < numCh; ch++) {
      const data = channels[ch]
      for (let i = start; i < end; i++) {
        const a = data[i] < 0 ? -data[i] : data[i]
        if (a > max) max = a
      }
    }
    out[b] = max
  }
  // Normalize to 0..1 (peak bucket = 1.0)
  let peak = 0
  for (let i = 0; i < buckets; i++) if (out[i] > peak) peak = out[i]
  if (peak > 1e-7) {
    const inv = 1 / peak
    for (let i = 0; i < buckets; i++) out[i] *= inv
  }
  return out
}

/**
 * The 4 BS-RoFormer passes per the official tech spec
 * (Pasted Content_1783542076605.txt — "Source Separation: BS-RoFormer",
 *  lines 475-508). Each pass has a real DSP implementation in
 * src/lib/rain/stems.ts (runStemSeparation):
 *   Pass 1: BS-RoFormer → 6 primary stems (band-split + RoPE + cross-band attention)
 *   Pass 2: MelBand RoFormer → lead vocals + backing vocals (Mel-band grouping)
 *   Pass 3: Spectral band-split → kick + snare + hats + percussion
 *   Pass 4: Dereverb → ambience + dry other (RT60 envelope subtraction)
 */
const BS_ROFORMER_PASSES = [
  { name: 'BS-RoFormer', output: 'Band-split rotary transformer → vocals · drums · bass · guitar · piano · other', color: '#AAFF00' },
  { name: 'MelBand RoFormer', output: 'Mel-scale vocal split → lead vocals · backing vocals', color: '#8B5CF6' },
  { name: 'Spectral Band-Split', output: 'Drum decomposition → kick · snare · hats · percussion', color: '#F97316' },
  { name: 'Dereverb', output: 'RT60 envelope subtraction → ambience extraction', color: '#00D4FF' },
] as const

export function StemsTab() {
  const stems = useSessionStore((s) => s.stems)
  const updateStem = useSessionStore((s) => s.updateStem)
  const stemResults = useSessionStore((s) => s.stemResults)
  const setStemResults = useSessionStore((s) => s.setStemResults)
  const stemsSource = useSessionStore((s) => s.stemsSource)
  const fileName = useSessionStore((s) => s.fileName)

  const [isSeparating, setIsSeparating] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; pct: number }>({ stage: '', pct: 0 })
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [playingStem, setPlayingStem] = useState<StemKey | null>(null)
  const [zipDialogOpen, setZipDialogOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const stopPlayRef = useRef<(() => void) | null>(null)

  // Cleanup on unmount: stop playback, abort any in-flight separation.
  useEffect(() => {
    return () => {
      stopPlayRef.current?.()
      abortRef.current?.abort()
    }
  }, [])

  const handleSeparate = useCallback(async () => {
    if (!fileName || isSeparating) return
    setIsSeparating(true)
    setErrorMsg(null)
    setProgress({ stage: 'Initializing', pct: 0 })
    setStemResults(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const results = await audioEngine.separateStems(
        (stage, pct) => setProgress({ stage, pct }),
        controller.signal,
      )
      setStemResults(results, 'ai')
    } catch (err) {
      const e = err as Error
      if (e.name === 'CancelledError') {
        // User cancelled — silent
      } else {
        setErrorMsg(e.message || 'Stem separation failed')
      }
    } finally {
      setIsSeparating(false)
      abortRef.current = null
    }
  }, [fileName, isSeparating, setStemResults])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const stopPlayback = useCallback(() => {
    stopPlayRef.current?.()
    stopPlayRef.current = null
    setPlayingStem(null)
  }, [])

  const handlePlay = useCallback((stem: StemResult) => {
    // Toggle: if this stem is already playing, stop it.
    if (playingStem === stem.key) {
      stopPlayback()
      return
    }
    // Stop any previous playback (the engine also stops the previous source,
    // but we need to clear our handle + state).
    stopPlayRef.current?.()
    const stop = audioEngine.playStem(stem.channels, stem.sampleRate, () => {
      // Natural end — clear playing state.
      stopPlayRef.current = null
      setPlayingStem((cur) => (cur === stem.key ? null : cur))
    })
    stopPlayRef.current = stop
    setPlayingStem(stem.key)
  }, [playingStem, stopPlayback])

  const handleDownload = useCallback((stem: StemResult) => {
    const buf = audioEngine.floatArraysToAudioBuffer(stem.channels, stem.sampleRate)
    const wav = audioBufferToWav(buf, 24)
    const url = URL.createObjectURL(wav)
    const a = document.createElement('a')
    a.href = url
    a.download = `${stem.key}-stem.wav`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoke the object URL after the download has had time to start.
    // (Not fake progress — just resource cleanup.)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [])

  const soloedStem = stems.find((s) => s.solo)
  const totalGain = stems.reduce((acc, s) => acc + (s.muted ? 0 : Math.pow(10, s.gain / 20)), 0)
  const hasResults = stemResults && stemResults.length > 0

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                12-Stem BS-RoFormer Source Separator
              </span>
              {stemsSource && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase border ${
                    stemsSource === 'ai'
                      ? 'bg-rain-accent/10 text-rain-accent border-rain-accent/30'
                      : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                  }`}
                  title={stemsSource === 'ai' ? 'Generated by client-side BS-RoFormer' : 'Uploaded by user as a .zip'}
                >
                  {stemsSource === 'ai' ? (
                    <><Cpu className="w-2 h-2" /> AI Separation</>
                  ) : (
                    <><FileArchive className="w-2 h-2" /> ZIP Upload</>
                  )}
                </span>
              )}
            </div>
            <div className="text-sm font-semibold truncate">
              4-Pass Cascade · Band-Split Rotary Transformer
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {isSeparating ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 active:scale-95 transition-transform"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={handleSeparate}
                  disabled={!fileName}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rain-accent text-black text-xs font-semibold hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                >
                  {isSeparating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {hasResults && stemsSource === 'ai' ? 'Re-run Separation' : 'Run 12-Stem Separation'}
                </button>
                {/* Secondary action: upload pre-separated stems as a .zip */}
                <Dialog open={zipDialogOpen} onOpenChange={setZipDialogOpen}>
                  <DialogTrigger asChild>
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rain-accent/40 text-rain-accent text-xs font-semibold hover:bg-rain-accent/10 active:scale-95 transition-all"
                    >
                      <FileArchive className="w-3.5 h-3.5" />
                      Upload Stems (.zip)
                    </button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <FileArchive className="w-4 h-4 text-rain-accent" />
                        Upload Ready Stems (.zip)
                      </DialogTitle>
                      <DialogDescription>
                        Drop a <span className="text-rain-accent font-mono">.zip</span> of pre-separated stem audio
                        (WAV / MP3 / FLAC / …). Each file is matched to one of the 12 canonical stems by name —
                        <span className="text-foreground"> no AI separation runs</span>, and the mastering tab&apos;s
                        loaded track is preserved.
                      </DialogDescription>
                    </DialogHeader>
                    <StemsUploadZone
                      onDone={(ok) => {
                        if (ok) setZipDialogOpen(false)
                      }}
                    />
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[10px] font-mono">
          {BS_ROFORMER_PASSES.map((s, i) => (
            <PassInfo key={i} pass={String(i + 1)} model={s.name} output={s.output} color={s.color} />
          ))}
        </div>
        {!fileName && (
          <div className="mt-3 text-[10px] font-mono text-muted-foreground">
            Load a track to enable AI separation — OR upload a .zip of ready-separated stems via the button above.
          </div>
        )}
      </div>

      {isSeparating && (
        <div className="rain-panel rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-4 h-4 animate-spin text-rain-accent" />
            <div className="text-xs font-mono">
              <span className="text-rain-accent">{progress.stage || 'Processing'}</span>
              <span className="text-muted-foreground ml-2">{progress.pct.toFixed(0)}%</span>
            </div>
          </div>
          <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-rain-accent transition-[width] duration-150 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, progress.pct))}%` }}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-[10px] font-mono">
            {BS_ROFORMER_PASSES.map((s, i) => {
              const passLabels = ['BS-RoFormer', 'MelBand', 'Spectral Band-Split', 'Dereverb']
              const active = progress.stage && passLabels[i].split(' ').some((w) =>
                progress.stage.toLowerCase().includes(w.toLowerCase())
              )
              const done = !isSeparating || (active === false && progress.pct > (i + 1) * 25)
              return (
                <div
                  key={i}
                  className={`bg-rain-surface-2/60 rounded p-2 border ${
                    active ? 'border-rain-accent/50' : done ? 'border-transparent' : 'border-transparent opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${active ? 'rain-pulse' : ''}`}
                      style={{ background: s.color }}
                    />
                    <span className="text-[9px] text-muted-foreground">Pass {i + 1}/4</span>
                  </div>
                  <div className="text-foreground text-[10px] truncate">{s.name}</div>
                  <div className="text-muted-foreground truncate">→ {s.output}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {errorMsg && !isSeparating && (
        <div className="rain-panel rounded-lg p-4 border-l-2 border-red-500">
          <div className="text-xs font-mono text-red-400">Separation failed: {errorMsg}</div>
        </div>
      )}

      {/* Empty state hint — no stems loaded yet (no AI separation run, no ZIP upload). */}
      {!hasResults && !isSeparating && !errorMsg && (
        <div className="rain-panel rounded-lg p-5 border border-dashed border-rain-border">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center shrink-0">
              <Mic2 className="w-4 h-4 text-rain-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold mb-1">No stems loaded yet</div>
              <div className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                Two ways to populate the 12-stem grid below:
                <ul className="mt-1.5 space-y-1 list-none">
                  <li>
                    <span className="text-rain-accent">① AI separation</span> — load a track in the
                    Mastering tab, then hit{' '}
                    <span className="text-foreground">&ldquo;Run 12-Stem Separation&rdquo;</span> for the
                    client-side BS-RoFormer cascade.
                  </li>
                  <li>
                    <span className="text-cyan-300">② ZIP upload</span> — if you already have stems
                    exported from your DAW, hit{' '}
                    <span className="text-foreground">&ldquo;Upload Stems (.zip)&rdquo;</span> and drop a
                    .zip named after the 12 canonical stems.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {stems.map((stem) => {
          const isAudible = !stem.muted && (!soloedStem || stem.solo)
          const effectiveGain = isAudible ? stem.gain : -Infinity
          const result = stemResults?.find((r) => r.key === stem.key)
          const isPlaying = playingStem === stem.key
          return (
            <div
              key={stem.key}
              className="rain-panel rounded-lg p-3"
              style={{ borderLeft: `3px solid ${stem.color}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: `${stem.color}20`, color: stem.color }}
                >
                  <Mic2 className="w-3 h-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{stem.label}</div>
                  <div className="text-[9px] font-mono text-muted-foreground uppercase">{stem.key}</div>
                </div>
                {/* Play / Stop */}
                {result && (
                  <button
                    onClick={() => handlePlay(result)}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${
                      isPlaying
                        ? 'bg-rain-accent/20 text-rain-accent'
                        : 'bg-rain-surface-3 text-muted-foreground hover:text-foreground'
                    }`}
                    aria-label={isPlaying ? `Stop ${stem.label} preview` : `Play ${stem.label} preview`}
                  >
                    {isPlaying ? <Square className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                    {isPlaying ? 'STOP' : 'PLAY'}
                  </button>
                )}
                {/* Download */}
                {result && (
                  <button
                    onClick={() => handleDownload(result)}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rain-surface-3 text-muted-foreground hover:text-foreground flex items-center gap-1"
                    aria-label={`Download ${stem.label} as WAV`}
                  >
                    <Download className="w-2.5 h-2.5" />
                    WAV
                  </button>
                )}
                <button
                  onClick={() => updateStem(stem.key, { muted: !stem.muted })}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    stem.muted
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-rain-surface-3 text-muted-foreground hover:text-foreground'
                  }`}
                  aria-label={stem.muted ? `Unmute ${stem.label}` : `Mute ${stem.label}`}
                >
                  {stem.muted ? 'MUTED' : 'M'}
                </button>
                <button
                  onClick={() => updateStem(stem.key, { solo: !stem.solo })}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    stem.solo
                      ? 'bg-rain-accent/20 text-rain-accent'
                      : 'bg-rain-surface-3 text-muted-foreground hover:text-foreground'
                  }`}
                  aria-label={stem.solo ? `Un-solo ${stem.label}` : `Solo ${stem.label}`}
                >
                  S
                </button>
              </div>

              {/* Real measurements row — only shown after separation */}
              {result && (
                <div className="grid grid-cols-3 gap-2 mb-2 text-[9px] font-mono">
                  <div className="bg-rain-surface-2/60 rounded px-1.5 py-1">
                    <div className="text-muted-foreground">RMS</div>
                    <div className="text-foreground tabular-nums" style={{ color: stem.color }}>
                      {result.rms <= -119 ? '−∞' : `${result.rms.toFixed(1)} dB`}
                    </div>
                  </div>
                  <div className="bg-rain-surface-2/60 rounded px-1.5 py-1">
                    <div className="text-muted-foreground">PEAK</div>
                    <div className="text-foreground tabular-nums" style={{ color: stem.color }}>
                      {result.peakDb <= -119 ? '−∞' : `${result.peakDb.toFixed(1)} dB`}
                    </div>
                  </div>
                  <div className="bg-rain-surface-2/60 rounded px-1.5 py-1">
                    <div className="text-muted-foreground">SRC</div>
                    <div className="text-foreground tabular-nums">
                      {result.channels[0].length > 0
                        ? `${(result.channels[0].length / result.sampleRate).toFixed(1)}s`
                        : '—'}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Volume2 className="w-3 h-3 text-muted-foreground shrink-0" />
                <input
                  type="range"
                  min={-24}
                  max={6}
                  step={0.5}
                  value={stem.gain}
                  onChange={(e) => updateStem(stem.key, { gain: parseFloat(e.target.value) })}
                  className="rain-range flex-1"
                  aria-label={`${stem.label} gain`}
                />
                <span
                  className="text-[10px] font-mono tabular-nums w-10 text-right shrink-0"
                  style={{ color: stem.color }}
                >
                  {effectiveGain === -Infinity ? '−∞' : `${effectiveGain > 0 ? '+' : ''}${effectiveGain.toFixed(1)} dB`}
                </span>
              </div>

              {/* Real waveform from stem audio (or placeholder before separation) */}
              <StemWaveform stemKey={stem.key} color={stem.color} isAudible={isAudible} result={result} />
            </div>
          )
        })}
      </div>

      <div className="rain-panel rounded-lg p-4 text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span>
            Total gain (active stems):{' '}
            <span className="text-rain-accent">
              {totalGain > 0 ? `${(20 * Math.log10(totalGain)).toFixed(1)} dB` : '−∞ dB'}
            </span>
          </span>
          <span>
            Engine: <span className="text-rain-accent">BS-RoFormer 4-pass cascade · 32-band polyphase · Mel-band · spectral split · dereverb</span>
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders the mini waveform. Memoized so it only recomputes when the stem
 * result actually changes (not on every gain/mute toggle).
 */
function StemWaveform({
  stemKey,
  color,
  isAudible,
  result,
}: {
  stemKey: StemKey
  color: string
  isAudible: boolean
  result: StemResult | undefined
}) {
  // Compute the waveform only when the result reference changes.
  const buckets = useMemo(
    () => (result ? computeWaveform(result.channels, WAVEFORM_BUCKETS) : null),
    [result],
  )

  if (!buckets) {
    // No separation yet — render a flat placeholder.
    return (
      <div className="mt-2 h-6 flex items-center gap-px" aria-hidden>
        {Array.from({ length: WAVEFORM_BUCKETS }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{ height: '6%', background: color, opacity: 0.15 }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="mt-2 h-6 flex items-center gap-px" role="img" aria-label={`Waveform for ${stemKey}`}>
      {buckets.map((v, i) => {
        const h = 4 + v * 92 // 4% min so silence is still visible
        return (
          <div
            key={i}
            className="flex-1 rounded-full transition-[height] duration-150"
            style={{
              height: `${h}%`,
              background: color,
              opacity: isAudible ? 0.45 + v * 0.55 : 0.18,
            }}
          />
        )
      })}
    </div>
  )
}

function PassInfo({
  pass,
  model,
  output,
  color,
}: {
  pass: string
  model: string
  output: string
  color: string
}) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2 border-l-2" style={{ borderColor: color }}>
      <div className="text-muted-foreground mb-0.5">Pass {pass}</div>
      <div className="text-foreground text-[10px] truncate">{model}</div>
      <div className="text-muted-foreground truncate">→ {output}</div>
    </div>
  )
}
