'use client'

/**
 * RAIN V6 — Session Store (Zustand)
 *
 * Single source of truth for the active mastering session. Persists file
 * metadata, macros, analysis, score, and provenance across tab switches.
 */

import { create } from 'zustand'
import type {
  AudioAnalysis,
  MacroSource,
  MacroValues,
  PipelineStage,
  ProcessingParams,
  ProvenanceCertificate,
  QCCheck,
  RainScore,
  SessionStatus,
  StemState,
  TrackMetadata,
} from './types'
import { DEFAULT_MACROS, PIPELINE_STAGES, SNAPSHOT_SLOT_COUNT, defaultStems, QC_CHECK_NAMES } from './constants'
import type { StemResult } from './stems'

// ---------------------------------------------------------------------------
// Render log entry — tracks each render operation for session history
// ---------------------------------------------------------------------------

export interface RenderLogEntry {
  id: string
  timestamp: number
  fileName: string
  genre: string
  platform: string
  macroValues: MacroValues
  inputLufs: number
  outputLufs: number
  rainScore: number
  duration: number
}

const MAX_RENDER_HISTORY = 20

// ---------------------------------------------------------------------------
// A/B Snapshot — session-only scratchpad slot for fast macro comparison.
// Distinct from macroHistory (linear undo/redo) and from CustomPreset
// (which persists across sessions via localStorage). Snapshots live in the
// Zustand store only and are wiped on `reset()`.
// ---------------------------------------------------------------------------

export interface MacroSnapshot {
  /** Slot label — 'A' | 'B' | 'C' | 'D'. */
  label: string
  /** Captured 7-macro state. */
  macros: MacroValues
  /** Genre slug active when captured. */
  genre: string
  /** Platform slug active when captured. */
  platform: string
  /** Unix timestamp (ms) when the snapshot was taken. */
  capturedAt: number
}

interface SessionState {
  // Session identity
  sessionId: string | null
  status: SessionStatus
  progress: number
  progressLabel: string
  activeStage: number
  pipeline: PipelineStage[]
  errorCode: string | null

  // File info
  fileName: string | null
  fileDuration: number
  fileSampleRate: number
  fileBitDepth: number
  fileChannels: number

  // Analysis
  inputAnalysis: AudioAnalysis | null
  outputAnalysis: AudioAnalysis | null
  rainScore: RainScore | null
  rainCert: ProvenanceCertificate | null
  params: ProcessingParams | null

  // Macros
  macros: MacroValues
  macroSource: MacroSource
  macroConfidence: number

  // Macro undo/redo
  macroHistory: MacroValues[]
  macroHistoryIndex: number
  canUndo: boolean
  canRedo: boolean

  // Metadata
  metadata: TrackMetadata

  // Genre & platform
  genre: string
  platform: string

  // Stems
  stems: StemState[]
  // Real stem separation results (audio data + measured RMS/peak per stem).
  // Populated by StemsTab after audioEngine.separateStems() completes; null
  // before the first separation or after reset().
  stemResults: StemResult[] | null
  // Where the current stemResults came from — 'ai' (runStemSeparation),
  // 'zip' (user uploaded a .zip of pre-separated stems), or null (no stems
  // loaded yet). Set together with stemResults so the UI can badge the
  // source correctly.
  stemsSource: 'ai' | 'zip' | null

  // QC
  qcChecks: QCCheck[]

  // Render history
  renderHistory: RenderLogEntry[]

  // A/B Snapshots — 4 session-only slots (A/B/C/D)
  snapshots: (MacroSnapshot | null)[]

  // Processing
  isProcessing: boolean
  hasProcessed: boolean
  isPlaying: boolean
  processingStageProgress: number // Progress within current stage (0-100 estimated)
  processingStartTime: number | null // Unix timestamp when processing started
  processingCancelled: boolean // Flag for cancelled processing
  // AUDIT-C5 FIX: live AbortController for the in-flight render. The Cancel
  // button aborts this controller; render() checks signal.aborted between
  // stages and throws a CancelledError. Held outside React state because
  // AbortController is a mutable handle, not serializable state.
  renderAbortController: AbortController | null

  // Completion celebration
  showCompletionCelebration: boolean // Trigger confetti/success animation

  // A/B Comparison mode
  abMode: 'original' | 'mastered'

  // Demo mode flag — tracks if user is using a pre-loaded demo track
  isDemo: boolean

