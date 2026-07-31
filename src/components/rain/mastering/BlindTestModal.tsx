'use client'

/**
 * RAIN V6 — Blind Test Mode
 *
 * A professional A/B blind comparison tool for unbiased mastering evaluation.
 * The user listens to X and Y (randomized original vs. mastered), votes on
 * which sounds better, then learns the truth. Eliminates confirmation bias.
 *
 * Features:
 *  - Randomized X/Y assignment (50/50, re-randomized each round)
 *  - Auto-switch interval (2s / 5s / 10s / manual)
 *  - Vote: X better / Y better / Tie / Can't tell
 *  - Reveal + score tracking across rounds
 *  - Keyboard shortcuts: X/Y to switch, 1-4 to vote, R to reveal
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, Shuffle, Trophy, X, Check, Equal, HelpCircle, RotateCcw, Play, Pause } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'

type Vote = 'X' | 'Y' | 'TIE' | 'CANT_TELL' | null
type Phase = 'listening' | 'voted' | 'reveal'

interface RoundResult {
  round: number
  /** true = X was mastered, false = X was original */
  xIsMastered: boolean
  vote: Vote
  /** Did the user prefer the mastered version? */
  preferredMastered: boolean | null
}

interface BlindTestModalProps {
  open: boolean
  onClose: () => void
}

const AUTO_INTERVALS = [
  { label: 'Manual', ms: 0 },
  { label: '2s', ms: 2000 },
  { label: '5s', ms: 5000 },
  { label: '10s', ms: 10000 },
] as const

