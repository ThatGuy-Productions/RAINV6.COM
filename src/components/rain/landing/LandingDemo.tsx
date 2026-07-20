'use client'

/**
 * RAIN V6 — Landing Page Interactive Mastering Demo
 *
 * A pure-visual before/after mastering comparison that demonstrates the
 * product's value without requiring audio playback. Visitors see a waveform
 * transform, LUFS meters improve, spectrum bars balance, and the RAIN Score
 * gauge animate from a "before" state to a polished "after" state.
 *
 * A draggable toggle slider lets visitors scrub between before/after — the
 * whole visualization interpolates in real time. This is the landing page's
 * "show, don't tell" moment.
 *
 * No audio engine dependency — all data is synthetic but realistic (the
 * "before" waveform is quieter/unbalanced, "after" is louder/balanced).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Zap, Gauge, Activity, BarChart3, Sparkles } from 'lucide-react'

// ── Synthetic "before" and "after" data ────────────────────────────────────
// The waveform is a list of amplitude samples (0..1). "Before" is quiet with
// uneven dynamics; "after" is louder with controlled peaks.

const SAMPLE_COUNT = 80

function generateWaveform(seed: number, balanced: boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT
    // Base waveform shape — a song-like envelope
    const envelope = Math.sin(t * Math.PI) * 0.8 + 0.2
    // High-frequency detail
    const detail = Math.sin(i * 0.7 + seed) * 0.3 + Math.sin(i * 1.3 + seed * 2) * 0.15
    // "Before": quieter + more dynamic range (some dips)
    // "After": louder + compressed (more uniform)
    const base = balanced ? 0.82 : 0.48
    const variance = balanced ? 0.12 : 0.35
    const amp = base + detail * variance * envelope
    out.push(Math.max(0.04, Math.min(1, amp)))
  }
  return out
}

const BEFORE_WAVE = generateWaveform(1.5, false)
const AFTER_WAVE = generateWaveform(1.5, true)

// Spectrum bars (24 bands) — "before" is muddy (mids heavy), "after" is balanced
const SPECTRUM_BANDS = 24
function generateSpectrum(balanced: boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < SPECTRUM_BANDS; i++) {
    const freq = i / SPECTRUM_BANDS // 0..1, low→high
    if (balanced) {
      // Balanced: gentle roll-off, full mids + highs
      out.push(0.45 + Math.sin(freq * Math.PI * 1.5) * 0.3 + Math.random() * 0.08)
    } else {
      // Muddy: bass-heavy, scooped mids, rolled-off highs
      const bass = Math.exp(-freq * 4) * 0.7
      const scoop = 1 - Math.exp(-Math.pow((freq - 0.35) * 3, 2))
      out.push(bass + scoop * 0.25 + Math.random() * 0.08)
    }
  }
  return out
}

const BEFORE_SPECTRUM = generateSpectrum(false)
const AFTER_SPECTRUM = generateSpectrum(true)

// Metrics
const BEFORE_METRICS = { lufs: -18.4, truePeak: -3.2, score: 47 }
const AFTER_METRICS = { lufs: -14.0, truePeak: -1.0, score: 92 }

// ── Helper: linear interpolation ────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ── Main component ──────────────────────────────────────────────────────────

export function LandingDemo({ onLaunch }: { onLaunch: () => void }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(sectionRef, { once: true, margin: '-80px' })
  const [t, setT] = useState(0) // 0 = before, 1 = after
  const autoPlayedRef = useRef(false)

  // Auto-play the transition once when scrolled into view.
  useEffect(() => {
    if (!isInView || autoPlayedRef.current) return
    autoPlayedRef.current = true
    const duration = 2200
    const startTime = performance.now()
    let rafId: number
    const animate = (now: number) => {
      const elapsed = now - startTime
      const p = Math.min(elapsed / duration, 1)
      // ease-in-out cubic
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      setT(eased)
      if (p < 1) rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [isInView])

  // Interpolated data
  const wave = useMemo(
    () => BEFORE_WAVE.map((v, i) => lerp(v, AFTER_WAVE[i], t)),
    [t],
  )
  const spectrum = useMemo(
    () => BEFORE_SPECTRUM.map((v, i) => lerp(v, AFTER_SPECTRUM[i], t)),
    [t],
  )
  const metrics = useMemo(
    () => ({
      lufs: lerp(BEFORE_METRICS.lufs, AFTER_METRICS.lufs, t),
      truePeak: lerp(BEFORE_METRICS.truePeak, AFTER_METRICS.truePeak, t),
      score: Math.round(lerp(BEFORE_METRICS.score, AFTER_METRICS.score, t)),
    }),
    [t],
  )

  const isAfter = t > 0.5

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-4 overflow-hidden"
      id="demo"
    >
      {/* Ambient glow background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 50%, rgba(170,255,0,${0.04 + t * 0.06}), transparent 70%)`,
          transition: 'background 0.3s',
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(170,255,0,0.25)] bg-[rgba(170,255,0,0.06)] text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] mb-4">
            <Sparkles className="w-3 h-3" />
            Live Mastering Demo
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Watch a track transform in real time.
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            Drag the slider to see the 16-stage pipeline at work. Waveform, loudness,
            spectrum, and RAIN Score — all improve as mastering is applied.
          </p>
        </div>

        {/* Main demo panel */}
        <div className="rounded-2xl border border-[rgba(170,255,0,0.15)] bg-[rgba(14,16,22,0.6)] backdrop-blur-xl overflow-hidden"
          style={{ boxShadow: '0 24px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(170,255,0,0.04)' }}
        >
          {/* Top bar — before/after labels */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full transition-colors duration-300"
                style={{ backgroundColor: isAfter ? '#AAFF00' : '#F59E0B' }}
              />
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                {isAfter ? 'Mastered' : 'Before Mastering'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60">
              <span className="hidden sm:inline">RAIN ENGINE v6</span>
              <span>48 kHz · 24-bit</span>
            </div>
          </div>

          {/* Visualization grid */}
          <div className="grid md:grid-cols-2 gap-px bg-white/[0.04]">
            {/* Waveform panel */}
            <div className="bg-[rgba(14,16,22,0.4)] p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Activity className="w-3 h-3 text-[#AAFF00]/70" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Waveform
                </span>
              </div>
              <WaveformBars values={wave} color={isAfter ? '#AAFF00' : '#F59E0B'} />
            </div>

            {/* Spectrum panel */}
            <div className="bg-[rgba(14,16,22,0.4)] p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <BarChart3 className="w-3 h-3 text-[#AAFF00]/70" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Spectrum
                </span>
              </div>
              <SpectrumBars values={spectrum} t={t} />
            </div>

            {/* LUFS meters */}
            <div className="bg-[rgba(14,16,22,0.4)] p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Gauge className="w-3 h-3 text-[#AAFF00]/70" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Loudness
                </span>
              </div>
              <div className="space-y-3">
                <MeterRow
                  label="LUFS"
                  value={metrics.lufs.toFixed(1)}
                  target="-14.0"
                  min={-24}
                  max={-6}
                  current={metrics.lufs}
                  color={isAfter ? '#AAFF00' : '#F59E0B'}
                />
                <MeterRow
                  label="True Peak"
                  value={metrics.truePeak.toFixed(1) + ' dB'}
                  target="-1.0"
                  min={-6}
                  max={0}
                  current={metrics.truePeak}
                  color={isAfter ? '#10B981' : '#F97316'}
                />
              </div>
            </div>

            {/* RAIN Score gauge */}
            <div className="bg-[rgba(14,16,22,0.4)] p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Zap className="w-3 h-3 text-[#AAFF00]/70" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  RAIN Score
                </span>
              </div>
              <ScoreGauge score={metrics.score} t={t} />
            </div>
          </div>

          {/* Slider control */}
          <div className="px-5 py-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-12">
                Before
              </span>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={t}
                  onChange={(e) => setT(parseFloat(e.target.value))}
                  className="rain-demo-slider w-full"
                  aria-label="Mastering before/after toggle"
                />
                {/* Track overlay */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full bg-white/[0.08] pointer-events-none">
                  <div
                    className="h-full rounded-full transition-none"
                    style={{
                      width: `${t * 100}%`,
                      background: 'linear-gradient(90deg, #F59E0B, #AAFF00)',
                    }}
                  />
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] w-12 text-right">
                After
              </span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-8">
          <button
            onClick={onLaunch}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-95 transition-all"
          >
            Try it with your own track
            <ArrowRight className="w-4 h-4" />
          </button>
          <p className="mt-3 text-[11px] text-muted-foreground">
            No upload required — the demo track loads instantly in the studio.
          </p>
        </div>
      </div>

      {/* Slider styling */}
      <style jsx>{`
        .rain-demo-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 24px;
          background: transparent;
          cursor: pointer;
          position: relative;
          z-index: 2;
        }
        .rain-demo-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #aaff00;
          box-shadow: 0 0 12px rgba(170, 255, 0, 0.5);
          cursor: grab;
          transition: transform 0.15s;
        }
        .rain-demo-slider::-webkit-slider-thumb:active {
          cursor: grabbing;
          transform: scale(1.15);
        }
        .rain-demo-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #aaff00;
          box-shadow: 0 0 12px rgba(170, 255, 0, 0.5);
          cursor: grab;
        }
      `}</style>
    </section>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function WaveformBars({ values, color }: { values: number[]; color: string }) {
  return (
    <div className="flex items-center justify-between gap-px h-20">
      {values.map((v, i) => (
        <motion.div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${v * 100}%`,
            background: color,
            opacity: 0.4 + v * 0.6,
            boxShadow: v > 0.7 ? `0 0 4px ${color}80` : 'none',
          }}
          transition={{ duration: 0.15 }}
        />
      ))}
    </div>
  )
}

function SpectrumBars({ values, t }: { values: number[]; t: number }) {
  const after = t > 0.5
  return (
    <div className="flex items-end justify-between gap-px h-20">
      {values.map((v, i) => {
        // Color gradient: lows = orange, mids = yellow, highs = lime
        const freq = i / values.length
        const hue = lerp(25, 80, freq) // orange → lime
        const sat = 90
        const light = after ? 55 : 45
        return (
          <motion.div
            key={i}
            className="flex-1 rounded-t-sm transition-all duration-150"
            style={{
              height: `${v * 100}%`,
              background: `hsl(${hue}, ${sat}%, ${light}%)`,
              opacity: 0.5 + v * 0.5,
            }}
          />
        )
      })}
    </div>
  )
}

function MeterRow({
  label,
  value,
  target,
  min,
  max,
  current,
  color,
}: {
  label: string
  value: string
  target: string
  min: number
  max: number
  current: number
  color: string
}) {
  const pct = Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100))
  const targetPct = ((parseFloat(target) - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
        <span className="text-[11px] font-mono font-bold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}40, ${color})`,
          }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 h-full w-px bg-white/40"
          style={{ left: `${targetPct}%` }}
        />
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">
        target: {target}
      </div>
    </div>
  )
}

function ScoreGauge({ score, t }: { score: number; t: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * 0.75 // 270° arc
  const dashOffset = arcLength - (score / 100) * arcLength
  const color = score >= 90 ? '#AAFF00' : score >= 75 ? '#84CC16' : score >= 60 ? '#F97316' : '#EF4444'

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg className="w-full h-full -rotate-[135deg]" viewBox="0 0 120 120">
          {/* Track */}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          {/* Progress */}
          <motion.circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={dashOffset}
            style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
            transition={{ duration: 0.15 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold font-mono" style={{ color }}>
            {score}
          </span>
          <span className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground/60">
            / 100
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        <ScoreRow label="Spotify" val={Math.round(lerp(40, 94, t))} color="#AAFF00" />
        <ScoreRow label="Apple" val={Math.round(lerp(38, 90, t))} color="#00D4FF" />
        <ScoreRow label="YouTube" val={Math.round(lerp(42, 96, t))} color="#F97316" />
        <ScoreRow label="Tidal" val={Math.round(lerp(35, 88, t))} color="#8B5CF6" />
      </div>
    </div>
  )
}

function ScoreRow({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-muted-foreground w-14">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{ width: `${val}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-mono font-bold w-6 text-right" style={{ color }}>
        {val}
      </span>
    </div>
  )
}
