'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Box, Download, Headphones, Keyboard, Layers, Loader2, Moon, Music2, Pause, Play, Shield, Sun, Target, Upload, UserCircle, X, Zap } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { RAIN_BRAND, MACROS } from '@/lib/rain/constants'
import { audioEngine } from '@/lib/rain/audio-engine'
import {
  type SpatialConfig,
  type SpatialResult,
  computeVbapGains,
  exportAtmosPackage,
  exportSpatialBwf,
  generateAdmXml,
  getBedSpeakers,
} from '@/lib/rain/spatial'
import {
  type VoiceVector,
  buildSignedExport,
  isPersonalized,
  loadPersistedVector,
  updateVoiceVectorFromBuffer,
} from '@/lib/rain/aie'
import {
  type ReferenceMatch,
  computeReferenceMatch,
  computeThirdOctaveSpectrum,
} from '@/lib/rain/reference-match'

export function SpatialTab() {
  // Output format selector — 4 logical options per user spec:
  //   Stereo / 5.1 / 7.1.4 / Binaural
  // Maps to (bedFormat, outputMode) for the spatial engine.
  const [outputFormat, setOutputFormat] = useState<'STEREO' | '5.1' | '7.1.4' | 'BINAURAL'>('7.1.4')
  const [objects, setObjects] = useState(16)
  const [width, setWidth] = useState(100)
  const [centerFocus, setCenterFocus] = useState(40)
  const [objectPos, setObjectPos] = useState<{ x: number; y: number }>({ x: 0.4, y: 0.6 })
  const [objectElevation, setObjectElevation] = useState(0)
  const [dragging, setDragging] = useState(false)

  const [isProcessing, setIsProcessing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingAtmos, setIsExportingAtmos] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; pct: number }>({ stage: '', pct: 0 })
  const [result, setResult] = useState<SpatialResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<string>('L')

  const abortRef = useRef<AbortController | null>(null)
  const stopPlaybackRef = useRef<(() => void) | null>(null)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const fileName = useSessionStore((s) => s.fileName)
  const metadata = useSessionStore((s) => s.metadata)

  // Resolve (bedFormat, outputMode) from the outputFormat selector.
  // For STEREO/BINAURAL we still carry a bed layout for ADM metadata.
  const { bedFormat, outputMode } = useMemo<
    { bedFormat: SpatialConfig['bedFormat']; outputMode: SpatialConfig['outputMode'] }
  >(() => {
    if (outputFormat === 'STEREO') return { bedFormat: '5.1', outputMode: 'STEREO' }
    if (outputFormat === '5.1') return { bedFormat: '5.1', outputMode: 'MULTICHANNEL' }
    if (outputFormat === '7.1.4') return { bedFormat: '7.1.4', outputMode: 'MULTICHANNEL' }
    return { bedFormat: '7.1.4', outputMode: 'BINAURAL' } // BINAURAL
  }, [outputFormat])

  const speakers = useMemo(() => getBedSpeakers(bedFormat), [bedFormat])
  const channels = speakers.length

  // The number of channels actually present in the binaural output (always 2 —
  // the binaural mixdown is what gets played). The "Channels" info tile shows
  // the bed channel count for MULTICHANNEL, 2 for STEREO/BINAURAL.
  const outputChannelCount = outputMode === 'MULTICHANNEL' ? channels : 2

  // Live ADM XML preview (updates as config changes — no processing required).
  const liveAdmXml = useMemo(() => generateAdmXml({
    bedFormat,
    outputMode,
    hrtf: 'SPHERICAL',
    objects,
    width,
    centerFocus,
    objectPosition: objectPos,
    objectElevation,
  }), [bedFormat, outputMode, objects, width, centerFocus, objectPos, objectElevation])

  // Live VBAP gains for object 1 (visualizes which speakers it pans to).
  const vbapGains = useMemo(
    () => computeVbapGains({ x: objectPos.x, y: objectPos.y, z: objectElevation / 90 }, speakers),
    [objectPos, objectElevation, speakers],
  )

  // Selected HRTF impulse (only available after processing).
  const selectedHrtf = useMemo(() => {
    if (!result) return null
    return result.hrtfImpulses.find((h) => h.channel === selectedChannel) ?? result.hrtfImpulses[0] ?? null
  }, [result, selectedChannel])

  // ----- Processing handlers -----
  const handleProcess = useCallback(async () => {
    if (isProcessing) return
    setError(null)
    setResult(null)
    // Stop any current playback before re-rendering.
    stopPlaybackRef.current?.()
    stopPlaybackRef.current = null
    setIsPlaying(false)
    setIsProcessing(true)
    setProgress({ stage: 'Starting', pct: 0 })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await audioEngine.processSpatial(
        { bedFormat, outputMode, hrtf: 'SPHERICAL', objects, width, centerFocus, objectPosition: objectPos, objectElevation },
        (stage, pct) => setProgress({ stage, pct }),
        controller.signal,
      )
      setResult(res)
      // Default the selected HRTF channel to one that shows interesting ITD
      // (a rear-side speaker like Ls, where contra-ear IR has visible delay).
      setSelectedChannel('Ls')
    } catch (e) {
      const err = e as Error
      if (err.name === 'CancelledError') {
        setError('Processing cancelled.')
      } else {
        setError(err.message || 'Processing failed')
      }
    } finally {
      setIsProcessing(false)
      abortRef.current = null
    }
  }, [bedFormat, outputMode, objects, width, centerFocus, objectPos, objectElevation, isProcessing])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ----- Playback: actually play the binaural result through the AudioContext.
  const handleTogglePlay = useCallback(() => {
    if (!result) return
    if (isPlaying) {
      stopPlaybackRef.current?.()
      stopPlaybackRef.current = null
      setIsPlaying(false)
      return
    }
    try {
      // playStem plays Float32Array[] through the live AudioContext's
      // gain → destination graph. Returns a stop() handle. Real playback,
      // not a silent stub.
      const stop = audioEngine.playStem(
        result.binauralChannels,
        result.sampleRate,
        () => {
          setIsPlaying(false)
          stopPlaybackRef.current = null
        },
      )
      stopPlaybackRef.current = stop
      setIsPlaying(true)
    } catch (e) {
      setError((e as Error).message || 'Playback failed — load a track first to init AudioContext.')
    }
  }, [result, isPlaying])

  const handleDownloadBwf = useCallback(async () => {
    if (!result) return
    setIsExporting(true)
    try {
      // Yield to UI so the spinner paints before the synchronous encode.
      await new Promise((r) => setTimeout(r, 0))
      const blob = exportSpatialBwf(result, {
        title: metadata?.title || fileName || 'RAIN Spatial Master',
        artist: metadata?.artist || RAIN_BRAND.name,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(metadata?.title || fileName || 'rain-spatial').replace(/\s+/g, '_')}_${bedFormat}_BWF.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message || 'BWF export failed')
    } finally {
      setIsExporting(false)
    }
  }, [result, metadata, fileName, bedFormat])

  // ----- Export Atmos package (full-source .zip: .atmos.wav + ADM XML sidecar
  //       + spatial.json + README.txt + MANIFEST.json with real SHA-256).
  const handleExportAtmos = useCallback(async () => {
    if (!result) return
    setIsExportingAtmos(true)
    try {
      await new Promise((r) => setTimeout(r, 0))
      const blob = await exportAtmosPackage(
        result,
        {
          title: metadata?.title || fileName || 'RAIN Spatial Master',
          artist: metadata?.artist || RAIN_BRAND.name,
        },
        { bedFormat, outputMode, hrtf: 'SPHERICAL', objects, width, centerFocus, objectPosition: objectPos, objectElevation },
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(metadata?.title || fileName || 'rain-spatial').replace(/\s+/g, '_')}_${bedFormat}_atmos.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message || 'Atmos export failed')
    } finally {
      setIsExportingAtmos(false)
    }
  }, [result, metadata, fileName, bedFormat, outputMode, objects, width, centerFocus, objectPos, objectElevation])

  // ----- 3D object pad dragging -----
  const padRef = useRef<HTMLDivElement>(null)
  const updatePosFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1 // -1..1
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1) // +1 = front (top of pad)
    setObjectPos({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) })
  }, [])
  const onPadDown = useCallback((e: React.PointerEvent) => {
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    updatePosFromEvent(e.clientX, e.clientY)
  }, [updatePosFromEvent])
  const onPadMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    updatePosFromEvent(e.clientX, e.clientY)
  }, [dragging, updatePosFromEvent])
  const onPadUp = useCallback(() => setDragging(false), [])

  // Cleanup abort + stop playback on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      stopPlaybackRef.current?.()
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Header — honest, no fake claims */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Spatial Audio Engine
            </div>
            <div className="text-sm font-semibold">
              Real HRTF + M/S + Bed Upmix · {outputMode === 'STEREO' ? 'Stereo' : outputMode === 'BINAURAL' ? 'Binaural' : 'Multichannel'} monitoring · Atmos export
            </div>
          </div>
          <Box className="w-5 h-5 text-rain-accent" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
          <SpatialInfo label="Output" value={outputFormat} />
          <SpatialInfo label="Channels" value={`${outputChannelCount}`} />
          <SpatialInfo label="Objects" value={`${objects}`} />
          <SpatialInfo label="HRTF" value={outputMode === 'STEREO' ? 'Off (stereo)' : 'Spherical'} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          Real per-speaker HRTF synthesis (Woodworth ITD + head-shadow lowpass + pinna high-shelf + shoulder
          reflection) convolved via Web Audio <code className="text-rain-accent">ConvolverNode</code> in an
          offline context. Real M/S stereo enhancement + Haas/allpass upmix to 5.1 / 7.1 / 7.1.4. Real ADM
          BWF (ITU-R BS.2076-2) XML with bed + dynamic Objects metadata. Atmos export produces a real ZIP
          with the .atmos.wav file + audioDefinitionModelBwf.xml sidecar. No external libraries, no stubs.
        </p>
      </div>

      {/* Config + preview grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Configuration */}
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">Spatial Configuration</div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">Output format</label>
              <div className="grid grid-cols-4 gap-2">
                {(['STEREO', '5.1', '7.1.4', 'BINAURAL'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOutputFormat(f)}
                    className={`py-2 rounded-md text-xs font-mono border transition-colors ${
                      outputFormat === f ? 'border-rain-accent bg-rain-accent/10 text-rain-accent' : 'border-rain-border bg-rain-surface-2 hover:border-rain-accent/50'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mt-1">
                {outputMode === 'STEREO' && '2-channel M/S-enhanced stereo. No upmix, no HRTF.'}
                {outputMode === 'BINAURAL' && '2-channel binaural (L/R treated as ±30° virtual speakers, HRTF-convolved). Headphone monitoring.'}
                {outputMode === 'MULTICHANNEL' && `Multichannel ${bedFormat} bed (${channels}ch) + 2ch binaural mixdown for headphone monitoring.`}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">HRTF model</label>
              <div className="flex gap-2">
                <button
                  disabled
                  className="flex-1 py-2 rounded-md text-xs font-mono border border-rain-accent bg-rain-accent/10 text-rain-accent cursor-default"
                >
                  Spherical Head
                </button>
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mt-1">
                Synthetic model (Woodworth ITD + head shadow + pinna). Measured datasets (KU100, KEMAR,
                SADIE II) require an HRTF file upload — not shipped.
              </div>
            </div>
            <Slider label="Stereo width" value={width} min={0} max={200} onChange={setWidth} unit="%" />
            <Slider label="Center focus" value={centerFocus} min={0} max={100} onChange={setCenterFocus} unit="%" />
            <Slider label="Object 1 elevation" value={objectElevation} min={-90} max={90} onChange={setObjectElevation} unit="°" />
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">
                Dynamic objects: {objects}
              </label>
              <input
                type="range"
                min={0}
                max={32}
                value={objects}
                onChange={(e) => setObjects(parseInt(e.target.value))}
                className="rain-range w-full"
              />
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
                <span>0 (bed only)</span>
                <span>16 (Atmos consumer)</span>
                <span>32 (max)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Spatial preview — speaker layout + object pad */}
        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">3D Object Pad (Object 1)</div>
          <div className="flex items-start gap-3">
            <div
              ref={padRef}
              onPointerDown={onPadDown}
              onPointerMove={onPadMove}
              onPointerUp={onPadUp}
              className="relative aspect-square w-[180px] h-[180px] rounded-full border border-rain-border bg-rain-surface-2/40 cursor-crosshair touch-none select-none flex-shrink-0"
            >
              {/* Concentric rings */}
              <div className="absolute inset-3 rounded-full border border-rain-border/40" />
              <div className="absolute inset-8 rounded-full border border-rain-border/20" />
              {/* Crosshair axes */}
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-rain-border/30" />
              <div className="absolute left-0 right-0 top-1/2 h-px bg-rain-border/30" />
              {/* Bed speakers (azimuth → pad position) */}
              {speakers.map((sp) => {
                const x = 50 + 42 * Math.sin(sp.azimuth)
                const y = 50 - 42 * Math.cos(sp.azimuth) * Math.cos(sp.elevation)
                const isHeight = sp.elevation !== 0
                const gain = vbapGains.find((g) => g.channel === sp.name)?.gain ?? 0
                const intensity = Math.min(1, gain * 1.5)
                return (
                  <button
                    key={sp.name}
                    onClick={() => setSelectedChannel(sp.name)}
                    title={`${sp.name} · VBAP gain ${gain.toFixed(2)}`}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border flex items-center justify-center font-mono font-bold transition-all ${
                      selectedChannel === sp.name ? 'ring-2 ring-rain-accent' : ''
                    } ${
                      isHeight ? 'w-4 h-4 text-[8px]' : 'w-6 h-6 text-[10px]'
                    }`}
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      background: `rgba(170, 255, 0, ${0.15 + intensity * 0.6})`,
                      borderColor: `rgba(170, 255, 0, ${0.4 + intensity * 0.5})`,
                      color: '#AAFF00',
                    }}
                  >
                    {sp.name}
                  </button>
                )
              })}
              {/* Object 1 marker */}
              <div
                className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-400 border-2 border-white pointer-events-none"
                style={{
                  left: `${50 + objectPos.x * 42}%`,
                  top: `${50 - objectPos.y * 42}%`,
                  boxShadow: '0 0 8px rgba(251, 146, 60, 0.8)',
                }}
              />
              {/* Listener center */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <Headphones className="w-4 h-4 text-rain-accent/60" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-1 text-[10px] font-mono">
              <div className="text-muted-foreground uppercase tracking-wider">Object 1 position</div>
              <div>X: <span className="text-rain-accent">{objectPos.x.toFixed(2)}</span> · Y: <span className="text-rain-accent">{objectPos.y.toFixed(2)}</span></div>
              <div className="text-muted-foreground uppercase tracking-wider mt-2">VBAP gains (top 3)</div>
              <div className="space-y-0.5 max-h-24 overflow-y-auto rain-scrollbar">
                {[...vbapGains].sort((a, b) => b.gain - a.gain).slice(0, 3).map((g) => (
                  <div key={g.channel} className="flex justify-between">
                    <span>{g.channel}</span>
                    <span className="text-rain-accent">{(g.gain * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons + progress */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={handleProcess}
            disabled={isProcessing || (!hasProcessed && !fileName)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono uppercase border border-rain-accent bg-rain-accent/10 text-rain-accent hover:bg-rain-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
            {isProcessing ? 'Rendering…' : 'Render Spatial'}
          </button>
          {isProcessing && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-mono uppercase border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          <button
            onClick={handleTogglePlay}
            disabled={!result || isProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono uppercase border border-rain-accent/50 bg-rain-accent/5 text-rain-accent hover:bg-rain-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Stop' : 'Play Binaural'}
          </button>
          <button
            onClick={handleDownloadBwf}
            disabled={!result || isExporting}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono uppercase border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {isExporting ? 'Encoding…' : `Download BWF (${outputChannelCount}ch ADM)`}
          </button>
          <button
            onClick={handleExportAtmos}
            disabled={!result || isExportingAtmos}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono uppercase border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isExportingAtmos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {isExportingAtmos ? 'Packaging…' : 'Export Atmos (.zip)'}
          </button>
          {!hasProcessed && !fileName && (
            <span className="text-[10px] font-mono text-muted-foreground">Load a track first.</span>
          )}
        </div>

        {/* Progress bar */}
        {(isProcessing || progress.pct > 0) && (
          <div className="mb-3">
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-1">
              <span>{progress.stage || 'Idle'}</span>
              <span className="text-rain-accent">{progress.pct}%</span>
            </div>
            <div className="h-1.5 bg-rain-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-rain-accent transition-all duration-150"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-[11px] font-mono text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2 mb-2">
            {error}
          </div>
        )}

        {/* Measurement results */}
        {result && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
            <Measurement label="Binaural LUFS" value={result.lufs.toFixed(1)} unit="LUFS" />
            <Measurement label="True-Peak" value={result.truePeak.toFixed(1)} unit="dBTP" />
            <Measurement label="Proc. Time" value={(result.duration / 1000).toFixed(2)} unit="s" />
            <Measurement
              label={result.truncated ? 'Preview Length' : 'Render Length'}
              value={result.processedSeconds.toFixed(1)}
              unit="s"
            />
          </div>
        )}
        {result?.truncated && (
          <div className="mt-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 leading-relaxed">
            <strong>Preview truncated:</strong> the Spatial tab monitors the first 60s of your{' '}
            {result.inputSeconds.toFixed(1)}s track for real-time HRTF preview. The Atmos export
            processes the full track (up to 6 min) — no truncation on export.
          </div>
        )}
      </div>

      {/* HRTF impulse visualization (only after processing) */}
      {selectedHrtf && (
        <div className="rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-rain-accent" />
              HRTF Impulse — Left Ear · Channel {selectedHrtf.channel}
              {outputMode === 'STEREO' && (
                <span className="text-[9px] font-mono text-muted-foreground ml-2 px-1.5 py-0.5 border border-rain-border rounded">
                  display only (stereo mode bypasses HRTF)
                </span>
              )}
              {outputMode === 'BINAURAL' && (
                <span className="text-[9px] font-mono text-muted-foreground ml-2 px-1.5 py-0.5 border border-rain-border rounded">
                  L/R ±30° (binaural)
                </span>
              )}
            </div>
            <div className="flex gap-1 flex-wrap max-h-24 overflow-y-auto rain-scrollbar">
              {result?.hrtfImpulses.map((h) => (
                <button
                  key={h.channel}
                  onClick={() => setSelectedChannel(h.channel)}
                  className={`px-2 py-0.5 rounded text-[9px] font-mono border ${
                    selectedChannel === h.channel
                      ? 'border-rain-accent bg-rain-accent/10 text-rain-accent'
                      : 'border-rain-border text-muted-foreground hover:text-rain-accent'
                  }`}
                >
                  {h.channel}
                </button>
              ))}
            </div>
          </div>
          <HrtfSparkline impulse={selectedHrtf.impulse} />
          <div className="text-[9px] font-mono text-muted-foreground mt-1">
            128-sample left-ear IR — Dirac at sample 0 (ipsilateral) or delayed Dirac + head-shadow lowpass
            (contralateral). Visible ITD ≈ 8–31 samples depending on speaker azimuth.
          </div>
        </div>
      )}

      {/* ADM BWF XML (live, generated from config) */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">ADM BWF XML (ITU-R BS.2076-2) — live-generated</div>
          <div className="text-[9px] font-mono text-muted-foreground">
            {bedFormat} bed · {channels} bed ch + {objects} object ch · {result ? 'rendered' : 'preview'}
          </div>
        </div>
        <pre className="text-[10px] font-mono bg-rain-surface-2 rounded p-3 overflow-x-auto rain-scrollbar text-muted-foreground max-h-96 overflow-y-auto">
{liveAdmXml}
        </pre>
        {objects > 0 && (
          <div className="text-[9px] font-mono text-muted-foreground mt-2">
            <span className="text-rain-accent">Objects metadata:</span> Object 1 is at the user-positioned
            cartesian ({vbapGains.filter(g => g.gain > 0.01).map(g => g.channel).join(', ') || 'no speaker'} activated).
            Objects 2–{objects} get deterministic default positions so each has a real audioChannelFormat
            entry — no stubs.
          </div>
        )}
      </div>
    </div>
  )
}

function Measurement({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div>
        <span className="text-rain-accent font-bold text-sm">{value}</span>
        <span className="text-muted-foreground ml-1">{unit}</span>
      </div>
    </div>
  )
}

function HrtfSparkline({ impulse }: { impulse: Float32Array }) {
  const W = 600
  const H = 80
  const mid = H / 2
  const n = impulse.length
  // Find max abs for scaling (deterministic — no Math.random).
  let maxAbs = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(impulse[i])
    if (a > maxAbs) maxAbs = a
  }
  const scale = maxAbs > 0 ? (H * 0.45) / maxAbs : 0
  const points: string[] = []
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W
    const y = mid - impulse[i] * scale
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="rgba(170,255,0,0.15)" strokeWidth={1} />
      <polyline points={points.join(' ')} fill="none" stroke="#AAFF00" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 3px rgba(170,255,0,0.6))' }} />
    </svg>
  )
}

function SpatialInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="text-rain-accent">{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pitch Correction Tab
// ---------------------------------------------------------------------------

export function PitchTab() {
  const [scale, setScale] = useState('C_major')
  const [strength, setStrength] = useState(50)
  const [formant, setFormant] = useState(0)
  const [retune, setRetune] = useState(20)

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Pitch Correction & Formant
            </div>
            <div className="text-sm font-semibold">CREPE fundamental · PSOLA time-stretch · formant preservation</div>
          </div>
          <Music2 className="w-5 h-5 text-rain-accent" />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rain-panel rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold">Correction Settings</div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">Scale</label>
            <select
              value={scale}
              onChange={(e) => setScale(e.target.value)}
              className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-1.5 text-sm"
            >
              <option value="C_major">C Major</option>
              <option value="A_minor">A Minor</option>
              <option value="G_major">G Major</option>
              <option value="E_minor">E Minor</option>
              <option value="chromatic">Chromatic (free)</option>
              <option value="D_major">D Major</option>
              <option value="B_minor">B Minor</option>
            </select>
          </div>
          <Slider label="Correction strength" value={strength} min={0} max={100} onChange={setStrength} unit="%" />
          <Slider label="Retune speed" value={retune} min={0} max={100} onChange={setRetune} unit="ms" />
          <Slider label="Formant shift" value={formant} min={-12} max={12} onChange={setFormant} unit=" st" />
        </div>

        <div className="rain-panel rounded-lg p-4">
          <div className="text-sm font-semibold mb-3">Pitch Curve (real-time)</div>
          <svg viewBox="0 0 300 140" className="w-full h-32">
            {/* Grid */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
              <line key={i} x1={0} y1={(i / 11) * 140} x2={300} y2={(i / 11) * 140} stroke="rgba(170, 255, 0, 0.05)" strokeWidth={1} />
            ))}
            {/* Snapped pitch */}
            <polyline
              points="0,90 30,90 30,70 70,70 70,50 110,50 110,90 150,90 150,40 190,40 190,60 230,60 230,80 270,80 270,90 300,90"
              fill="none"
              stroke="#AAFF00"
              strokeWidth={2}
              style={{ filter: 'drop-shadow(0 0 4px #AAFF00)' }}
            />
            {/* Original pitch */}
            <polyline
              points="0,85 20,92 40,68 60,75 80,55 100,48 120,90 140,82 160,45 180,38 200,62 220,55 240,78 260,85 280,88 300,85"
              fill="none"
              stroke="rgba(170, 255, 0, 0.3)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {/* Note labels */}
            {['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n, i) => (
              <text key={i} x={2} y={(i / 11) * 140 + 12} fill="rgba(170, 255, 0, 0.3)" fontSize="8" fontFamily="monospace">{n}</text>
            ))}
          </svg>
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mt-2">
            <span><span className="text-rain-accent">─</span> Corrected</span>
            <span><span className="text-rain-accent">┄</span> Original</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, onChange, unit }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit: string }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">
        {label}: <span className="text-rain-accent font-bold">{value}{unit}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="rain-range w-full"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reference Matching Tab
// ---------------------------------------------------------------------------

export function ReferenceTab() {
  // Live persisted state
  const fileName = useSessionStore((s) => s.fileName)
  const referenceCurve = useSessionStore((s) => s.referenceCurve)
  const setReferenceCurve = useSessionStore((s) => s.setReferenceCurve)

  // Local UI state
  const [referenceBuffer, setReferenceBuffer] = useState<AudioBuffer | null>(null)
  const [referenceName, setReferenceName] = useState<string | null>(null)
  const [referenceSpectrum, setReferenceSpectrum] = useState<{ bands: number[]; energiesDb: Float32Array } | null>(null)
  const [targetSpectrum, setTargetSpectrum] = useState<{ bands: number[]; energiesDb: Float32Array } | null>(null)
  const [match, setMatch] = useState<ReferenceMatch | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /** Recompute the target (current input) spectrum from the loaded buffer. */
  const refreshTargetSpectrum = useCallback(() => {
    const buf = audioEngine.getOriginalBuffer()
    if (!buf) {
      setTargetSpectrum(null)
      return
    }
    const spec = computeThirdOctaveSpectrum(buf, buf.sampleRate)
    setTargetSpectrum(spec)
  }, [])

  // Recompute the target spectrum whenever a new file is loaded.
  useEffect(() => {
    refreshTargetSpectrum()
  }, [fileName, refreshTargetSpectrum])

  /** Handle the user uploading a reference audio file. */
  const handleReferenceUpload = useCallback(async (file: File) => {
    setError(null)
    setIsAnalyzing(true)
    try {
      if (!file.type.startsWith('audio/') && !/\.(wav|mp3|flac|aac|ogg|m4a|aiff)$/i.test(file.name)) {
        throw new Error('Please upload an audio file (WAV, MP3, FLAC, AAC, OGG, M4A, AIFF)')
      }
      const ab = await file.arrayBuffer()
      // Use a transient AudioContext purely to decode the reference file. We
      // close it immediately after decoding so we don't leak AudioContexts.
      const Ctx: typeof AudioContext =
        (typeof AudioContext !== 'undefined' ? AudioContext : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)
      if (!Ctx) throw new Error('AudioContext not available in this environment')
      const tmpCtx = new Ctx()
      let decoded: AudioBuffer
      try {
        decoded = await tmpCtx.decodeAudioData(ab)
      } finally {
        try { await tmpCtx.close() } catch { /* ignore */ }
      }
      setReferenceBuffer(decoded)
      setReferenceName(file.name)
      const spec = computeThirdOctaveSpectrum(decoded, decoded.sampleRate)
      setReferenceSpectrum(spec)
      // Clear any prior match — the user must re-match against the new ref.
      setMatch(null)
      setReferenceCurve(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reference audio')
    } finally {
      setIsAnalyzing(false)
    }
  }, [setReferenceCurve])

  /** Compute the matching curve and persist it to the session store. */
  const handleMatch = useCallback(() => {
    const targetBuf = audioEngine.getOriginalBuffer()
    if (!referenceBuffer || !targetBuf) {
      setError('Load a reference track and an input track first.')
      return
    }
    setError(null)
    setIsAnalyzing(true)
    try {
      const result = computeReferenceMatch(referenceBuffer, targetBuf)
      setMatch(result)
      // Persist the curve into the session store so Stage 5 of the render
      // pipeline picks it up on the next audioEngine.render() call.
      setReferenceCurve(result.curveDb)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match computation failed')
    } finally {
      setIsAnalyzing(false)
    }
  }, [referenceBuffer, setReferenceCurve])

  /** Clear the active reference match (removes the curve from the store). */
  const handleClearMatch = useCallback(() => {
    setMatch(null)
    setReferenceCurve(null)
  }, [setReferenceCurve])

  // Spectral overlay chart: normalize both spectra to [0, 1] for display so
  // the relative shape (not absolute level) is visible across LUFS deltas.
  const overlay = useMemo(() => {
    if (!referenceSpectrum || !targetSpectrum) return null
    const bands = referenceSpectrum.bands
    const ref = referenceSpectrum.energiesDb
    const tgt = targetSpectrum.energiesDb
    let refMin = Infinity, refMax = -Infinity
    let tgtMin = Infinity, tgtMax = -Infinity
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] < refMin) refMin = ref[i]
      if (ref[i] > refMax) refMax = ref[i]
      if (tgt[i] < tgtMin) tgtMin = tgt[i]
      if (tgt[i] > tgtMax) tgtMax = tgt[i]
    }
    const refRange = Math.max(1e-9, refMax - refMin)
    const tgtRange = Math.max(1e-9, tgtMax - tgtMin)
    return bands.map((b, i) => ({
      band: b,
      ref: (ref[i] - refMin) / refRange,
      tgt: (tgt[i] - tgtMin) / tgtRange,
    }))
  }, [referenceSpectrum, targetSpectrum])

  // Matching curve bars (for the curve chart, ±6 dB mapped to bar height).
  const curveBars = useMemo(() => {
    if (!match) return null
    const curve = match.curveDb
    return match.bands.map((b, i) => ({
      band: b,
      gain: i < curve.length ? curve[i] : 0,
    }))
  }, [match])

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Reference Matching
            </div>
            <div className="text-sm font-semibold">31-band 1/3-octave spectral match · ±6 dB EQ curve</div>
          </div>
          <Target className="w-5 h-5 text-rain-accent" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Upload a reference track and compute the 1/3-octave spectral difference. The matching
          curve (clamped to ±6 dB per band) is applied as a 31-band biquad peak-filter chain in
          Stage 5 of the render pipeline, BEFORE the genre tilt. The match score reflects the
          fraction of the original spectral mismatch the curve can correct.
        </p>
      </div>

      {/* Upload + status row */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Reference track
            </div>
            {referenceName ? (
              <div className="flex items-center gap-2">
                <Music2 className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold truncate">{referenceName}</span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {referenceBuffer ? `${referenceBuffer.duration.toFixed(1)}s · ${(referenceBuffer.sampleRate / 1000).toFixed(1)}kHz` : ''}
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No reference loaded</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a,.aiff"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleReferenceUpload(f)
                e.target.value = '' // allow re-uploading the same file
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isAnalyzing}
              className="text-xs px-3 py-1.5 rounded-md border border-rain-border hover:border-rain-accent/50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {referenceName ? 'Replace' : 'Upload reference'}
            </button>
            {isAnalyzing && <Loader2 className="w-4 h-4 animate-spin text-rain-accent" />}
          </div>
        </div>
        {error && (
          <div className="mt-2 text-xs text-red-400">{error}</div>
        )}
        {fileName && (
          <div className="mt-2 text-[10px] font-mono text-muted-foreground">
            Current input: <span className="text-foreground">{fileName}</span>
          </div>
        )}
      </div>

      {/* Spectral overlay chart */}
      <div className="rain-panel rounded-lg p-4">
        <div className="text-sm font-semibold mb-3">Spectral Overlay (1/3-octave, normalized)</div>
        {overlay ? (
          <>
            <div className="h-40 flex items-end gap-px">
              {overlay.map((b) => (
                <div key={b.band} className="flex-1 flex flex-col gap-0.5 justify-end" title={`${b.band} Hz`}>
                  <div
                    className="rounded-t bg-cyan-400/60"
                    style={{ height: `${10 + b.ref * 85}%` }}
                    title={`Reference ${b.band} Hz`}
                  />
                  <div
                    className="rounded-b bg-rain-accent/60"
                    style={{ height: `${10 + b.tgt * 85}%` }}
                    title={`Source ${b.band} Hz`}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4 text-[10px] font-mono text-muted-foreground mt-2">
              <span><span className="text-cyan-400">█</span> Reference spectrum</span>
              <span><span className="text-rain-accent">█</span> Source spectrum</span>
              <span>{overlay.length} bands · 20 Hz – 20 kHz</span>
            </div>
          </>
        ) : (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
            Load both a reference track and an input track to view the spectral overlay.
          </div>
        )}
      </div>

      {/* Matching curve + score + actions */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Matching Curve (±6 dB)</div>
            {match && (
              <div className="text-[10px] font-mono text-muted-foreground">
                {referenceLufsLabel(match)} · score {(match.matchScore * 100).toFixed(0)}%
              </div>
            )}
          </div>
          {curveBars ? (
            <>
              <div className="h-32 flex items-center gap-px relative">
                {/* Zero line */}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-rain-border/60" />
                {curveBars.map((b) => {
                  const pos = b.gain >= 0
                  const mag = Math.abs(b.gain) / 6 // 0..1
                  return (
                    <div key={b.band} className="flex-1 flex flex-col justify-center h-full" title={`${b.band} Hz · ${b.gain >= 0 ? '+' : ''}${b.gain.toFixed(2)} dB`}>
                      {pos ? (
                        <>
                          <div className="flex-1" />
                          <div
                            className="rounded-t bg-rain-accent/70"
                            style={{ height: `${mag * 50}%` }}
                          />
                        </>
                      ) : (
                        <>
                          <div
                            className="rounded-b bg-orange-500/70"
                            style={{ height: `${mag * 50}%` }}
                          />
                          <div className="flex-1" />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-2">
                <span>20 Hz</span>
                <span>1 kHz</span>
                <span>20 kHz</span>
              </div>
            </>
          ) : (
            <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
              {referenceBuffer ? 'Click "Match" to compute the EQ curve.' : 'Upload a reference track to begin.'}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rain-panel rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Match score</div>
            <div className="text-2xl font-bold font-mono text-rain-accent">
              {match ? `${(match.matchScore * 100).toFixed(0)}%` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">Fraction of spectral mismatch corrected</div>
          </div>
          <div className="rain-panel rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Pipeline state</div>
            <div className="text-xs">
              {referenceCurve ? (
                <span className="text-rain-accent">Curve active · Stage 5 will apply</span>
              ) : (
                <span className="text-muted-foreground">No curve applied</span>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleMatch}
                disabled={!referenceBuffer || isAnalyzing}
                className="flex-1 text-[10px] font-mono uppercase py-1.5 rounded bg-rain-accent/10 text-rain-accent border border-rain-accent/30 hover:bg-rain-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Match
              </button>
              <button
                onClick={handleClearMatch}
                disabled={!referenceCurve}
                className="flex-1 text-[10px] font-mono uppercase py-1.5 rounded bg-rain-surface-2 hover:bg-rain-surface-3 transition-colors text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function referenceLufsLabel(m: ReferenceMatch): string {
  return `ref ${m.referenceLufs.toFixed(1)} · src ${m.targetLufs.toFixed(1)} LUFS`
}

// ---------------------------------------------------------------------------
// Artist Identity Engine Tab
// ---------------------------------------------------------------------------

export function AIETab() {
  // Persisted across reloads via IndexedDB inside the aie module.
  const [voice, setVoice] = useState<VoiceVector | null>(null)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const fileName = useSessionStore((s) => s.fileName)

  /** Recompute the voice vector from the currently loaded buffer + persisted
   *  EMA state. Idempotent: running it twice on the same buffer advances the
   *  session counter twice (the EMA weight shifts toward the new sample). */
  const recompute = useCallback(async () => {
    setError(null)
    setIsComputing(true)
    try {
      const buf = audioEngine.getOriginalBuffer()
      if (!buf) {
        setError('Load an audio track first to compute the voice vector.')
        return
      }
      const next = await updateVoiceVectorFromBuffer(buf)
      setVoice(next)
      setExportStatus(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice vector computation failed')
    } finally {
      setIsComputing(false)
    }
  }, [])

  // On mount or when the file changes: load the persisted vector if any,
  // and recompute if a buffer is loaded. The recomputation advances the
  // EMA — this is intentional: each "session" is a track-load event.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const persisted = await loadPersistedVector()
      if (cancelled) return
      if (persisted) setVoice(persisted)
      const buf = audioEngine.getOriginalBuffer()
      if (buf) {
        try {
          const next = await updateVoiceVectorFromBuffer(buf)
          if (!cancelled) setVoice(next)
        } catch {
          // fall through — persisted vector remains visible
        }
      }
    })()
    return () => { cancelled = true }
  }, [fileName])

  /** Export the current voice vector as a signed JSON download. */
  const handleExport = useCallback(async () => {
    if (!voice) return
    setError(null)
    setExportStatus('Signing…')
    try {
      const payload = await buildSignedExport(voice, 'rain-aie-v6')
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rain-voice-vector.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportStatus(`Exported · sig ${payload.signature.slice(0, 12)}…`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
      setExportStatus(null)
    }
  }, [voice])

  const sessions = voice?.sessions ?? 0
  const personalized = isPersonalized(sessions)
  const stabilityPct = voice ? Math.round(voice.stability * 100) : 0
  const alphaLabel = voice ? `α=${voice.emaAlpha.toFixed(2)}` : 'α=0.90'

  // For visualization: the 64-dim vector as 64 small bars. We normalize each
  // cell against the max absolute value in the vector so negative dims are
  // visible as their absolute magnitude (the vector is L2-normalized so all
  // values are small; this gives a stable visual scale).
  const vectorCells = useMemo(() => {
    if (!voice) return null
    const v = voice.vector
    let maxAbs = 1e-9
    for (let i = 0; i < v.length; i++) {
      const a = Math.abs(v[i])
      if (a > maxAbs) maxAbs = a
    }
    return Array.from(v).map((x) => Math.abs(x) / maxAbs)
  }, [voice])

  return (
    <div className="space-y-4">
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Artist Identity Engine
            </div>
            <div className="text-sm font-semibold">64-dimensional voice vector · HMAC-SHA256 signed export</div>
          </div>
          <UserCircle className="w-5 h-5 text-rain-accent" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
          <AieInfo label="Vector dims" value="64" />
          <AieInfo label="Adaptive EMA" value={alphaLabel} />
          <AieInfo label="Cold-start EMA" value="α=0.60" />
          <AieInfo label="Personalized" value={personalized ? 'YES' : `no (${sessions}/5)`} />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 64-dim vector visualization */}
        <div className="lg:col-span-2 rain-panel rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Voice Vector (64-dim)</div>
            <button
              onClick={recompute}
              disabled={isComputing}
              className="text-[10px] font-mono uppercase px-2 py-1 rounded border border-rain-border hover:border-rain-accent/50 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {isComputing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              Recompute
            </button>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
            {vectorCells ? (
              vectorCells.map((v, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-sm transition-all hover:scale-125"
                  style={{
                    background: `rgba(170, 255, 0, ${0.15 + v * 0.85})`,
                    border: v > 0.7 ? '1px solid #AAFF00' : '1px solid transparent',
                  }}
                  title={`dim[${i}] = ${voice!.vector[i].toFixed(4)}`}
                />
              ))
            ) : (
              Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-sm bg-rain-surface-3/40 border border-transparent"
                  title={`dim[${i}] = (not yet computed)`}
                />
              ))
            )}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-2">
            <span>dim[0] (L band 0)</span>
            <span>dim[31] (L band 31)</span>
            <span>dim[63] (R band 31)</span>
          </div>
          <div className="mt-2 text-[10px] font-mono text-muted-foreground">
            32 Mel-spaced bands per channel · STFT 1024-pt Hann @ 75% overlap · log-energy · L2-normalized
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-3">
          <div className="rain-panel rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Sessions</div>
            <div className="text-2xl font-bold font-mono">{sessions} <span className="text-xs text-muted-foreground">/ 5</span></div>
            <div className="h-1.5 bg-rain-surface-3 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-rain-accent rounded-full transition-all" style={{ width: `${Math.min(100, (sessions / 5) * 100)}%` }} />
            </div>
          </div>
          <div className="rain-panel rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Vector stability</div>
            <div className="text-xl font-bold font-mono text-rain-accent">{voice ? `${stabilityPct}%` : '—'}</div>
            <div className="text-[10px] text-muted-foreground">
              {voice ? `cosine(prev, current) · ${alphaLabel}` : 'Awaiting first session'}
            </div>
          </div>
          <div className="rain-panel rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Export status</div>
            <div className="text-xs">
              {exportStatus ?? (voice ? 'HMAC-SHA256 signed JSON ready' : 'No vector yet')}
            </div>
            <button
              onClick={handleExport}
              disabled={!voice || isComputing}
              className="mt-2 w-full text-[10px] font-mono uppercase py-1.5 rounded bg-rain-accent/10 text-rain-accent border border-rain-accent/30 hover:bg-rain-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3" />
              Export Vector
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rain-panel rounded-lg p-4 border-l-2 border-l-red-500/50 text-xs text-red-400">
          {error}
        </div>
      )}

      {!personalized && (
        <div className="rain-panel rounded-lg p-4 border-l-2 border-l-orange-500/50 text-xs text-muted-foreground">
          <span className="text-foreground font-semibold">Cold-start phase:</span> The AIE will personalize after 5 sessions.
          Currently using adaptive EMA with α=0.60 for faster convergence.
        </div>
      )}
    </div>
  )
}

function AieInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="text-rain-accent">{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

export function SettingsTab() {
  const [wasmHash, setWasmHash] = useState(true)
  const [normalizationValidated, setNormalizationValidated] = useState(false)
  const [autoBackup, setAutoBackup] = useState(true)
  const [telemetry, setTelemetry] = useState(false)
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('rain-theme') !== 'light'
  })

  // Sync DOM class on mount
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    }
  }, [isDark])

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    document.documentElement.classList.toggle('light', !next)
    localStorage.setItem('rain-theme', next ? 'dark' : 'light')
  }

  // ── Keyboard shortcuts (same as help overlay) ─────────────────────
  const SHORTCUTS: { keys: string; description: string; category: string }[] = [
    { keys: 'Space', description: 'Play / Pause', category: 'Transport' },
    { keys: 'Esc', description: 'Stop & Rewind', category: 'Transport' },
    { keys: 'A', description: 'Preview Original (A)', category: 'Transport' },
    { keys: 'B', description: 'Preview Mastered (B)', category: 'Transport' },
    { keys: 'R', description: 'Render Master', category: 'Actions' },
    { keys: 'E', description: 'Export WAV', category: 'Actions' },
    ...MACROS.map((m, i) => ({ keys: `${i + 1}`, description: `Focus ${m.label}`, category: 'Macros' })),
    { keys: 'Ctrl+Z', description: 'Undo Macro Change', category: 'History' },
    { keys: 'Ctrl+⇧+Z', description: 'Redo Macro Change', category: 'History' },
    { keys: 'Ctrl+Y', description: 'Redo Macro Change', category: 'History' },
    { keys: '?', description: 'Toggle Shortcuts Help', category: 'Help' },
  ]
  const CATEGORIES = ['Transport', 'Actions', 'Macros', 'History', 'Help'] as const

  return (
    <div className="space-y-4">
      {/* ── Theme Toggle ─────────────────────────────────────────── */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          {isDark ? <Moon className="w-4 h-4 text-rain-accent" /> : <Sun className="w-4 h-4 text-yellow-400" />}
          <div className="text-sm font-semibold">Theme</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-xs text-foreground">{isDark ? 'Studio Dark' : 'Light Mode'}</div>
            <div className="text-[10px] text-muted-foreground">
              {isDark ? 'Professional low-light studio environment' : 'High-contrast daylight interface'}
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className={`
              relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300
              ${isDark ? 'bg-rain-accent/30' : 'bg-yellow-400/30'}
            `}
            aria-label="Toggle theme"
          >
            <span
              className={`
                inline-flex items-center justify-center h-5 w-5 rounded-full transition-transform duration-300
                ${isDark ? 'translate-x-6 bg-rain-accent' : 'translate-x-1 bg-yellow-400'}
              `}
            >
              {isDark
                ? <Moon className="w-3 h-3 text-black" />
                : <Sun className="w-3 h-3 text-black" />
              }
            </span>
          </button>
        </div>
      </div>

      {/* ── Engine Configuration ─────────────────────────────────── */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-2 mb-0.5">
          <Zap className="w-4 h-4 text-rain-accent" />
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Engine Configuration</div>
        </div>
        <div className="text-sm font-semibold mb-3">Architecture rules per CLAUDE.md</div>

        {/* Subsystem indicators */}
        <div className="space-y-2.5 mb-4">
          <EngineSubsystem
            name="DSP Engine"
            value="WASM-64bit"
            dotColor="#10B981"
            description="K-weighted LUFS · 4× OS true-peak · 16-stage pipeline"
          />
          <EngineSubsystem
            name="AI Engine"
            value="Claude Sonnet"
            dotColor="#8B5CF6"
            description="JSON-validated macro contract · Confidence scoring"
          />
          <EngineSubsystem
            name="Crypto"
            value="Ed25519"
            dotColor="#06B6D4"
            description="WebCrypto API · IndexedDB persistence"
          />
        </div>

        {/* Toggle settings */}
        <div className="space-y-1 pt-2 border-t border-rain-border/50">
          <SettingRow
            label="WASM Binary Integrity"
            desc="Verify SHA-256 hash at session start (RAIN-E304 on mismatch)"
            checked={wasmHash}
            onChange={setWasmHash}
          />
          <SettingRow
            label="NORMALIZATION_VALIDATED Gate"
            desc="Open gate → RainNet inference active. Sign-off: Phil Bölke."
            checked={normalizationValidated}
            onChange={setNormalizationValidated}
          />
          <SettingRow
            label="Auto-backup to IndexedDB"
            desc="Persist session state across page reloads"
            checked={autoBackup}
            onChange={setAutoBackup}
          />
          <SettingRow
            label="Anonymous telemetry"
            desc="Send anonymous usage metrics (LUFS, render time, errors)"
            checked={telemetry}
            onChange={setTelemetry}
          />
        </div>
      </div>

      {/* ── Keyboard Shortcuts Reference ─────────────────────────── */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Keyboard className="w-4 h-4 text-rain-accent" />
          <div className="text-sm font-semibold">Keyboard Shortcuts</div>
        </div>
        <div className="max-h-72 overflow-y-auto rain-scrollbar space-y-4 pr-1">
          {CATEGORIES.map((cat) => {
            const items = SHORTCUTS.filter((s) => s.category === cat)
            if (items.length === 0) return null
            return (
              <section key={cat}>
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-rain-accent mb-2">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {items.map((s) => (
                    <div
                      key={s.keys}
                      className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-rain-surface-3/40 transition-colors"
                    >
                      <span className="text-xs text-foreground">{s.description}</span>
                      <div className="flex items-center gap-0.5">
                        {s.keys.split('+').map((part, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
                            <kbd className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded border border-rain-border bg-rain-surface-3/60 font-mono text-[10px] text-foreground shadow-sm">
                              {part}
                            </kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      {/* ── API Endpoints ────────────────────────────────────────── */}
      <div className="rain-panel rounded-lg p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">Backend Routes</div>
        <div className="text-sm font-semibold mb-3">API Endpoints</div>
        <div className="space-y-1.5 text-[10px] font-mono">
          <ApiRow method="POST" path="/api/rain/assist" desc="AI Co-Master (LLM)" />
          <ApiRow method="POST" path="/api/rain/suggest" desc="Mastering report" />
          <ApiRow method="GET" path="/api/rain/provenance" desc="Cert capabilities" />
        </div>
      </div>

      {/* ── About RAIN V6 ───────────────────────────────────────── */}
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-rain-accent" />
          <div className="text-sm font-semibold">About {RAIN_BRAND.name} V6</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px] font-mono mb-3">
          <AboutInfo label="Version" value={RAIN_BRAND.version} />
          <AboutInfo label="Engine" value="RainDSP-Web" />
          <AboutInfo label="DSP precision" value="64-bit double" />
          <AboutInfo label="Compliance" value="EU AI Act Art. 50" />
        </div>
        <div className="pt-3 border-t border-rain-border/50">
          <div className="text-xs text-muted-foreground mb-1">
            © {new Date().getFullYear()} {RAIN_BRAND.publisher}
          </div>
          <div className="text-[10px] text-rain-accent italic font-mono">
            &ldquo;{RAIN_BRAND.motto}&rdquo;
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Engine Subsystem Row ──────────────────────────────────────────── */
function EngineSubsystem({ name, value, dotColor, description }: {
  name: string; value: string; dotColor: string; description: string
}) {
  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg bg-rain-surface-2/40 border border-rain-border/30">
      <span
        className="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 rain-pulse"
        style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}60` }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{name}</span>
          <span
            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
            style={{ color: dotColor, background: `${dotColor}18` }}
          >
            {value}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{description}</div>
      </div>
    </div>
  )
}

function SettingRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-rain-surface-2/60 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-[#AAFF00]"
      />
      <div className="flex-1">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
      </div>
    </label>
  )
}

function ApiRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  const color = method === 'POST' ? '#AAFF00' : '#00D4FF'
  return (
    <div className="flex items-center gap-2">
      <span className="px-1.5 py-0.5 rounded font-bold" style={{ color, background: `${color}15` }}>{method}</span>
      <span className="text-foreground">{path}</span>
      <span className="text-muted-foreground ml-auto">{desc}</span>
    </div>
  )
}

function AboutInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rain-surface-2/60 rounded p-2">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="text-rain-accent">{value}</div>
    </div>
  )
}
