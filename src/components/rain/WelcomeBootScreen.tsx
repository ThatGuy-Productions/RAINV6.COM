'use client'

/**
 * WelcomeBootScreen — cinematic 3.2s boot animation overlay for RAIN V6.
 *
 * Sequence:
 *   0.0–0.4s  particle field of 80 lime dots converges toward center
 *   0.3–0.9s  RAIN logo emerges (scale 0.8→1, blur 12px→0)
 *   0.6–1.4s  scan-line sweeps top→bottom
 *   0.9–1.6s  "AI Audio Operating System" subtitle fades in
 *   1.2–2.6s  5 terminal boot-log lines appear one-by-one (180ms stagger)
 *   2.6–3.0s  bottom lime progress bar fills 0→100%
 *   3.0–3.2s  overlay fades out, onComplete fires
 *
 * Skip: click anywhere / press any key → instant fade-out.
 * SessionStorage-gated: plays once per browser session (`rain_boot_seen`).
 * Accessibility: role=dialog / aria-modal / prefers-reduced-motion short-circuit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Check, ChevronRight } from 'lucide-react'

interface WelcomeBootScreenProps {
  onComplete: () => void
}

const BOOT_LINES = [
  'initializing DSP engine · TS-native',
  'loading 16-stage mastering pipeline',
  'mounting analyser · 2048-pt FFT',
  'RAIN-CERT provenance · Ed25519 ready',
  'AI Co-Master · standby',
]

const PARTICLE_COUNT = 80
const AUTO_FINISH_MS = 3000 // when the fade-out begins
const FADE_DURATION_S = 0.2 // 3.0s → 3.2s
const PROGRESS_START_MS = 2600
const PROGRESS_DURATION_MS = 400
const BOOT_LOG_START_S = 1.2
const BOOT_LOG_STAGGER_S = 0.18
const BOOT_CHECK_OFFSET_S = 0.15

const WAVEFORM_WIDTH = 600
const WAVEFORM_HEIGHT = 80
const WAVEFORM_CYCLES = 3
const WAVEFORM_STEPS = 80

interface Particle {
  id: number
  dx: number // initial x offset from center, in vw
  dy: number // initial y offset from center, in vh
  size: number
  delay: number
  duration: number
}

function makeParticles(): Particle[] {
  const arr: Particle[] = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = 30 + Math.random() * 45 // 30–75 vw/vh from center
    arr.push({
      id: i,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 1 + Math.random() * 2, // 1–3 px
      delay: Math.random() * 0.15,
      duration: 0.5 + Math.random() * 0.25,
    })
  }
  return arr
}

export function WelcomeBootScreen({ onComplete }: WelcomeBootScreenProps) {
  // Lazy initial state — safe because the parent (page.tsx) only mounts this
  // component post-hydration, so window/sessionStorage/matchMedia are available.
  const [alreadySeen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return sessionStorage.getItem('rain_boot_seen') === '1'
    } catch {
      return false
    }
  })

  const [prefersReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })

  const shouldAnimate = !alreadySeen && !prefersReduced

  const [phase, setPhase] = useState<'playing' | 'done'>('playing')
  const [progress, setProgress] = useState(0)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const pathRef = useRef<SVGPathElement | null>(null)

  // Keep the latest onComplete in a ref without touching it during render.
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const particles = useMemo<Particle[]>(
    () => (shouldAnimate ? makeParticles() : []),
    [shouldAnimate],
  )

  const finish = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    try {
      sessionStorage.setItem('rain_boot_seen', '1')
    } catch {
      // sessionStorage unavailable (private mode / disabled) — non-fatal
    }
    setPhase('done')
  }, [])

  // --- Path 1: already seen this session → render nothing, fire onComplete ---
  useEffect(() => {
    if (!alreadySeen) return
    onCompleteRef.current()
  }, [alreadySeen])

  // --- Path 2: prefers-reduced-motion → set flag, fire onComplete after 200ms ---
  useEffect(() => {
    if (!prefersReduced || alreadySeen) return
    try {
      sessionStorage.setItem('rain_boot_seen', '1')
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => {
      completedRef.current = true
      onCompleteRef.current()
    }, 200)
    return () => window.clearTimeout(t)
  }, [prefersReduced, alreadySeen])

  // --- Path 3: full cinematic play — schedule auto-finish at 3.0s ---
  useEffect(() => {
    if (!shouldAnimate) return
    const t = window.setTimeout(finish, AUTO_FINISH_MS)
    return () => window.clearTimeout(t)
  }, [shouldAnimate, finish])

  // Skip via any keydown while playing
  useEffect(() => {
    if (!shouldAnimate || phase !== 'playing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      e.preventDefault()
      finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shouldAnimate, phase, finish])

  // Bottom progress bar — fills 0→100% between 2.6s and 3.0s
  useEffect(() => {
    if (!shouldAnimate) return
    let rafId: number | null = null
    const startTimer = window.setTimeout(() => {
      const startT = performance.now()
      const step = (now: number) => {
        if (completedRef.current) return
        const elapsed = now - startT
        const pct = Math.min(100, (elapsed / PROGRESS_DURATION_MS) * 100)
        setProgress(pct)
        if (pct < 100) {
          rafId = requestAnimationFrame(step)
        }
      }
      rafId = requestAnimationFrame(step)
    }, PROGRESS_START_MS)
    return () => {
      window.clearTimeout(startTimer)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [shouldAnimate])

  // Audio-reactive decorative waveform behind the logo (ref-driven, no React re-renders)
  useEffect(() => {
    if (!shouldAnimate) return
    let rafId: number | null = null
    const startT = performance.now()
    const tick = (now: number) => {
      if (completedRef.current) return
      const t = (now - startT) / 1000
      const amp = 14 + Math.sin(t * 1.6) * 6
      const phaseShift = t * 1.9
      const path = pathRef.current
      if (path) {
        const pts: string[] = []
        for (let i = 0; i <= WAVEFORM_STEPS; i++) {
          const x = (i / WAVEFORM_STEPS) * WAVEFORM_WIDTH
          const y =
            WAVEFORM_HEIGHT / 2 +
            Math.sin((i / WAVEFORM_STEPS) * Math.PI * 2 * WAVEFORM_CYCLES + phaseShift) * amp
          pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
        }
        path.setAttribute('d', pts.join(' '))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [shouldAnimate])

  // Short-circuit: render nothing for already-seen or reduced-motion users.
  if (alreadySeen || prefersReduced) return null

  return (
    <AnimatePresence onExitComplete={() => onCompleteRef.current()}>
      {phase === 'playing' && (
        <motion.div
          key="rain-boot-screen"
          role="dialog"
          aria-label="Welcome to RAIN V6"
          aria-modal="true"
          className="fixed inset-0 z-[100] bg-rain-surface overflow-hidden cursor-pointer select-none"
          onClick={finish}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: FADE_DURATION_S, ease: 'easeOut' }}
        >
          {/* Backdrop texture */}
          <div className="absolute inset-0 rain-bg-grid opacity-30 pointer-events-none" aria-hidden />
          {/* Center radial glow — sells the "studio spotlight" feel */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] max-w-[90vw] max-h-[90vw] rounded-full blur-3xl opacity-25 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #AAFF00 0%, transparent 70%)' }}
            aria-hidden
          />

          {/* Particle field — 80 lime dots converging to center */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            {particles.map((p) => (
              <motion.span
                key={p.id}
                className="absolute top-1/2 left-1/2 rounded-full bg-rain-accent"
                style={{
                  width: p.size,
                  height: p.size,
                  marginLeft: -p.size / 2,
                  marginTop: -p.size / 2,
                  boxShadow: '0 0 6px -1px rgba(170,255,0,0.7)',
                }}
                initial={{ x: `${p.dx}vw`, y: `${p.dy}vh`, opacity: 0, scale: 0.4 }}
                animate={{ x: 0, y: 0, opacity: [0, 1, 0], scale: [0.4, 1, 0.2] }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  ease: 'easeIn',
                }}
              />
            ))}
          </div>

          {/* Scan-line sweep — 2px lime bar with rain-glow, top→bottom */}
          <motion.div
            className="absolute left-0 right-0 h-[2px] bg-rain-accent rain-glow pointer-events-none"
            style={{ top: 0 }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: ['0vh', '100vh'], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 0.8,
              delay: 0.6,
              ease: 'easeInOut',
              opacity: { duration: 0.8, delay: 0.6, times: [0, 0.1, 0.9, 1] },
            }}
            aria-hidden
          />

          {/* Center content stack */}
          <div className="relative h-full w-full flex flex-col items-center justify-center px-6">
            {/* Audio-reactive waveform (decorative, behind logo) */}
            <motion.svg
              viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute w-[600px] max-w-[90vw] h-20 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              aria-hidden
            >
              <path
                ref={pathRef}
                d={`M 0 ${WAVEFORM_HEIGHT / 2} L ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT / 2}`}
                fill="none"
                stroke="#AAFF00"
                strokeWidth={1.5}
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 4px rgba(170,255,0,0.6))' }}
              />
            </motion.svg>

            {/* RAIN V6 logo */}
            <motion.h1
              className="relative text-7xl md:text-8xl font-bold tracking-tight text-center"
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(12px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
            >
              <span className="rain-gradient-text">RAIN</span>{' '}
              <span className="text-foreground">V6</span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              className="mt-4 text-sm font-mono uppercase tracking-widest text-muted-foreground"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.9 }}
            >
              AI Audio Operating System
            </motion.p>

            {/* Terminal boot log */}
            <div
              className="mt-10 w-full max-w-md font-mono text-xs text-rain-accent/80 space-y-1.5"
              aria-live="polite"
            >
              {BOOT_LINES.map((line, i) => (
                <motion.div
                  key={i}
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: BOOT_LOG_START_S + i * BOOT_LOG_STAGGER_S,
                    ease: 'easeOut',
                  }}
                >
                  <ChevronRight
                    className="w-3 h-3 text-muted-foreground/60 shrink-0"
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{line}</span>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: 0.2,
                      delay: BOOT_LOG_START_S + i * BOOT_LOG_STAGGER_S + BOOT_CHECK_OFFSET_S,
                    }}
                    className="text-rain-accent shrink-0"
                    aria-hidden
                  >
                    <Check className="w-3 h-3" />
                  </motion.span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Bottom progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-rain-border/40">
            <div
              className="h-full bg-rain-accent"
              style={{
                width: `${progress}%`,
                boxShadow: '0 0 12px -2px rgba(170,255,0,0.7)',
              }}
            />
          </div>

          {/* Skip hint */}
          <div className="absolute bottom-6 right-6 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 pointer-events-none">
            <span>Skip intro</span>
            <ArrowRight className="w-3 h-3" aria-hidden />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
