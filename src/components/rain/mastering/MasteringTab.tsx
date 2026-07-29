'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeftRight, Download, Eye, FileAudio, FileText, Loader2, Play, Sparkles, Wand2, Zap } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { loadDemoTrack } from '@/lib/rain/demo-loader'
import { useSessionStore } from '@/lib/rain/store'
import { GENRES, PLATFORM_TARGETS } from '@/lib/rain/constants'
import { notifySuccess, notifyError } from '@/lib/rain/notifications'
import { applySimpleMode } from '@/lib/rain/simple-mode'
import { UploadZone } from './UploadZone'
import { CreativeMacros } from './CreativeMacros'
import { SimpleModePanel } from './SimpleModePanel'
import { MasteringReportDialog } from './MasteringReportDialog'
import { GenrePresets } from './GenrePresets'
import { SnapshotBar } from './SnapshotBar'
import { SignalChain } from './SignalChain'
import { MeteringPanel } from './MeteringPanel'
import { RainScoreGauge } from './RainScoreGauge'
import { ProcessingProgressPanel } from './ProcessingProgressPanel'
import { Waveform } from '@/components/rain/visualizers/Waveform'
import { Spectrum } from '@/components/rain/visualizers/Spectrum'
import { AssistantPanel } from '@/components/rain/assistant/AssistantPanel'
import { generateProvenance } from '@/lib/rain/provenance'
import { recordRenderTelemetry, recordExportDetails, recordQCResult } from '@/lib/rain/analytics'
import { computeQCResults, summarizeQCResults } from '@/lib/rain/qc'
import { BeforeAfterOverlay } from './BeforeAfterOverlay'
import { ABComparisonToggle } from './ABComparisonToggle'
import { BlindTestModal } from './BlindTestModal'
import { Switch } from '@/components/ui/switch'
import { StereoCorrelationMeter } from '@/components/rain/visualizers/StereoCorrelationMeter'
import { getAnonId } from '@/lib/rain/anon-id'