  // P1-2 Reference Match: per-band dB gain curve (31-band 1/3-octave) computed
  // by the Reference tab. When non-null, Stage 5 of the render pipeline
  // applies it as a biquad peak chain BEFORE the genre tilt. The bands are
  // the ISO 1/3-octave centers exported from reference-match.ts.
  referenceCurve: Float32Array | null

  // P2-4 Simple Mode: when true, MasteringTab hides the 7 macro knobs and
  // shows a single 0–100 Intensity slider + genre-driven tilt instead. The
  // macro state is derived deterministically from (simpleIntensity, genre)
  // via simple-mode.ts::mapSimpleModeToMacros. The Pro-mode macros are
  // preserved in `macros` so toggling Simple Mode off restores the prior
  // 7-knob state — Simple Mode writes through `setMacros`, which records
  // the change in macroHistory for undo.
  simpleMode: boolean
  simpleIntensity: number // 0..100

  // Actions
  setSession: (id: string) => void
  setStatus: (status: SessionStatus, progress?: number, label?: string) => void
  setFileInfo: (name: string, duration: number, sampleRate: number, bitDepth: number, channels: number) => void
  setInputAnalysis: (a: AudioAnalysis) => void
  setOutputAnalysis: (a: AudioAnalysis) => void
  setResult: (outputAnalysis: AudioAnalysis, score: RainScore, params: ProcessingParams) => void
  setCert: (cert: ProvenanceCertificate) => void
  setError: (code: string) => void
  setMacros: (partial: Partial<MacroValues>) => void
  setMacroSource: (src: MacroSource, confidence?: number) => void
  undoMacros: () => void
  redoMacros: () => void
  resetMacros: () => void
  setMetadata: (meta: Partial<TrackMetadata>) => void
  setGenre: (genre: string) => void
  setPlatform: (platform: string) => void
  setStems: (stems: StemState[]) => void
  updateStem: (key: string, patch: Partial<StemState>) => void
  setStemResults: (results: StemResult[] | null, source?: 'ai' | 'zip' | null) => void
  setQcChecks: (checks: QCCheck[]) => void
  addRenderLog: (entry: Omit<RenderLogEntry, 'id'>) => void
  clearRenderHistory: () => void
  captureSnapshot: (slotIndex: number) => void
  loadSnapshot: (slotIndex: number) => boolean
  clearSnapshot: (slotIndex: number) => void
  clearAllSnapshots: () => void
  setProgress: (stage: number, total: number, label: string) => void
  setIsProcessing: (v: boolean) => void
  setIsPlaying: (v: boolean) => void
  setAbMode: (mode: 'original' | 'mastered') => void
  toggleAB: () => void
  setIsDemo: (v: boolean) => void
  setProcessingStageProgress: (progress: number) => void
  cancelProcessing: () => void
  setRenderAbortController: (c: AbortController | null) => void
  triggerCompletionCelebration: () => void
  clearCompletionCelebration: () => void
  setReferenceCurve: (curve: Float32Array | null) => void
  setSimpleMode: (v: boolean) => void
  setSimpleIntensity: (v: number) => void
  resetProcessing: () => void
  reset: () => void
}

const DEFAULT_METADATA: TrackMetadata = {
  title: '',
  artist: '',
  album: '',
  genre: 'pop',
  trackNumber: '1',
  year: String(new Date().getFullYear()),
  isrc: '',
  upc: '',
  comment: '',

  // Release-level (Ditto standard) — sensible defaults so the form starts
  // in a "ready to ship worldwide, no AI disclosure, no parental advisory"
  // state. The user just needs to fill in title + artist.
  releaseDate: '',
  originalReleaseDate: '',
  releaseType: 'single',
  label: '',
  distributor: 'RAIN V6',
  copyrightHolder: '',
  copyrightYear: String(new Date().getFullYear()),
  publisher: '',
  publisherIpi: '',
  pro: '',
  territories: ['WORLDWIDE'],
  masterOwner: '',
  contractReference: '',

  // Track-level
  iswc: '',
  recordingYear: String(new Date().getFullYear()),
  explicitLyrics: 'none',
  parentalAdvisory: false,
  language: 'eng',
  genreSubgenre: '',
  trackVolume: '1',
  trackTotal: '1',

  // Contributors / Credits
  contributors: [],

  // AI Disclosure — default to "none" across all five stages. This is the
  // honest default: until the user actively flags a stage as assisted or
  // generated, the DDEX <AIInvolvement> block reports no AI involvement.
  aiDisclosure: {
    vocals: 'none',
    instrumentation: 'none',
    composition: 'none',
    mixing: 'none',
    mastering: 'none',
  },
}

