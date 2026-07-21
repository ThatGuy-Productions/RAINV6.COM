'use client'

/**
 * RAIN V6 — Studio Tour (step-by-step guided walkthrough)
 *
 * A modal overlay that guides new users through the studio's key features.
 * Highlights specific elements with a spotlight effect and explanatory text.
 * Includes Skip and Next/Back navigation. Progress is tracked in localStorage
 * so returning users don't see it again.
 *
 * Tour steps:
 *   1. Welcome
 *   2. Upload zone (Load Demo Track)
 *   3. Macro controls
 *   4. Run 16-Stage Master
 *   5. Export tab
 *   6. Provenance tab
 *   7. Analytics tab
 *   8. Sign Up prompt
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, SkipForward, Sparkles, Upload, Sliders, Zap, Download, Fingerprint, BarChart3, UserPlus } from 'lucide-react'

const TOUR_SEEN_KEY = 'rain_tour_seen_v1'

interface TourStep {
  id: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  title: string
  body: string
  highlight?: string // CSS selector to highlight (not implemented as spotlight yet, just text guide)
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    icon: Sparkles,
    title: 'Welcome to RAIN V6 Studio',
    body: 'This is a real in-browser mastering studio — every DSP measurement (LUFS, true-peak, spectrum) is computed live from your audio. No audio leaves your device on the free path. Let me show you around in 7 quick steps.',
  },
  {
    id: 'upload',
    icon: Upload,
    title: 'Step 1 — Load a track',
    body: 'Click "Load Demo Track" to load a built-in sample, or drag your own WAV/MP3/FLAC file into the upload zone. The audio is decoded entirely in your browser — it\'s never uploaded to a server.',
    highlight: 'Mastering tab → Upload Zone',
  },
  {
    id: 'macros',
    icon: Sliders,
    title: 'Step 2 — Adjust the macros',
    body: 'The 7 macro controls (Brighten, Glue, Width, Punch, Warmth, Space, Repair) map to 46 underlying DSP parameters. Each slider has a live tooltip showing exactly what it changes. Try the "AI Suggest" button for LLM-powered recommendations.',
    highlight: 'Mastering tab → Macro Controls',
  },
  {
    id: 'master',
    icon: Zap,
    title: 'Step 3 — Run the 16-stage master',
    body: 'Click "Run 16-Stage Master" to execute the full pipeline: analysis → gain staging → EQ → multiband compression → limiting → loudness → true-peak → dither. The RAIN Score updates in real time. Takes ~2-5 seconds depending on track length.',
    highlight: 'Mastering tab → Run Button',
  },
  {
    id: 'export',
    icon: Download,
    title: 'Step 4 — Export your master',
    body: 'Go to the Export tab to download WAV (24/16-bit), MP3 320 kbps, or Dolby Atmos. Each export is verified — the app re-parses the output bytes to confirm the provenance and metadata were actually embedded. Sign up to persist exports to your account.',
    highlight: 'Export tab',
  },
  {
    id: 'provenance',
    icon: Fingerprint,
    title: 'Step 5 — Ed25519 provenance',
    body: 'Every render can be signed with an Ed25519 key generated in your browser. The RAIN-CERT certificate embeds input/output SHA-256 hashes and a C2PA v2.2 manifest — proving the audio was mastered in RAIN V6 and hasn\'t been tampered with.',
    highlight: 'Provenance tab',
  },
  {
    id: 'analytics',
    icon: BarChart3,
    title: 'Step 6 — Track your stats',
    body: 'The Analytics tab shows your render history, macro evolution, QC results, and export format distribution — all stored locally in IndexedDB. Your anonymous usage also feeds the public Beta Velocity stats on the landing page.',
    highlight: 'Analytics tab',
  },
  {
    id: 'signup',
    icon: UserPlus,
    title: 'Step 7 — Sign up to persist',
    body: 'Click "Sign Up" in the top bar to create a free account. Your sessions, renders, and provenance keys will persist to your profile. Plus, your anonymous beta activity is carried over and attributed to your new account. No credit card needed.',
  },
]

export function StudioTour() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  // Check if the tour should show (first visit, not seen before).
  useEffect(() => {
    try {
      const seen = localStorage.getItem(TOUR_SEEN_KEY)
      if (!seen) {
        // Small delay so the studio finishes loading first.
        const timer = window.setTimeout(() => setOpen(true), 1500)
        return () => window.clearTimeout(timer)
      }
    } catch {
      // localStorage disabled — skip tour
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem(TOUR_SEEN_KEY, '1') } catch { /* noop */ }
  }, [])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      close()
    }
  }, [step, close])

  const back = useCallback(() => {
    if (step > 0) setStep(step - 1)
  }, [step])

  // Esc to skip
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, next, back])

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative w-full max-w-lg rounded-xl border border-[rgba(170,255,0,0.2)] bg-[rgba(14,16,22,0.98)] shadow-2xl overflow-hidden"
            style={{ boxShadow: '0 24px 80px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(170,255,0,0.05)' }}
          >
            {/* Top accent */}
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#AAFF00] to-transparent opacity-60" />

            {/* Close (skip) button — always visible */}
            <button
              onClick={close}
              className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors z-10"
              aria-label="Skip tour"
              title="Skip tour"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Content */}
            <div className="px-6 pt-6 pb-5">
              {/* Icon + step indicator */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-[#AAFF00]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                    Tour · Step {step + 1} of {STEPS.length}
                  </div>
                  <h2 className="text-base font-semibold tracking-tight leading-tight">
                    {current.title}
                  </h2>
                </div>
              </div>

              {/* Body */}
              <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
                {current.body}
              </p>

              {/* Highlight hint */}
              {current.highlight && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[rgba(170,255,0,0.06)] border border-[rgba(170,255,0,0.15)] mb-4">
                  <Sparkles className="w-3 h-3 text-[#AAFF00] flex-shrink-0" />
                  <span className="text-[11px] font-mono text-[#AAFF00]/80">
                    {current.highlight}
                  </span>
                </div>
              )}

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mb-4">
                {STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setStep(i)}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === step ? '24px' : '8px',
                      backgroundColor: i === step ? '#AAFF00' : i < step ? 'rgba(170,255,0,0.4)' : 'rgba(255,255,255,0.1)',
                    }}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <button
                  onClick={close}
                  className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SkipForward className="w-3 h-3" />
                  Skip tour
                </button>
                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <button
                      onClick={back}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                  )}
                  <button
                    onClick={next}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-[#AAFF00] text-black text-[12px] font-semibold hover:bg-[#c5ff4a] active:scale-95 transition-all"
                  >
                    {isLast ? 'Get started' : 'Next'}
                    {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Check if the tour has been seen (for external use). */
export function hasSeenTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY)
  } catch {
    return true // don't show if localStorage is disabled
  }
}

/** Reset the tour (for testing or "replay tour" button). */
export function resetTour() {
  try {
    localStorage.removeItem(TOUR_SEEN_KEY)
  } catch { /* noop */ }
}