export function MasteringTab() {
  const fileName = useSessionStore((s) => s.fileName)
  const isProcessing = useSessionStore((s) => s.isProcessing)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const setIsProcessing = useSessionStore((s) => s.setIsProcessing)
  const setProgress = useSessionStore((s) => s.setProgress)
  const setResult = useSessionStore((s) => s.setResult)
  const setError = useSessionStore((s) => s.setError)
  const setCert = useSessionStore((s) => s.setCert)
  const rainCert = useSessionStore((s) => s.rainCert)
  const setInputAnalysis = useSessionStore((s) => s.setInputAnalysis)
  const addRenderLog = useSessionStore((s) => s.addRenderLog)
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const macros = useSessionStore((s) => s.macros)
  const genre = useSessionStore((s) => s.genre)
  const platform = useSessionStore((s) => s.platform)
  const setGenre = useSessionStore((s) => s.setGenre)
  const setPlatform = useSessionStore((s) => s.setPlatform)
  const rainScore = useSessionStore((s) => s.rainScore)
  const isDemo = useSessionStore((s) => s.isDemo)
  const setProcessingStageProgress = useSessionStore((s) => s.setProcessingStageProgress)
  const triggerCompletionCelebration = useSessionStore((s) => s.triggerCompletionCelebration)
  const setRenderAbortController = useSessionStore((s) => s.setRenderAbortController)
  // P3-BSROFORMER: clear stale stems at render start, populate fresh ones
  // from Stage 7 of the render pipeline via the onStemsReady callback.
  const setStemResults = useSessionStore((s) => s.setStemResults)
  // P2-4 Simple Mode state + setter wiring.
  const simpleMode = useSessionStore((s) => s.simpleMode)
  const setSimpleMode = useSessionStore((s) => s.setSimpleMode)
  const simpleIntensity = useSessionStore((s) => s.simpleIntensity)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setMacroSource = useSessionStore((s) => s.setMacroSource)
  const [showAssistant, setShowAssistant] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showBlindTest, setShowBlindTest] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const renderStartTime = useRef<number>(0)
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // BETA-ANALYTICS: server-persisted Session id for the currently loaded
  // file. Lazily created on first render so anonymous/logged-out demo use
  // never touches the DB — see ensureBackendSession() below.
  const backendSessionId = useRef<string | null>(null)
  const backendSessionFileName = useRef<string | null>(null)
  // AUDIT2: track the AI-suggest visual-feedback timeout so we can clean it up
  // on unmount (otherwise a leak if the user navigates away within 1.5s of click).
  const aiSuggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for 'rain:compare' custom event (keyboard shortcut 'C' integration)
  useEffect(() => {
    const handleCompare = () => setShowCompare((v) => !v)
    window.addEventListener('rain:compare', handleCompare)
    return () => window.removeEventListener('rain:compare', handleCompare)
  }, [])

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
      if (aiSuggestTimeoutRef.current) {
        clearTimeout(aiSuggestTimeoutRef.current)
      }
    }
  }, [])

  const handleLoadDemo = async () => {
    setDemoLoading(true)
    await loadDemoTrack()
    setDemoLoading(false)
  }

  // P2-4: when Simple Mode is toggled ON, immediately apply the deterministic
  // macro mapping so the render pipeline sees consistent state. Toggling OFF
  // preserves the existing macro values (the user can fine-tune via knobs).
  const handleSimpleModeToggle = useCallback(
    (next: boolean) => {
      setSimpleMode(next)
      if (next) {
        applySimpleMode(simpleIntensity, genre, setMacros, setMacroSource)
      }
    },
    [simpleIntensity, genre, setMacros, setMacroSource, setSimpleMode],
  )

  // BETA-ANALYTICS: creates (once per loaded file) a real Session row via
  // POST /api/rain/session, so activation/retention/funnel math has
  // something real to read. Silently no-ops if the caller isn't logged in
  // or the request fails — analytics must never block the mastering flow.
  const ensureBackendSession = useCallback(async () => {
    if (backendSessionId.current && backendSessionFileName.current === fileName) {
      return backendSessionId.current
    }
    try {
      const res = await fetch('/api/rain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, anonId: getAnonId() }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { sessionId: string | null }
      backendSessionId.current = data.sessionId
      backendSessionFileName.current = fileName
      return data.sessionId
    } catch (e) {
      console.warn('[analytics] ensureBackendSession failed:', e)
      return null
    }
  }, [fileName])

  // BETA-ANALYTICS: fires a render_completed or export_completed ping.
  // Best-effort — failures are logged, never surfaced to the user.
  const reportRenderEvent = useCallback(
    async (
      kind: 'render' | 'export',
      details?: {
        format?: string
        outputFileHash?: string
        loudnessLufs?: number
        truePeakDbfs?: number
        renderTimeMs?: number
      },
    ) => {
      try {
        await fetch('/api/rain/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, sessionId: backendSessionId.current, anonId: getAnonId(), ...details }),
        })
      } catch (e) {
        console.warn(`[analytics] reportRenderEvent(${kind}) failed:`, e)
      }
    },
    [],
  )

  const handleRender = async () => {
    if (!fileName || isProcessing) return
    setIsProcessing(true)
    renderStartTime.current = Date.now()
    // BETA-ANALYTICS: fire-and-forget — don't gate the render on this.
    void ensureBackendSession()

    // P3-BSROFORMER: clear any stale stem results from a previous render
    // or manual Stems-tab run. Fresh results are populated from Stage 7
    // of the render pipeline via the onStemsReady callback (below).
    setStemResults(null)

    // AUDIT-C5 FIX: create an AbortController for this render and store it so
    // the Cancel button (ProcessingProgressPanel → cancelProcessing) can abort
    // the in-flight render. Previously Cancel only flipped a flag the engine
    // never checked, so the render kept running while the UI returned to idle.
    const abortController = new AbortController()
    setRenderAbortController(abortController)

    // AUDIT-M9 FIX: previously used wall-clock time to fake a climbing progress
    // bar within each stage (`stageProgress = (elapsed / 300) * 100`). That was
    // fabricated — it filled the bar based on time, not actual DSP work.
    // Now the within-stage indicator climbs gently toward 90% and resets to 0
    // whenever the engine reports a real stage boundary (onProgress). The
    // overall progress bar reflects real stage completion (stage/16 * 100).
    const stageStartRef = { current: Date.now() }
    progressIntervalRef.current = setInterval(() => {
      const elapsedSinceStage = Date.now() - stageStartRef.current
      // Climb toward 90% over ~2 seconds, then hold. Never reaches 100%
      // until the engine confirms the next stage — honest "working" state.
      const stageProgress = Math.min(90, (elapsedSinceStage / 2000) * 90)
      setProcessingStageProgress(stageProgress)
    }, 100)

    try {
      const result = await audioEngine.render(macros, genre, platform, (stage, total, name) => {
        setProgress(stage, total, name)
        // Reset the within-stage indicator — real stage boundary reached.
        stageStartRef.current = Date.now()
        setProcessingStageProgress(0)
      }, abortController.signal, (stems) => {
        // P3-BSROFORMER: Stage 7 emitted BS-RoFormer 4-pass stem results.
        // Populate the session store so the Stems tab shows them immediately
        // (no separate "Run Separation" click required).
        setStemResults(stems)
      })

      // Clear the progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
      setProcessingStageProgress(100)

      // Generate provenance certificate
      const inputWavBlob = audioEngine.exportOriginalWav(24)
      const outputWavBlob = audioEngine.exportWav(24)
      const inputBuffer = await inputWavBlob.arrayBuffer()
      const outputBuffer = await outputWavBlob.arrayBuffer()
      const cert = await generateProvenance({
        inputBuffer,
        outputBuffer,
        params: result.params as unknown as Record<string, unknown>,
        analysis: {
          lufs: result.analysis.lufs,
          truePeak: result.analysis.truePeak,
          rms: result.analysis.rms,
          dynamicRange: result.analysis.dynamicRange,
          bpm: result.analysis.bpm,
          key: result.analysis.key,
        },
        // AUDIT-M8 FIX: pass the real output audio channels so a Chromaprint
        // fingerprint hash is computed and embedded in the manifest.
        outputChannels: audioEngine.getProcessedChannels() ?? undefined,
        // P3-TPDF-MP3: pass the FLOAT32 input/output channels so the RAIN-CERT
        // SHA-256 input/output hashes are computed over the deterministic DSP
        // float buffer — NOT over the integer WAV bytes (which now carry TPDF
        // dither noise at Stage 15 and would otherwise change every render).
        inputChannels: audioEngine.getInputChannels() ?? undefined,
        sampleRate: result.analysis.sampleRate,
      })
      setCert(cert)
      setResult(result.analysis, result.score, result.params)
      setInputAnalysis(audioEngine.currentAnalysis ?? useSessionStore.getState().inputAnalysis!)

      // Log this render to session history
      // P3-ANALYTICS: `duration` is the AUDIO file duration in SECONDS
      // (used by computeAnalytics for storage-size + minutes-processed math),
      // NOT the render wall-clock time. Render time is recorded separately
      // via recordRenderTelemetry → IndexedDB (both cumulative engineStats
      // counters AND a per-render telemetry row for the Analytics tab).
      const renderDuration = Date.now() - renderStartTime.current
      const audioDurationSec = useSessionStore.getState().fileDuration || 0
      const renderTimestamp = Date.now()
      addRenderLog({
        timestamp: renderTimestamp,
        fileName: fileName,
        genre,
        platform,
        macroValues: { ...macros },
        inputLufs: inputAnalysis?.lufs ?? 0,
        outputLufs: result.analysis.lufs,
        rainScore: result.score.overall,
        duration: audioDurationSec,
      })

      // P2-ANALYTICS: persist a full per-render telemetry record (real
      // per-stage DSP timings, format, bit depth, macro values, score, etc.)
      // to IndexedDB. recordRenderTelemetry internally bumps the cumulative
      // EngineStats counters (totalRenders, totalDspTimeMs, firstRenderAt,
      // lastRenderAt) — so we no longer call recordRenderStat separately.
      // The returned id links the QC snapshot below to this render.
      const fileState = useSessionStore.getState()
      const telemetryRecord = await recordRenderTelemetry({
        timestamp: renderTimestamp,
        renderDurationMs: renderDuration,
        audioDurationSec,
        genre,
        platform,
        format: 'WAV-24',
        bitDepth: fileState.fileBitDepth || 24,
        sampleRate: fileState.fileSampleRate || 48000,
        channels: fileState.fileChannels || 2,
        fileName: fileName ?? '(unknown)',
        rainScore: result.score.overall,
        inputLufs: inputAnalysis?.lufs ?? 0,
        outputLufs: result.analysis.lufs,
        outputTruePeak: result.analysis.truePeak,
        macroValues: { ...macros },
        stageTimings: { ...(result.stageTimings ?? {}) },
      }).catch((e) => {
        console.warn('[analytics] recordRenderTelemetry failed:', e)
        return null
      })

      // P2-ANALYTICS: persist a QC snapshot for this render. Same
      // computeQCResults() that QCTab uses for live display, summarized
      // into the persisted QCRecord shape (pass/warn/fail counts + per-
      // category tally + per-check status). The Analytics tab reads this
      // from IndexedDB to compute pass/fail rates and common failure
      // categories across the render history.
      try {
        const platformTarget = PLATFORM_TARGETS.find((p) => p.slug === platform) ?? PLATFORM_TARGETS[0]
        const qcChecks = computeQCResults(result.analysis, platformTarget, cert)
        const qcBody = summarizeQCResults(
          qcChecks,
          platform,
          telemetryRecord?.id ?? null,
          renderTimestamp,
        )
        void recordQCResult(qcBody).catch((e) =>
          console.warn('[analytics] recordQCResult failed:', e),
        )
      } catch (e) {
        console.warn('[analytics] QC snapshot computation failed:', e)
      }

      notifySuccess('Master complete', `RAIN Score: ${result.score.overall}`)

      // BETA-ANALYTICS: mark this master as produced. No format/hash yet —
      // those are attached per-export in handleExport below.
      void reportRenderEvent('render', {
        loudnessLufs: result.analysis.lufs,
        truePeakDbfs: result.analysis.truePeak,
        renderTimeMs: renderDuration,
      })

      // Trigger completion celebration
      triggerCompletionCelebration()
    } catch (e) {
      // Clear the progress interval on error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
      // AUDIT-C5 FIX: user-initiated cancel is not an error — exit silently.
      if (e instanceof Error && (e.name === 'CancelledError' || e.message === 'Render cancelled by user')) {
        notifyError('Render cancelled', 'Processing was stopped by the user')
        return
      }
      console.error('[RAIN render] error:', e)
      setError(e instanceof Error ? e.message : 'Render failed')
      notifyError('Render failed', e instanceof Error ? e.message : 'Unknown error during 16-stage processing')
    } finally {
      // Always clear the stored controller so a stale aborted signal can't
      // leak into the next render.
      setRenderAbortController(null)
    }
    // BUG FIX: removed `finally { setIsProcessing(false) }` — it was overwriting
    // the `status:'complete'` (set by setResult) and `status:'failed'` (set by
    // setError) back to `'idle'`, so the footer always showed "Ready" after
    // every render. setResult and setError both set isProcessing:false already.
  }

  const handleAiSuggest = async () => {
    setAiLoading(true)
    const trigger = (window as unknown as { __rainAiSuggest?: () => void }).__rainAiSuggest
    if (trigger) trigger()
    // visual feedback only; actual completion handled in panel
    aiSuggestTimeoutRef.current = setTimeout(() => setAiLoading(false), 1500)
  }

  const handleExport = async () => {
    // P3-ANALYTICS: measure real export wall-clock time + actual byte count
    // and persist them via recordExportDetails (which writes a row to the
    // `exports` IndexedDB store AND bumps the cumulative exportCount /
    // totalExportBytes / totalExportTimeMs counters in engineStats).
    const exportStart = Date.now()
    try {
      const blob = audioEngine.exportWav(24)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(fileName ?? 'rain-master').replace(/\.[^.]+$/, '')}_RAIN_mastered.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      const exportMs = Date.now() - exportStart
      const fileState = useSessionStore.getState()
      void recordExportDetails({
        timestamp: Date.now(),
        format: 'WAV-24',
        bytes: blob.size,
        durationMs: exportMs,
        sampleRate: fileState.fileSampleRate || 48000,
        bitDepth: 24,
        channels: fileState.fileChannels || 2,
        fileName: fileName ?? '(unknown)',
      }).catch((e) =>
        console.warn('[analytics] recordExportDetails failed:', e),
      )
      notifySuccess('WAV exported successfully', '24-bit PCM · RAIN mastered')

      // BETA-ANALYTICS: this is the event that counts as "activation" —
      // signup -> completed export. rainCert is set in the store by
      // handleRender above, so outputHash is the real RAIN-CERT hash.
      void reportRenderEvent('export', {
        format: 'wav24',
        outputFileHash: rainCert?.outputHash,
      })
    } catch (e) {
      console.error('[RAIN export] error:', e)
      notifyError('Export failed', e instanceof Error ? e.message : 'Could not export WAV file')
    }
  }

  return (
    <div className="grid lg:grid-cols-12 gap-4">
      {/* Left column — main workflow */}
      <div className="lg:col-span-8 space-y-4">
        <UploadZone />

        {fileName && (
          <>
            {/* Genre + Platform selectors */}
            <div className="rain-panel rounded-lg p-4 grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">
                  Genre
                </label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-rain-accent/50"
                >
                  {GENRES.map((g) => (
                    <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1">
                  Platform Target ({PLATFORM_TARGETS.length})
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-rain-accent/50"
                >
                  {PLATFORM_TARGETS.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.label} · {p.targetLufs} LUFS · {p.codec}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Genre Presets */}
            <GenrePresets />

            {/* P2-4: Simple / Pro mode toggle */}
            <div className="rain-panel rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={simpleMode}
                  onCheckedChange={handleSimpleModeToggle}
                  aria-label="Toggle Simple Mode"
                />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Mode
                  </div>
                  <div className="text-sm font-semibold">
                    {simpleMode ? 'Simple' : 'Pro'}
                    <span className="ml-2 text-[10px] font-mono text-muted-foreground/70">
                      {simpleMode
                        ? 'one-knob intensity + genre tilt'
                        : '7 macro knobs · full control'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground/70">
                Creator-tier feature
              </div>
            </div>

            {/* Creative macros (Pro) or Simple Mode panel (Simple) */}
            {simpleMode ? (
              <SimpleModePanel />
            ) : (
              <CreativeMacros onAiSuggest={handleAiSuggest} aiLoading={aiLoading} />
            )}

            {/* A/B Snapshots */}
            <SnapshotBar />

            {/* Visualizers */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rain-panel rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Waveform · Real-time
                  </div>
                  <div className="text-[9px] font-mono text-muted-foreground">Web Audio · 32-bit float</div>
                </div>
                <Waveform height={100} />
              </div>
              <div className="rain-panel rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Spectrum · FFT 2048
                  </div>
                  <div className="text-[9px] font-mono text-muted-foreground">20 Hz – 20 kHz · log</div>
                </div>
                <Spectrum height={100} showReadouts />
              </div>
            </div>

            {/* Stereo Correlation Meter — full-width professional phase meter */}
            <div className="rain-panel rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Stereo Correlation · Phase Coherence
                </div>
                <div className="text-[9px] font-mono text-muted-foreground">−1 out-of-phase · 0 uncorrelated · +1 mono</div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[9px] font-mono uppercase text-muted-foreground/70 mb-1">Input</div>
                  <StereoCorrelationMeter variant="input" />
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase text-muted-foreground/70 mb-1">Output</div>
                  <StereoCorrelationMeter variant="output" />
                </div>
              </div>
            </div>

            {/* A/B Comparison Toggle */}
            <ABComparisonToggle />

            {/* Processing Progress Panel - shows when processing */}
            <ProcessingProgressPanel />

            {/* Pipeline */}
            <SignalChain />

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleRender}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-rain-accent text-black font-semibold hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100 rain-glow-soft"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                {isProcessing ? 'Mastering...' : hasProcessed ? 'Re-render Master' : 'Run 16-Stage Master'}
              </button>
              <button
                onClick={() => {
                  void audioEngine.init()
                  audioEngine.togglePlay()
                }}
                disabled={!fileName}
                className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors text-sm disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                Preview
              </button>
              {hasProcessed && (
                <button
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-rain-accent/40 bg-rain-accent/10 hover:bg-rain-accent/20 transition-colors text-sm"
                >
                  <Download className="w-4 h-4 text-rain-accent" />
                  Export WAV 24-bit
                </button>
              )}
              {hasProcessed && (
                <button
                  onClick={() => setShowCompare(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-rain-accent/40 bg-rain-accent/10 hover:bg-rain-accent/20 transition-colors text-sm"
                >
                  <ArrowLeftRight className="w-4 h-4 text-rain-accent" />
                  Compare
                </button>
              )}
              {hasProcessed && (
                <button
                  onClick={() => setShowBlindTest(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 transition-colors text-sm"
                  title="Unbiased A/B comparison — eliminates confirmation bias"
                >
                  <Eye className="w-4 h-4 text-purple-400" />
                  Blind Test
                </button>
              )}
              {hasProcessed && (
                <button
                  onClick={() => setShowReport(true)}
                  disabled={!hasProcessed}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-sm disabled:opacity-50"
                  title="Generate an LLM mastering report from this render — Independent tier"
                >
                  <FileText className="w-4 h-4 text-cyan-400" />
                  Mastering Report
                </button>
              )}
              <button
                onClick={() => setShowAssistant((v) => !v)}
                className="ml-auto flex items-center gap-2 px-3 py-2.5 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors text-sm"
              >
                <Sparkles className="w-4 h-4 text-rain-accent" />
                {showAssistant ? 'Hide' : 'Show'} AI
              </button>
            </div>
          </>
        )}

        {!fileName && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rain-panel rounded-lg p-8 text-center"
          >
            <FileAudio className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <div className="text-sm text-muted-foreground mb-4">
              Load an audio file to begin the 16-stage mastering pipeline.
            </div>
            {/* Try Demo button with shimmer effect */}
            <button
              onClick={handleLoadDemo}
              disabled={demoLoading}
              className="relative inline-flex items-center gap-2 px-5 py-3 rounded-md border-2 border-rain-accent/60 bg-transparent hover:bg-rain-accent/10 hover:border-rain-accent transition-all text-sm font-medium group disabled:opacity-50"
            >
              {/* Shimmer effect */}
              <span className="absolute inset-0 overflow-hidden rounded-md">
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-rain-accent/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
              </span>
              {demoLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-rain-accent" />
              ) : (
                <Zap className="w-4 h-4 text-rain-accent" />
              )}
              <span className="text-rain-accent">{demoLoading ? 'Loading demo...' : 'Try Demo Track'}</span>
            </button>
            <div className="text-[10px] font-mono text-muted-foreground/70 mt-4">
              All processing runs locally in your browser via Web Audio API + WASM.
            </div>
          </motion.div>
        )}
      </div>

      {/* Right column — metering + score + AI */}
      <div className="lg:col-span-4 space-y-4">
        <MeteringPanel variant="input" />
        {hasProcessed && <MeteringPanel variant="output" />}
        <RainScoreGauge score={rainScore} size={160} />
        {showAssistant && fileName && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-h-[400px]"
          >
            <AssistantPanel />
          </motion.div>
        )}
        {!fileName && (
          <div className="rain-panel rounded-lg p-4 border-l-2 border-l-orange-500/50">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <div className="font-semibold text-foreground mb-1">AI Co-Master Engineer</div>
                Load an audio file to enable natural-language macro suggestions with confidence scoring.
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Before/After Comparison Overlay */}
      <BeforeAfterOverlay open={showCompare} onClose={() => setShowCompare(false)} />
      {/* Blind Test Modal */}
      <BlindTestModal open={showBlindTest} onClose={() => setShowBlindTest(false)} />
      {/* P2-3: Mastering Report Dialog (calls /api/rain/suggest) */}
      <MasteringReportDialog open={showReport} onOpenChange={setShowReport} />
    </div>
  )
}