export function BlindTestModal({ open, onClose }: BlindTestModalProps) {
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const fileName = useSessionStore((s) => s.fileName)

  // Round state
  const [round, setRound] = useState(1)
  const [xIsMastered, setXIsMastered] = useState(true)
  const [activeLabel, setActiveLabel] = useState<'X' | 'Y'>('X')
  const [phase, setPhase] = useState<Phase>('listening')
  const [vote, setVote] = useState<Vote>(null)
  const [results, setResults] = useState<RoundResult[]>([])
  const [autoMs, setAutoMs] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const switchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startingPositionRef = useRef<number>(0)

  // --- Randomize X/Y assignment on each new round ---
  const newRound = useCallback((roundNum: number) => {
    const assignment = Math.random() < 0.5
    setXIsMastered(assignment)
    setActiveLabel('X')
    setPhase('listening')
    setVote(null)
    setRound(roundNum)
    // AUDIT-M1 FIX: previously the engine's preview mode was NOT synced to the
    // new X assignment, so after "Next Round" the user heard the previous
    // round's mode when clicking X — the test was no longer blind. X is active
    // by default, so if X is now mastered we switch the engine to B (mastered),
    // otherwise to A (original).
    audioEngine.setPreviewMode(assignment ? 'B' : 'A')
  }, [])

  // Initialize first round when modal opens
  useEffect(() => {
    if (!open || !hasProcessed) return
    // Use a microtask deferral so setState calls don't run synchronously
    // in the effect body (React warns about cascading renders).
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      newRound(1)
      setResults([])
      // Start playback from current position
      startingPositionRef.current = audioEngine.position
      void audioEngine.init().then(() => {
        if (cancelled) return
        audioEngine.togglePlay()
        setIsPlaying(true)
      })
    })
    return () => {
      cancelled = true
      // Stop playback + auto-switch on close
      if (switchTimerRef.current) {
        clearInterval(switchTimerRef.current)
        switchTimerRef.current = null
      }
      audioEngine.stop()
    }
  }, [open, hasProcessed, newRound])

  // --- Switch active label (X <-> Y) ---
  const switchTo = useCallback((label: 'X' | 'Y') => {
    setActiveLabel(label)
    // Map label to preview mode: if X is mastered, X→B, Y→A; else X→A, Y→B
    const wantMastered = label === 'X' ? xIsMastered : !xIsMastered
    audioEngine.setPreviewMode(wantMastered ? 'B' : 'A')
  }, [xIsMastered])

  // --- Auto-switch timer ---
  useEffect(() => {
    if (!open || autoMs === 0 || phase !== 'listening') return
    if (switchTimerRef.current) clearInterval(switchTimerRef.current)
    switchTimerRef.current = setInterval(() => {
      setActiveLabel((prev) => {
        const next = prev === 'X' ? 'Y' : 'X'
        const wantMastered = next === 'X' ? xIsMastered : !xIsMastered
        audioEngine.setPreviewMode(wantMastered ? 'B' : 'A')
        return next
      })
    }, autoMs)
    return () => {
      if (switchTimerRef.current) {
        clearInterval(switchTimerRef.current)
        switchTimerRef.current = null
      }
    }
  }, [open, autoMs, phase, xIsMastered])

  // --- Cast vote ---
  const castVote = useCallback((v: Vote) => {
    if (phase !== 'listening') return
    setVote(v)
    setPhase('voted')
  }, [phase])

  // --- Reveal the truth ---
  const reveal = useCallback(() => {
    if (phase !== 'voted' || !vote) return
    // Determine if user preferred the mastered version
    let preferredMastered: boolean | null = null
    if (vote === 'X') preferredMastered = xIsMastered
    else if (vote === 'Y') preferredMastered = !xIsMastered
    else preferredMastered = null // TIE or CANT_TELL

    setResults((prev) => [
      ...prev,
      { round, xIsMastered, vote, preferredMastered },
    ])
    setPhase('reveal')
  }, [phase, vote, xIsMastered, round])

  // --- Next round ---
  const nextRound = useCallback(() => {
    newRound(round + 1)
  }, [newRound, round])

  // --- Play/pause toggle ---
  const togglePlay = useCallback(() => {
    void audioEngine.init().then(() => {
      audioEngine.togglePlay()
      setIsPlaying((p) => !p)
    })
  }, [])

  // AUDIT-M2 FIX: subscribe to engine state so isPlaying stays in sync when
  // playback ends naturally (the engine's onended callback sets _isPlaying=false
  // but the modal's local state never heard about it). Without this the
  // Play/Pause button showed "Pause" after the track finished, and the
  // auto-switch timer kept firing against silence.
  useEffect(() => {
    if (!open) return
    const unsub = audioEngine.subscribe((s) => {
      setIsPlaying(s.isPlaying)
    })
    return unsub
  }, [open])

  // --- Keyboard shortcuts (X/Y switch, 1-4 vote, R reveal, N next) ---
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      // Don't interfere with modifier keys
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'x') { e.preventDefault(); switchTo('X') }
      else if (key === 'y') { e.preventDefault(); switchTo('Y') }
      else if (key === '1' && phase === 'listening') { e.preventDefault(); castVote('X') }
      else if (key === '2' && phase === 'listening') { e.preventDefault(); castVote('Y') }
      else if (key === '3' && phase === 'listening') { e.preventDefault(); castVote('TIE') }
      else if (key === '4' && phase === 'listening') { e.preventDefault(); castVote('CANT_TELL') }
      else if (key === 'r' && phase === 'voted') { e.preventDefault(); reveal() }
      else if (key === 'n' && phase === 'reveal') { e.preventDefault(); nextRound() }
      else if (key === 'escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, true) // capture to beat global shortcuts
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, phase, switchTo, castVote, reveal, nextRound, onClose])

  // --- Stats ---
  const stats = useMemo(() => {
    const completed = results.filter((r) => r.preferredMastered !== null)
    const masteredPref = completed.filter((r) => r.preferredMastered === true).length
    const originalPref = completed.filter((r) => r.preferredMastered === false).length
    const ties = results.length - completed.length
    return { total: results.length, masteredPref, originalPref, ties }
  }, [results])

  if (!hasProcessed) return null

  // Determine reveal content
  const xLabel = xIsMastered ? 'MASTERED' : 'ORIGINAL'
  const yLabel = xIsMastered ? 'ORIGINAL' : 'MASTERED'
  const userPreferredMastered = vote === 'X' ? xIsMastered : vote === 'Y' ? !xIsMastered : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="relative z-10 w-full max-w-3xl"
          >
            <div
              className="rounded-2xl border border-rain-border overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(18,20,26,0.97) 0%, rgba(25,28,38,0.97) 100%)',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(170,255,0,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
              role="dialog"
              aria-labelledby="blind-test-title"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-rain-border bg-rain-surface/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center">
                    <Shuffle className="w-5 h-5 text-rain-accent" />
                  </div>
                  <div>
                    <h2 id="blind-test-title" className="text-base font-semibold text-foreground flex items-center gap-2">
                      Blind Test Mode
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rain-accent/15 text-rain-accent border border-rain-accent/30">
                        ROUND {round}
                      </span>
                    </h2>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {fileName ? fileName.slice(0, 40) : 'No file'} · unbiased A/B comparison
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close blind test"
                  className="p-2 rounded-lg hover:bg-rain-surface-3 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5">
                {/* Phase indicator */}
                <div className="flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                  <span className={`px-2 py-1 rounded ${phase === 'listening' ? 'bg-rain-accent/20 text-rain-accent' : 'text-muted-foreground/50'}`}>
                    1. Listen
                  </span>
                  <span className="text-muted-foreground/30">→</span>
                  <span className={`px-2 py-1 rounded ${phase === 'voted' ? 'bg-rain-accent/20 text-rain-accent' : phase === 'reveal' ? 'bg-rain-accent/10 text-rain-accent/70' : 'text-muted-foreground/50'}`}>
                    2. Vote
                  </span>
                  <span className="text-muted-foreground/30">→</span>
                  <span className={`px-2 py-1 rounded ${phase === 'reveal' ? 'bg-rain-accent/20 text-rain-accent' : 'text-muted-foreground/50'}`}>
                    3. Reveal
                  </span>
                </div>

                {/* X / Y selector cards */}
                <div className="grid grid-cols-2 gap-4">
                  {(['X', 'Y'] as const).map((label) => {
                    const isActive = activeLabel === label
                    const revealedLabel = label === 'X' ? xLabel : yLabel
                    const isWinner = phase === 'reveal' && vote === label
                    return (
                      <button
                        key={label}
                        onClick={() => switchTo(label)}
                        disabled={phase === 'reveal'}
                        aria-label={`Switch to ${label}`}
                        className={`relative p-6 rounded-xl border-2 transition-all overflow-hidden ${
                          isActive
                            ? 'border-rain-accent bg-rain-accent/10 rain-glow-soft'
                            : 'border-rain-border bg-rain-surface-2/50 hover:border-rain-accent/40'
                        } ${phase === 'reveal' ? 'cursor-default' : 'cursor-pointer'} ${
                          isWinner ? 'ring-2 ring-rain-accent ring-offset-2 ring-offset-[rgba(18,20,26,1)]' : ''
                        }`}
                      >
                        {/* Large letter */}
                        <div
                          className={`text-6xl font-mono font-black mb-2 transition-colors ${
                            isActive ? 'text-rain-accent' : 'text-muted-foreground/60'
                          }`}
                          style={{ textShadow: isActive ? '0 0 24px rgba(170,255,0,0.4)' : 'none' }}
                        >
                          {label}
                        </div>

                        {/* Reveal label or "?" */}
                        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                          {phase === 'reveal' ? (
                            <span className={revealedLabel === 'MASTERED' ? 'text-rain-accent' : 'text-cyan-400'}>
                              {revealedLabel}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">Hidden</span>
                          )}
                        </div>

                        {/* Active indicator */}
                        {isActive && phase !== 'reveal' && (
                          <motion.div
                            layoutId="active-indicator"
                            className="absolute top-3 right-3 w-2 h-2 rounded-full bg-rain-accent rain-pulse"
                          />
                        )}

                        {/* Winner badge */}
                        {isWinner && (
                          <motion.div
                            initial={{ scale: 0, rotate: -20 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                            className="absolute top-2 right-2"
                          >
                            <Trophy className="w-5 h-5 text-rain-accent" />
                          </motion.div>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Controls row */}
                <div className="flex items-center justify-between gap-3">
                  {/* Play/pause + auto-switch */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePlay}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 transition-colors text-xs"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <span>Auto:</span>
                      {AUTO_INTERVALS.map((iv) => (
                        <button
                          key={iv.label}
                          onClick={() => setAutoMs(iv.ms)}
                          disabled={phase !== 'listening'}
                          aria-label={`Auto-switch interval: ${iv.label}`}
                          className={`px-1.5 py-0.5 rounded ${
                            autoMs === iv.ms
                              ? 'bg-rain-accent/20 text-rain-accent border border-rain-accent/40'
                              : 'hover:bg-rain-surface-3 border border-transparent'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {iv.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard hint */}
                  <div className="text-[10px] font-mono text-muted-foreground/60">
                    Press <kbd className="px-1 py-0.5 rounded border border-rain-border bg-rain-surface-3">X</kbd> / <kbd className="px-1 py-0.5 rounded border border-rain-border bg-rain-surface-3">Y</kbd> to switch
                  </div>
                </div>

                {/* Voting panel — only during listening phase */}
                <AnimatePresence mode="wait">
                  {phase === 'listening' && (
                    <motion.div
                      key="voting"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="space-y-2"
                    >
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-center">
                        Which sounds better?
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <VoteButton onClick={() => castVote('X')} icon={<Check className="w-3.5 h-3.5" />} label="X is better" kbd="1" color="#AAFF00" />
                        <VoteButton onClick={() => castVote('Y')} icon={<Check className="w-3.5 h-3.5" />} label="Y is better" kbd="2" color="#AAFF00" />
                        <VoteButton onClick={() => castVote('TIE')} icon={<Equal className="w-3.5 h-3.5" />} label="Tie" kbd="3" color="#8B5CF6" />
                        <VoteButton onClick={() => castVote('CANT_TELL')} icon={<HelpCircle className="w-3.5 h-3.5" />} label="Can't tell" kbd="4" color="#64748B" />
                      </div>
                    </motion.div>
                  )}

                  {phase === 'voted' && (
                    <motion.div
                      key="voted"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="flex flex-col items-center gap-3 py-2"
                    >
                      <div className="text-sm text-muted-foreground">
                        You voted: <span className="text-rain-accent font-semibold">
                          {vote === 'X' && 'X is better'}
                          {vote === 'Y' && 'Y is better'}
                          {vote === 'TIE' && 'Tie'}
                          {vote === 'CANT_TELL' && "Can't tell"}
                        </span>
                      </div>
                      <button
                        onClick={reveal}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-rain-accent text-black font-semibold text-sm hover:scale-[1.02] active:scale-95 transition-transform rain-glow-soft"
                      >
                        <Eye className="w-4 h-4" />
                        Reveal Truth <kbd className="ml-1 px-1 py-0.5 rounded bg-black/20 text-[9px]">R</kbd>
                      </button>
                    </motion.div>
                  )}

                  {phase === 'reveal' && (
                    <motion.div
                      key="reveal"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="space-y-3"
                    >
                      {/* Reveal banner */}
                      <div
                        className={`p-4 rounded-lg border text-center ${
                          userPreferredMastered === true
                            ? 'border-rain-accent/40 bg-rain-accent/10'
                            : userPreferredMastered === false
                              ? 'border-orange-500/40 bg-orange-500/10'
                              : 'border-purple-500/40 bg-purple-500/10'
                        }`}
                      >
                        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                          Result
                        </div>
                        <div className="text-base font-semibold">
                          {userPreferredMastered === true && (
                            <span className="text-rain-accent">You preferred the MASTERED version</span>
                          )}
                          {userPreferredMastered === false && (
                            <span className="text-orange-400">You preferred the ORIGINAL — interesting!</span>
                          )}
                          {(userPreferredMastered === null) && (
                            <span className="text-purple-400">Neutral vote — no clear preference</span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground mt-1">
                          X was {xLabel} · Y was {yLabel}
                        </div>
                      </div>

                      {/* Stats + next round */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 text-[10px] font-mono">
                          <span className="text-rain-accent">Mastered: {stats.masteredPref}</span>
                          <span className="text-orange-400">Original: {stats.originalPref}</span>
                          <span className="text-purple-400">Neutral: {stats.ties}</span>
                          <span className="text-muted-foreground">/ {stats.total} rounds</span>
                        </div>
                        <button
                          onClick={nextRound}
                          className="flex items-center gap-2 px-4 py-2 rounded-md bg-rain-accent text-black font-semibold text-sm hover:scale-[1.02] active:scale-95 transition-transform"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Next Round <kbd className="ml-1 px-1 py-0.5 rounded bg-black/20 text-[9px]">N</kbd>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-rain-border bg-rain-surface/20 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>
                  Tip: close your eyes, listen on good headphones. The randomization eliminates bias.
                </span>
                <span>
                  <kbd className="px-1 py-0.5 rounded border border-rain-border bg-rain-surface-3">Esc</kbd> to exit
                </span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function VoteButton({
  onClick,
  icon,
  label,
  kbd,
  color,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  kbd: string
  color: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 p-3 rounded-lg border border-rain-border bg-rain-surface-2/60 hover:bg-rain-surface-2 hover:border-rain-accent/40 transition-all group"
    >
      <span style={{ color }} className="group-hover:scale-110 transition-transform">
        {icon}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground group-hover:text-foreground">{label}</span>
      <kbd className="text-[9px] font-mono px-1 py-0.5 rounded border border-rain-border bg-rain-surface-3 text-muted-foreground">
        {kbd}
      </kbd>
    </button>
  )
}
