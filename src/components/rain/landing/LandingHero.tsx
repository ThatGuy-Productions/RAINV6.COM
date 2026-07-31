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
   RAIN V6 Landing Hero — $100M aesthetic (2026-07-29 overhaul)

   Principles (six-point audit):
     1. Contrast hierarchy — background supports, never competes.
        Darker base, quieter grid, single accent glow, aggressive vignette.
     2. Hero card depth — stronger glow ring, perspective transform,
        layered box shadows, bloom effect.
     3. Breathing room — deliberate vertical spacing between every block.
     4. Matrix rain at 25 % — background, not foreground.
     5. Purple as accent — targeted rim light, not atmospheric fog.
     6. Multi-source lighting — green ring + neon bloom + top-edge +
        subtle purple reflection.
   --------------------------------------------------------------------------- */

export function LandingHero({ onLaunch }: LandingHeroProps) {
  return (
    <section className="relative overflow-hidden min-h-[92vh] flex items-center">
      {/* ════════════════════════════════════════════════════════
          Layer 0 — Background
          Near-black base · grid at 15 % · single green ring glow
          ════════════════════════════════════════════════════════ */}
      <div
        className="absolute inset-0"
        style={{ background: '#08090D' }}
        aria-hidden
      />
      <div className="absolute inset-0 rain-bg-grid opacity-[0.12]" aria-hidden />

      {/* ════════════════════════════════════════════════════════
          Layer 1 — Matrix data rain (25 %, background role only)
          ════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <DataRain opacity={0.25} fontSize={14} columnWidth={20} speed={0.85} />
        {/* Heavy vignette — darkens edges so rain fades away, content keeps focus */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 55% at 35% 50%, rgba(8,9,13,0.92) 0%, rgba(8,9,13,0.55) 50%, rgba(8,9,13,0.9) 100%)',
          }}
        />
      </div>

      {/* ════════════════════════════════════════════════════════
          Layer 2 — Accent lighting (two sources only)
          · Green ring at upper-left — primary accent
          · Purple rim at top-right — premium secondary accent
          No cyan orb. No bottom-left purple fog. No rotation.
          ════════════════════════════════════════════════════════ */}

      {/* Green glow — tight, positioned behind the hero card */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          top: '10%',
          left: '48%',
          width: '500px',
          height: '500px',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(circle at center, rgba(170,255,0,0.18) 0%, rgba(170,255,0,0.04) 45%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Purple accent — subtle rim light near hero visual top-right */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          top: '5%',
          right: '5%',
          width: '350px',
          height: '350px',
          background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.12) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* ════════════════════════════════════════════════════════
          Layer 3 — Content grid
          ════════════════════════════════════════════════════════ */}
      <div className="relative max-w-7xl mx-auto px-6 py-24 lg:py-32 grid lg:grid-cols-12 gap-14 items-center">
        {/* Left — copy · deliberate vertical spacing */}
        <div className="lg:col-span-7 space-y-10">
          {/* ── Phase badge ────────────────────────────────────── */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-rain-border/60 bg-rain-surface-2/40 backdrop-blur text-xs font-mono uppercase tracking-wider"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rain-accent rain-pulse" />
            <span className="text-rain-accent">Commercial Release Candidate</span>
            <span className="text-muted-foreground">· {RAIN_BRAND.version}</span>
          </motion.div>

          {/* ── Headline ───────────────────────────────────────── */}
          <motion.h1
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="text-5xl md:text-6xl lg:text-8xl font-bold tracking-tight leading-[0.92]"
          >
            <span className="rain-gradient-text">RAIN</span>{' '}
            <span className="text-foreground">V6</span>
          </motion.h1>

          {/* ── Subtitle — more breathing room ─────────────────── */}
          <motion.p
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="text-xl md:text-2xl lg:text-3xl font-light text-muted-foreground tracking-tight"
          >
            The AI Audio Operating System
          </motion.p>

          {/* ── Blank spacer — eyes rest here ──────────────────── */}
          <div className="h-2" aria-hidden />

          {/* ── Description — generous line-height ─────────────── */}
          <motion.p
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="text-base md:text-lg text-muted-foreground/80 max-w-xl leading-[1.75]"
          >
            Studio-grade mastering, 12-stem separation, Dolby Atmos
            binaural, RAIN-CERT provenance, and DDEX distribution — all
            running on a deterministic in-browser DSP engine. Audio never
            leaves your device on the free path.
          </motion.p>

          {/* ── Accent line — green sentence (promo render detail) ─ */}
          <motion.p
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-sm md:text-base text-rain-accent font-medium tracking-wide"
          >
            Now in free public beta — full capability, zero cost.
          </motion.p>

          {/* ── Blank spacer ────────────────────────────────────── */}
          <div className="h-1" aria-hidden />

          {/* ── Feature stats ───────────────────────────────────── */}
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-xl"
          >
            <Stat label="Pipeline stages" value={16} icon={<Layers className="w-3.5 h-3.5" />} progress={100} />
            <Stat label="Stem separation" value={12} icon={<Split className="w-3.5 h-3.5" />} progress={92} />
            <Stat label="Platform targets" value={27} icon={<Globe className="w-3.5 h-3.5" />} progress={78} />
            <Stat label="QC checks" value={18} icon={<ShieldCheck className="w-3.5 h-3.5" />} progress={100} />
          </motion.div>

          {/* ── Blank spacer ────────────────────────────────────── */}
          <div className="h-1" aria-hidden />

          {/* ── CTA row ─────────────────────────────────────────── */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="flex flex-wrap gap-3"
          >
            {/* Primary — Launch Studio (gradient-border button) */}
            <button
              onClick={onLaunch}
              className="rain-btn-gradient-border group relative inline-flex items-center gap-2 px-7 py-3.5 rounded-md font-semibold hover:scale-[1.02] active:scale-95 transition-transform text-black text-base"
            >
              Launch Studio
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform relative z-10" />
            </button>

            {/* Secondary — Explore */}
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-md border border-rain-border/70 bg-rain-surface-2/40 backdrop-blur hover:border-rain-accent/40 transition-colors text-sm"
            >
              <Sparkles className="w-4 h-4 text-rain-accent" />
              Explore the architecture
            </a>

            {/* Free Beta badge */}
            <div className="inline-flex items-center gap-2 px-6 py-3.5 rounded-md border border-rain-accent/30 bg-rain-accent/8 text-rain-accent font-semibold text-sm">
              <Sparkles className="w-4 h-4" />
              Free Public Beta
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-rain-accent/15 text-rain-accent border border-rain-accent/25">
                Full Capability
              </span>
            </div>
          </motion.div>
        </div>

        {/* Right — hero visual with depth */}
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
   Stat — counter animation + progress bar
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
    const duration = 1500
    const startTime = performance.now()
    let rafId: number
    const animate = (now: number) => {
      const elapsed = now - startTime
      const p = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayValue(Math.round(eased * value))
      setBarWidth(eased * progress)
      if (p < 1) rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [isInView, value, progress])

  return (
    <div ref={ref} className="border-l border-rain-border/50 pl-3">
      <div className="flex items-center gap-1.5">
        <span className="text-rain-accent">{icon}</span>
        <span className="text-2xl font-bold rain-gradient-text-lime font-mono">{displayValue}</span>
      </div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="mt-1.5 h-px w-full bg-rain-border/50 overflow-hidden">
        <div
          className="h-full bg-rain-accent transition-[width] duration-100 ease-out"
          style={{ width: `${barWidth}%`, boxShadow: '0 0 6px -1px rgba(170,255,0,0.6)' }}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   HeroVisual — premium $100M floating mastering card

   Key depth techniques:
     · Strong green glow ring (larger, brighter, with bloom)
     · perspective() + rotateY() — the card feels like it's in 3D space
     · Layered box shadows — near, mid, and far glow
     · Purple rim-light accent reflected on the card edge
     · Slightly larger card with cleaner edges
   --------------------------------------------------------------------------- */
function HeroVisual() {
  const [wavePhase, setWavePhase] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const interval = setInterval(() => setWavePhase((prev) => prev + 0.15), 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative max-w-lg mx-auto" ref={cardRef}>
      {/* ════════════════════════════════════════════════════════
          Green glow ring — large, bright, with bloom
          ════════════════════════════════════════════════════════ */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          inset: '-60px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(170,255,0,0.25) 0%, rgba(170,255,0,0.08) 40%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* ════════════════════════════════════════════════════════
          Neon bloom — bright lime aura directly behind the card
          ════════════════════════════════════════════════════════ */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          inset: '-16px',
          borderRadius: '20px',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(170,255,0,0.18) 0%, transparent 70%)',
          filter: 'blur(24px)',
        }}
      />

      {/* ════════════════════════════════════════════════════════
          Purple rim light — subtle accent reflection on the card
          ════════════════════════════════════════════════════════ */}
      <div
        className="absolute pointer-events-none"
        aria-hidden
        style={{
          top: '-10px',
          right: '-10px',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.15) 0%, transparent 60%)',
          filter: 'blur(50px)',
        }}
      />

      {/* ════════════════════════════════════════════════════════
          The card itself — perspective for floating depth
          ════════════════════════════════════════════════════════ */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          transform: 'perspective(900px) rotateY(-2.5deg) rotateX(1.5deg)',
          transformStyle: 'preserve-3d',
          boxShadow:
            // near glow — green halo hugging the card
            '0 0 40px -8px rgba(170,255,0,0.22),' +
            // mid glow — larger, softer
            '0 0 80px -16px rgba(170,255,0,0.12),' +
            // far shadow — deep, dramatic
            '0 32px 64px -16px rgba(0,0,0,0.6),' +
            // purple edge reflection
            '4px 0 12px -4px rgba(139,92,246,0.12)',
        }}
      >
        {/* Card background — dark surface with subtle gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(160deg, #14161E 0%, #0D0F15 40%, #0A0C12 100%)',
            border: '1px solid rgba(42,46,58,0.7)',
            borderRadius: '16px',
          }}
          aria-hidden
        />

        {/* Top-edge highlight — premium rim light on the card */}
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(170,255,0,0.25) 20%, rgba(170,255,0,0.35) 50%, rgba(170,255,0,0.25) 80%, transparent 100%)',
          }}
          aria-hidden
        />

        {/* Subtle micro-grid behind waveform */}
        <div
          className="absolute inset-0 rain-bg-grid opacity-[0.08]"
          aria-hidden
        />

        {/* ── Card content ─────────────────────────────────────── */}
        <div className="relative p-6">
          {/* Title bar */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground tracking-wide">
              rain-engine{' '}
              <span className="text-rain-accent/70">·</span>{' '}
              64-bit
            </span>
          </div>

          <div className="space-y-3.5">
            {/* Animated waveform — 64 bars */}
            <div className="h-24 flex items-end gap-[2px]">
              {Array.from({ length: 64 }).map((_, i) => {
                const h =
                  25 +
                  Math.abs(Math.sin(i * 0.5 + wavePhase) * 55) +
                  Math.abs(Math.cos(i * 0.3 + wavePhase * 0.7) * 22)
                const hp = Math.round(Math.min(100, h) * 10) / 10
                const isPeak = i % 8 === 0
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-[height] duration-100 ease-out"
                    style={{
                      height: `${hp}%`,
                      background: isPeak
                        ? 'linear-gradient(to top, #AAFF00, rgba(170,255,0,0.7))'
                        : 'rgba(170, 255, 0, 0.35)',
                      boxShadow: isPeak ? '0 0 6px -1px rgba(170,255,0,0.5)' : 'none',
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

            {/* Macro keys — 7 colored pads */}
            <div className="grid grid-cols-7 gap-1.5 pt-1.5">
              {[
                { key: 'B', color: '#AAFF00' },
                { key: 'G', color: '#8B5CF6' },
                { key: 'W', color: '#00D4FF' },
                { key: 'P', color: '#F97316' },
                { key: 'W', color: '#D946EF' },
                { key: 'S', color: '#06B6D4' },
                { key: 'R', color: '#10B981' },
              ].map(({ key, color }, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-md flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: `${color}15`,
                    color,
                    border: `1px solid ${color}30`,
                  }}
                >
                  {key}
                </div>
              ))}
            </div>
          </div>

          {/* Pill badges — floating below the card */}
          <div className="absolute -bottom-3 -right-3 flex gap-1">
            <Pill icon={<Cpu className="w-3 h-3" />} label="WASM" />
            <Pill icon={<Lock className="w-3 h-3" />} label="Ed25519" />
            <Pill icon={<Cloud className="w-3 h-3" />} label="Local-first" />
            <Pill icon={<Zap className="w-3 h-3" />} label="48 kHz" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   MeterBar
   --------------------------------------------------------------------------- */
function MeterBar({
  label,
  value,
  target,
}: {
  label: string
  value: number
  target: number
}) {
  const delta = Math.abs(value - target)
  const ok = delta < 0.5
  return (
    <div
      className="rounded p-2"
      style={{ background: 'rgba(27,30,39,0.5)' }}
    >
      <div className="flex justify-between text-[10px] font-mono mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span style={{ color: ok ? '#AAFF00' : '#F97316' }}>
          {value.toFixed(1)}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(42,46,58,0.5)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${ok ? 80 : 50}%`,
            background: ok ? '#AAFF00' : '#F97316',
            boxShadow: ok ? '0 0 6px -1px rgba(170,255,0,0.4)' : 'none',
          }}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Pill
   --------------------------------------------------------------------------- */
function Pill({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
      style={{
        background: 'rgba(18,20,26,0.9)',
        border: '1px solid rgba(42,46,58,0.6)',
        boxShadow: '0 2px 8px -2px rgba(0,0,0,0.4)',
      }}
    >
      <span className="text-rain-accent">{icon}</span>
      {label}
    </div>
  )
}