function buildQcChecks(): QCCheck[] {
  return QC_CHECK_NAMES.map((q) => ({
    id: q.id,
    name: q.name,
    category: q.category,
    status: 'pass' as const,
    measured: '—',
    target: q.target,
    message: 'Awaiting render',
  }))
}

const MAX_MACRO_HISTORY = 50

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionId: null,
  status: 'idle',
  progress: 0,
  progressLabel: '',
  activeStage: 0,
  pipeline: PIPELINE_STAGES.map((s) => ({ ...s })),
  errorCode: null,

  fileName: null,
  fileDuration: 0,
  fileSampleRate: 48000,
  fileBitDepth: 24,
  fileChannels: 2,

  inputAnalysis: null,
  outputAnalysis: null,
  rainScore: null,
  rainCert: null,
  params: null,

  macros: { ...DEFAULT_MACROS },
  macroSource: 'MANUAL',
  macroConfidence: 0,
  macroHistory: [{ ...DEFAULT_MACROS }],
  macroHistoryIndex: 0,
  canUndo: false,
  canRedo: false,

  metadata: {
    ...DEFAULT_METADATA,
    territories: [...(DEFAULT_METADATA.territories ?? ['WORLDWIDE'])],
    contributors: [],
    aiDisclosure: { ...(DEFAULT_METADATA.aiDisclosure as Record<string, string>) } as TrackMetadata['aiDisclosure'],
  },
  genre: 'pop',
  platform: 'spotify',

  stems: defaultStems(),
  stemResults: null,
  stemsSource: null,
  qcChecks: buildQcChecks(),

  renderHistory: [],

  snapshots: Array.from({ length: SNAPSHOT_SLOT_COUNT }, () => null),

  isProcessing: false,
  hasProcessed: false,
  isPlaying: false,
  processingStageProgress: 0,
  processingStartTime: null,
  processingCancelled: false,
  renderAbortController: null,
  showCompletionCelebration: false,
  abMode: 'mastered',
  isDemo: false,
  referenceCurve: null,
  simpleMode: false,
  simpleIntensity: 50,

  setSession: (id) => set({ sessionId: id, status: 'uploading' }),
  setStatus: (status, progress = 0, label = '') => set({ status, progress, progressLabel: label }),
  setFileInfo: (name, duration, sampleRate, bitDepth, channels) =>
    set({ fileName: name, fileDuration: duration, fileSampleRate: sampleRate, fileBitDepth: bitDepth, fileChannels: channels }),
  setInputAnalysis: (a) => set({ inputAnalysis: a }),
  setOutputAnalysis: (a) => set({ outputAnalysis: a }),
  setResult: (outputAnalysis, score, params) =>
    set({
      outputAnalysis,
      rainScore: score,
      params,
      status: 'complete',
      isProcessing: false,
      hasProcessed: true,
      progress: 100,
      progressLabel: 'Complete',
      activeStage: 16,
      pipeline: PIPELINE_STAGES.map((s) => ({ ...s, status: 'complete' as const })),
    }),
  setCert: (cert) => set({ rainCert: cert }),
  setError: (code) => set({ errorCode: code, status: 'failed', isProcessing: false, progress: 0 }),
  setMacros: (partial) => {
    const { macros, macroHistory, macroHistoryIndex } = get()
    // AUDIT-C1 FIX: previously pushed the OLD (pre-change) macros, which made
    // multi-step undo skip states and redo restore the wrong state. The history
    // must store every distinct state the UI actually displayed, so we push the
    // NEW state. Undo then walks back to the previous entry (the prior state).
    const newMacros = { ...macros, ...partial } as MacroValues
    const truncated = macroHistory.slice(0, macroHistoryIndex + 1)
    truncated.push({ ...newMacros })
    // Cap at MAX_MACRO_HISTORY (drop oldest, keep index aligned)
    if (truncated.length > MAX_MACRO_HISTORY) truncated.shift()
    const newIndex = truncated.length - 1
    set({
      macros: newMacros,
      macroHistory: truncated,
      macroHistoryIndex: newIndex,
      canUndo: newIndex > 0,
      canRedo: false,
      macroSource: 'MANUAL',
    })
  },
  setMacroSource: (src, confidence = 0) => set({ macroSource: src, macroConfidence: confidence }),
  undoMacros: () => {
    const { macroHistory, macroHistoryIndex } = get()
    if (macroHistoryIndex <= 0) return
    const newIndex = macroHistoryIndex - 1
    set({
      macros: { ...macroHistory[newIndex] },
      macroHistoryIndex: newIndex,
      canUndo: newIndex > 0,
      canRedo: newIndex < macroHistory.length - 1,
    })
  },
  redoMacros: () => {
    const { macroHistory, macroHistoryIndex } = get()
    if (macroHistoryIndex >= macroHistory.length - 1) return
    const newIndex = macroHistoryIndex + 1
    set({
      macros: { ...macroHistory[newIndex] },
      macroHistoryIndex: newIndex,
      canUndo: newIndex > 0,
      canRedo: newIndex < macroHistory.length - 1,
    })
  },
  resetMacros: () => {
    // P1 FIX: previously this action wiped macroHistory directly (resetting
    // to `[DEFAULT_MACROS]` with `canUndo: false`), which meant the reset
    // itself was NOT undoable — a user who hit "Reset Defaults" (the AUTO
    // pill in GenrePresets) couldn't undo back to their hand-tuned macros.
    // Per the Phase-1 directive ("Reset is undo-able — goes through setMacros
    // so macroHistory captures it"), we now route through setMacros, which
    // pushes the DEFAULT_MACROS state onto the existing history. The user
    // can then Cmd/Ctrl+Z to restore their prior macros.
    // setMacros also flips macroSource to 'MANUAL', matching the original
    // behavior. macroConfidence is reset to 0 here for parity with the
    // previous implementation.
    const { setMacros, setMacroSource } = get()
    setMacros({ ...DEFAULT_MACROS })
    setMacroSource('MANUAL', 0)
  },
  setMetadata: (meta) => set((s) => ({ metadata: { ...s.metadata, ...meta } })),
  setGenre: (genre) => set({ genre }),
  setPlatform: (platform) => set({ platform }),
  setStems: (stems) => set({ stems }),
  updateStem: (key, patch) =>
    set((s) => ({ stems: s.stems.map((st) => (st.key === key ? { ...st, ...patch } : st)) })),
  setStemResults: (results, source) => set({ stemResults: results, stemsSource: source ?? (results ? 'ai' : null) }),
  setQcChecks: (checks) => set({ qcChecks: checks }),
  addRenderLog: (entry) =>
    set((s) => {
      const newEntry: RenderLogEntry = {
        ...entry,
        // BUG FIX: `render-${timestamp}` collided when two renders shared a
        // millisecond (rapid re-renders). Use crypto.randomUUID when available
        // with a Math.random fallback for older browsers.
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `render-${entry.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      }
      const history = [newEntry, ...s.renderHistory].slice(0, MAX_RENDER_HISTORY)
      return { renderHistory: history }
    }),
  clearRenderHistory: () => set({ renderHistory: [] }),
  captureSnapshot: (slotIndex) =>
    set((s) => {
      if (slotIndex < 0 || slotIndex >= SNAPSHOT_SLOT_COUNT) return s
      const label = String.fromCharCode('A'.charCodeAt(0) + slotIndex)
      const snapshot: MacroSnapshot = {
        label,
        macros: { ...s.macros },
        genre: s.genre,
        platform: s.platform,
        capturedAt: Date.now(),
      }
      const next = [...s.snapshots]
      next[slotIndex] = snapshot
      return { snapshots: next }
    }),
  loadSnapshot: (slotIndex) => {
    const { snapshots, setMacros, setGenre, setPlatform, setMacroSource } = get()
    if (slotIndex < 0 || slotIndex >= SNAPSHOT_SLOT_COUNT) return false
    const snapshot = snapshots[slotIndex]
    if (!snapshot) return false
    // Route through setMacros so the load is undo-able (consistent with
    // GenrePresets / CustomPresets apply flow). setMacros flips macroSource
    // to MANUAL, so we re-stamp it as HEURISTIC below.
    setMacros({ ...snapshot.macros })
    setGenre(snapshot.genre)
    setPlatform(snapshot.platform)
    setMacroSource('HEURISTIC', 100)
    return true
  },
  clearSnapshot: (slotIndex) =>
    set((s) => {
      if (slotIndex < 0 || slotIndex >= SNAPSHOT_SLOT_COUNT) return s
      if (!s.snapshots[slotIndex]) return s
      const next = [...s.snapshots]
      next[slotIndex] = null
      return { snapshots: next }
    }),
  clearAllSnapshots: () =>
    set((s) => {
      if (s.snapshots.every((snap) => snap === null)) return s
      return { snapshots: Array.from({ length: SNAPSHOT_SLOT_COUNT }, () => null) }
    }),
  setProgress: (stage, _total, label) =>
    set((s) => ({
      activeStage: stage,
      progress: (stage / 16) * 100,
      progressLabel: label,
      pipeline: s.pipeline.map((p) => ({
        ...p,
        status: p.id < stage ? 'complete' : p.id === stage ? 'active' : 'pending',
      })),
    })),
  setIsProcessing: (v) => set({ 
    isProcessing: v, 
    status: v ? 'processing' : 'idle',
    processingStartTime: v ? Date.now() : null,
    processingCancelled: false,
  processingStageProgress: 0,
  }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setAbMode: (mode) => set({ abMode: mode }),
  toggleAB: () => set((s) => ({ abMode: s.abMode === 'original' ? 'mastered' : 'original' })),
  setIsDemo: (v) => set({ isDemo: v }),
  setProcessingStageProgress: (progress) => set({ processingStageProgress: Math.max(0, Math.min(100, progress)) }),
  cancelProcessing: () => {
    // AUDIT-C5 FIX: abort the in-flight render via the stored controller.
    // Previously this only flipped a flag that render() never checked, so the
    // render continued in the background while the UI returned to idle.
    const { renderAbortController } = get()
    renderAbortController?.abort()
    set({ processingCancelled: true, isProcessing: false, status: 'idle', renderAbortController: null })
  },
  setRenderAbortController: (c) => set({ renderAbortController: c }),
  triggerCompletionCelebration: () => set({ showCompletionCelebration: true }),
  clearCompletionCelebration: () => set({ showCompletionCelebration: false }),
  setReferenceCurve: (curve) => set({ referenceCurve: curve }),
  setSimpleMode: (v) => set({ simpleMode: v }),
  setSimpleIntensity: (v) => set({ simpleIntensity: Math.max(0, Math.min(100, Math.round(v))) }),
  resetProcessing: () =>
    set({
      sessionId: null,
      status: 'idle',
      progress: 0,
      progressLabel: '',
      activeStage: 0,
      pipeline: PIPELINE_STAGES.map((s) => ({ ...s, status: 'pending' as const })),
      outputAnalysis: null,
      rainScore: null,
      rainCert: null,
      params: null,
      isProcessing: false,
      hasProcessed: false,
      processingStageProgress: 0,
      processingStartTime: null,
      processingCancelled: false,
      showCompletionCelebration: false,
      errorCode: null,
      abMode: 'mastered',
      isDemo: false,
      referenceCurve: null,
      // P2-4: preserve simpleMode toggle on resetProcessing so the user
      // doesn't have to re-enable Simple Mode after each render. The
      // intensity value is also preserved — only `reset()` (full session
      // wipe) clears them.
    }),
  reset: () =>
    set({
      sessionId: null,
      status: 'idle',
      progress: 0,
      progressLabel: '',
      activeStage: 0,
      pipeline: PIPELINE_STAGES.map((s) => ({ ...s, status: 'pending' as const })),
      fileName: null,
      fileDuration: 0,
      fileSampleRate: 48000,
      fileBitDepth: 24,
      fileChannels: 2,
      inputAnalysis: null,
      outputAnalysis: null,
      rainScore: null,
      rainCert: null,
      params: null,
      macros: { ...DEFAULT_MACROS },
      macroSource: 'MANUAL',
      macroConfidence: 0,
      macroHistory: [{ ...DEFAULT_MACROS }],
      macroHistoryIndex: 0,
      canUndo: false,
      canRedo: false,
      metadata: {
        ...DEFAULT_METADATA,
        territories: [...(DEFAULT_METADATA.territories ?? ['WORLDWIDE'])],
        contributors: [],
        aiDisclosure: { ...(DEFAULT_METADATA.aiDisclosure as Record<string, string>) } as TrackMetadata['aiDisclosure'],
      },
      isProcessing: false,
      hasProcessed: false,
      processingStageProgress: 0,
      processingStartTime: null,
      processingCancelled: false,
      showCompletionCelebration: false,
      errorCode: null,
      abMode: 'mastered',
      isDemo: false,
      referenceCurve: null,
      simpleMode: false,
      simpleIntensity: 50,
      stems: defaultStems(),
      stemResults: null,
      stemsSource: null,
      qcChecks: buildQcChecks(),
      renderHistory: [],
      snapshots: Array.from({ length: SNAPSHOT_SLOT_COUNT }, () => null),
    }),
}))
