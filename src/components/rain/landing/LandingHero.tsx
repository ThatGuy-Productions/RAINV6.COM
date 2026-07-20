'use client'

import { motion, useInView } from 'framer-motion'
import { ArrowRight, Cloud, Cpu, Globe, Layers, Lock, ShieldCheck, Sparkles, Split, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RAIN_BRAND } from '@/lib/rain/constants'
import { DataRain } from '@/components/rain/ui/DataRain'

interface LandingHeroProps {
  onLaunch: () => void
}

/* ---------------------------------------------------------------------------
   Matrix-style data rain replaced the floating particle field (Task 10).
   The rain canvas lives in <DataRain />; the rest of the hero is unchanged.
   --------------------------------------------------------------------------- */

export function LandingHero({ onLaunch }: LandingHeroProps) {
  return (
    <section className="relative overflow-hidden min-h-[92vh] flex items-center">
      {/* Background grid + glow */}
      <div className="absolute inset-0 rain-bg-grid opacity-60" aria-hidden />

      {/* Matrix data rain (replaces particle field) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <DataRain opacity={0.5} fontSize={14} columnWidth={18} speed={1} />
        {/* Vignette so the rain fades at edges and content stays readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 30% 50%, rgba(10,11,14,0.85) 0%, rgba(10,11,14,0.4) 50%, transparent 100%)',
          }}
        />
      </div>

      {/* Gradient orbs */}
      <div
        className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full blur-3xl opacity-30 rain-rotate-slow"
        style={{ background: 'radial-gradient(circle, #AAFF00 0%, transparent 70%)' }}
        aria-hidden
      />
      <div
        className="absolute -bottom-32 -right-32 w-[700px] h-[700px] rounded-full blur-3xl opacity-20 rain-rotate-slow"
        style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)' }}
        aria-hidden
      />
      {/* Cyan orb at top-center */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full blur-3xl opacity-15 rain-float"
        style={{ background: 'radial-gradient(circle, #00D4FF 0%, transparent 70%)', animationDelay: '1s' }}
        aria-hidden
      />
      {/* Purple orb at bottom-left */}
      <div
        className="absolute bottom-0 left-0 w-[450px] h-[450px] rounded-full blur-3xl opacity-15 rain-float"
        style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)', animationDelay: '2.5s' }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-6 py-24 lg:py-32 grid lg:grid-cols-12 gap-12 items-center">
        {/* Left — copy */}
        <div className="lg:col-span-7 space-y-8">
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-rain-border bg-rain-surface-2/60 backdrop-blur text-xs font-mono uppercase tracking-wider"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rain-accent rain-pulse" />
            <span className="text-rain-accent">Commercial Release Candidate</span>
            <span className="text-muted-foreground">· {RAIN_BRAND.version}</span>
          </motion.div>

          <motion.h1
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            <span className="rain-gradient-text">RAIN</span> <span className="text-foreground">V6</span>
            <br />
            <span className="text-2xl md:text-3xl lg:text-4xl font-medium text-muted-foreground">
              The AI Audio Operating System
            </span>
          </motion.h1>

          <motion.p
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed"
          >
            Studio-grade mastering, 12-stem separation, Dolby Atmos binaural, RAIN-CERT
            provenance, and DDEX distribution — all running on a deterministic in-browser
            DSP engine. Audio never leaves your device on the free path.
          </motion.p>

          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="flex flex-wrap gap-3"
          >
            {/* Launch Studio button with animated gradient border (Task 8-a) */}
            <button
              onClick={onLaunch}
              className="rain-btn-gradient-border group relative inline-flex items-center gap-2 px-6 py-3 rounded-md font-semibold hover:scale-[1.02] active:scale-95 transition-transform text-black"
            >
              Launch Studio
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform relative z-10" />
            </button>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md border border-rain-border bg-rain-surface-2/60 backdrop-blur hover:border-rain-accent/60 transition-colors"
            >
              <Sparkles className="w-4 h-4 text-rain-accent" />
              Explore the architecture
            </a>
            {/* ── Free Beta Notice ──────────────────────────────────── */}
            <div
              className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-md border border-rain-accent/40 bg-rain-accent/10 text-rain-accent font-semibold"
            >
              <Sparkles className="w-4 h-4" />
              RAIN V6 — Free Public Beta
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-rain-accent/20 text-rain-accent border border-rain-accent/30">
                Full Capability
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 max-w-2xl"
          >
            <Stat label="Pipeline stages" value={16} icon={<Layers className="w-3.5 h-3.5" />} progress={100} />
            <Stat label="Stem separation" value={12} icon={<Split className="w-3.5 h-3.5" />} progress={92} />
            <Stat label="Platform targets" value={27} icon={<Globe className="w-3.5 h-3.5" />} progress={78} />
            <Stat label="QC checks" value={18} icon={<ShieldCheck className="w-3.5 h-3.5" />} progress={100} />
          </motion.div>
        </div>

        {/* Right — visual */}
        <motion.div
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="lg:col-span-5 relative"
        >
          <HeroVisual />
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
   Stat with counter animation + icon + animated progress bar
   --------------------------------------------------------------------------- */
function Stat({
  label,
  value,
  icon,
  progress,
}: {
  label: string
  value: number
  icon: React.ReactNode
  progress: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })
  const [displayValue, setDisplayValue] = useState(0)
  const [barWidth, setBarWidth] = useState(0)

  useEffect(() => {
    if (!isInView) return

    const duration = 1500 // 1.5 seconds
    const startTime = performance.now()
    let rafId: number

    const animate = (now: number) => {
      const elapsed = now - startTime
      const p = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayValue(Math.round(eased * value))
      // Progress bar mirrors the same easing curve
      setBarWidth(eased * progress)
      if (p < 1) {
        rafId = requestAnimationFrame(animate)
      }
    }

    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [isInView, value, progress])

  return (
    <div ref={ref} className="border-l border-rain-border pl-3">
      <div className="flex items-center gap-1.5">
        <span className="text-rain-accent">{icon}</span>
        <span className="text-2xl font-bold rain-gradient-text-lime font-mono">
          {displayValue}
        </span>
      </div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      {/* Animated progress bar (1px tall, lime) */}
      <div className="mt-1.5 h-px w-full bg-rain-border/60 overflow-hidden">
        <div
          className="h-full bg-rain-accent transition-[width] duration-100 ease-out"
          style={{
            width: `${barWidth}%`,
            boxShadow: '0 0 6px -1px rgba(170,255,0,0.6)',
          }}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   HeroVisual with animated waveform + accent particles in panel
   --------------------------------------------------------------------------- */

function HeroVisual() {
  const [wavePhase, setWavePhase] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setWavePhase((prev) => prev + 0.15)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative aspect-square max-w-md mx-auto">
      {/* Mini data rain behind the panel (replaces floating particles) */}
      <div className="absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
        <DataRain opacity={0.35} fontSize={10} columnWidth={12} speed={0.6} />
      </div>

      {/* Glow ring */}
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-40"
        style={{ background: 'radial-gradient(circle, #AAFF00 0%, transparent 60%)' }}
        aria-hidden
      />
      <div className="relative rain-panel rounded-2xl p-6 backdrop-blur">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500/70" />
            <div className="w-2 h-2 rounded-full bg-yellow-500/70" />
            <div className="w-2 h-2 rounded-full bg-green-500/70" />
          </div>
          <span className="text-xs font-mono text-muted-foreground">rain-engine · 64-bit</span>
        </div>
        <div className="space-y-3">
          {/* Animated waveform */}
          <div className="h-20 flex items-center gap-0.5">
            {Array.from({ length: 64 }).map((_, i) => {
              const h = 30 + Math.abs(Math.sin(i * 0.5 + wavePhase) * 50) + Math.abs(Math.cos(i * 0.3 + wavePhase * 0.7) * 20)
              // Round to 1 decimal place to avoid SSR/client float-serialization
              // hydration mismatch (server rounds 88.01147…→"88.0115%", client
              // renders full precision "88.01147502765643%").
              const hp = Math.round(Math.min(100, h) * 10) / 10
              return (
                <div
                  key={i}
                  className="flex-1 rounded-full transition-[height] duration-100 ease-out"
                  style={{
                    height: `${hp}%`,
                    background: i % 8 === 0 ? '#AAFF00' : 'rgba(170, 255, 0, 0.4)',
                  }}
                />
              )
            })}
          </div>
          {/* Meters */}
          <div className="grid grid-cols-2 gap-3">
            <MeterBar label="LUFS" value={-14} target={-14} />
            <MeterBar label="TRUE PEAK" value={-1.0} target={-1.0} />
          </div>
          {/* Macros */}
          <div className="grid grid-cols-7 gap-1.5 pt-2">
            {['B', 'G', 'W', 'P', 'W', 'S', 'R'].map((m, i) => (
              <div key={i} className="aspect-square rounded-md bg-rain-surface-3 flex items-center justify-center text-[10px] font-bold" style={{ color: ['#AAFF00', '#8B5CF6', '#00D4FF', '#F97316', '#D946EF', '#06B6D4', '#10B981'][i] }}>
                {m}
              </div>
            ))}
          </div>
        </div>
        {/* Footer pills */}
        <div className="absolute -bottom-3 -right-3 flex gap-1">
          <Pill icon={<Cpu className="w-3 h-3" />} label="WASM" />
          <Pill icon={<Lock className="w-3 h-3" />} label="Ed25519" />
          <Pill icon={<Cloud className="w-3 h-3" />} label="Local-first" />
          <Pill icon={<Zap className="w-3 h-3" />} label="48 kHz" />
        </div>
      </div>
    </div>
  )
}

function MeterBar({ label, value, target }: { label: string; value: number; target: number }) {
  const delta = Math.abs(value - target)
  const ok = delta < 0.5
  return (
    <div className="bg-rain-surface-3/60 rounded p-2">
      <div className="flex justify-between text-[10px] font-mono mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span style={{ color: ok ? '#AAFF00' : '#F97316' }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-rain-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ok ? 80 : 50}%`, background: ok ? '#AAFF00' : '#F97316' }}
        />
      </div>
    </div>
  )
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-rain-surface-2 border border-rain-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground rain-float">
      <span className="text-rain-accent">{icon}</span>
      {label}
    </div>
  )
}