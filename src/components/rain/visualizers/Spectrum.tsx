'use client'

import { useEffect, useRef, useState, memo } from 'react'
import { useReducedMotion } from 'framer-motion'
import { audioEngine } from '@/lib/rain/audio-engine'
import { computeSpectralFeatures } from '@/lib/rain/dsp'

interface SpectrumProps {
  height?: number
  /** Frequency range: 'wide' (20Hz-20kHz log) or 'bass' (20-250Hz linear) */
  mode?: 'wide' | 'bass'
  /**
   * P2-METERS: when true, the spectrum renders numeric readouts for the
   * FFT-derived spectral descriptors (centroid, rolloff 85%, rolloff 95%,
   * flatness, flux) computed from the LIVE analyser byte data. Updated at
   * ~10 Hz (every 6th RAF frame) to avoid burning CPU on the 60 Hz canvas
   * redraw path.
   */
  showReadouts?: boolean
}

// ---------------------------------------------------------------------------
// Color helpers — parse #RRGGBB (or #RGB) and mix with white / black to
// derive the lit "top face" and shadowed "right face" shades for each bar.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const num = parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

/** Mix toward white by `amt` (0..1). */
function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
}

/** Mix toward black by `amt` (0..1). */
function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt))
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const FREQ_LABELS = [
  { hz: 30, label: '30' },
  { hz: 100, label: '100' },
  { hz: 300, label: '300' },
  { hz: 1000, label: '1k' },
  { hz: 3000, label: '3k' },
  { hz: 8000, label: '8k' },
  { hz: 16000, label: '16k' },
] as const

/**
 * Real-time FFT spectrum analyzer rendered as 64 (wide) or 32 (bass)
 * frequency bars on a logarithmic scale.
 *
 * V6 3D upgrade: each bar is drawn as a 3D extruded column with front (base
 * color + glow), top (lightened parallelogram — the "lid") and right side
 * (darkened parallelogram — the depth) faces. A mirrored gradient reflection
 * is rendered below each bar on a glossy floor, and a floating 3D peak-hold
 * cap with drop shadow tracks the bar's recent maximum. The whole canvas is
 * wrapped in a `perspective(800px) rotateX(35deg)` plane so the bars appear
 * to stand on a receding glossy surface like a high-end hardware analyzer.
 *
 * Frequency labels are rendered OUTSIDE the tilted canvas (sibling div below
 * the perspective wrapper) so they remain readable.
 *
 * Reduced-motion: the perspective tilt is dropped (flat) but the 3D extruded
 * bars, reflection and peak-hold caps are preserved.
 */
export const Spectrum = memo(function Spectrum({ height = 140, mode = 'wide', showReadouts = false }: SpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const rafReadoutsRef = useRef<number | null>(null)
  const dataRef = useRef<Uint8Array>(new Uint8Array(1024))
  // Per-bar peak-hold state (decays each frame, snaps up on new max).
  const peaksRef = useRef<Float32Array>(new Float32Array(64))
  // P2-METERS: previous-spectrum buffer for spectral flux computation.
  // Held as a Float32Array of dB values (length 1024 = analyser frequencyBinCount).
  const prevSpectrumRef = useRef<Float32Array | null>(null)
  // P2-METERS: throttled state for the numeric readouts (~10 Hz updates).
  const [readouts, setReadouts] = useState<{
    centroid: number
    rolloff85: number
    rolloff95: number
    flatness: number
    flux: number
  } | null>(null)
  const reduceMotion = !!useReducedMotion()

  useEffect(() => {
    const unsub = audioEngine.subscribe((s) => {
      dataRef.current = s.spectrum
    })
    return unsub
  }, [])

  // P2-METERS — separate effect for the numeric readouts. Runs at ~10 Hz to
  // avoid burning CPU on the 60 Hz canvas redraw path. Computes the full set
  // of FFT-derived spectral descriptors from the LIVE analyser byte data.
  useEffect(() => {
    if (!showReadouts) return
    let frameCount = 0
    const tick = () => {
      frameCount++
      // Update every 6th frame (~10 Hz at 60 fps).
      if (frameCount % 6 === 0) {
        const byteData = dataRef.current
        if (byteData && byteData.length > 0) {
          // Convert the Uint8 byte spectrum back to a dB Float32Array.
          // AnalyserNode defaults: minDecibels = -100, maxDecibels = -30.
          // The byte value 0 maps to minDecibels, 255 maps to maxDecibels.
          const minDb = -100
          const maxDb = -30
          const range = maxDb - minDb
          const N = byteData.length
          const dbSpectrum = new Float32Array(N)
          for (let i = 0; i < N; i++) {
            dbSpectrum[i] = (byteData[i] / 255) * range + minDb
          }
          // Sample rate: AudioContext.sampleRate (48 kHz default in RAIN).
          // fftSize = 2048, so spectrum length = 1024 = N. binHz = sr / fftSize.
          const sr = 48000
          const features = computeSpectralFeatures(dbSpectrum, sr, prevSpectrumRef.current)
          prevSpectrumRef.current = dbSpectrum
          setReadouts({
            centroid: features.centroid,
            rolloff85: features.rolloff85,
            rolloff95: features.rolloff95,
            flatness: features.flatness,
            flux: features.flux,
          })
        }
      }
      rafReadoutsRef.current = requestAnimationFrame(tick)
    }
    rafReadoutsRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafReadoutsRef.current) cancelAnimationFrame(rafReadoutsRef.current)
    }
  }, [showReadouts])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      // Use layout size (offsetWidth/Height) — the parent is 3D-transformed,
      // so getBoundingClientRect would return the foreshortened projected
      // size and starve the canvas of device pixels (blurry).
      const w = canvas.offsetWidth || 1
      const h = canvas.offsetHeight || 1
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = () => {
      const w = canvas.offsetWidth || 1
      const h = canvas.offsetHeight || 1
      // Translucent dark clear
      ctx.fillStyle = 'rgba(10, 11, 14, 0.55)'
      ctx.fillRect(0, 0, w, h)

      const data = dataRef.current
      const numBars = mode === 'wide' ? 64 : 32
      const barWidth = w / numBars
      const gap = Math.max(1, barWidth * 0.18)
      const depth = 6 // 3D extrusion depth (px)

      // Reserve the bottom ~22% of the canvas for the reflection area.
      const floorY = Math.floor(h * 0.78)
      const maxBarH = floorY - 4
      const peaks = peaksRef.current

      // --- Glossy floor line (lime, 1px, low opacity) + reflection band ---
      const floorGrad = ctx.createLinearGradient(0, floorY, 0, h)
      floorGrad.addColorStop(0, 'rgba(170, 255, 0, 0.06)')
      floorGrad.addColorStop(1, 'rgba(170, 255, 0, 0)')
      ctx.fillStyle = floorGrad
      ctx.fillRect(0, floorY, w, h - floorY)
      ctx.strokeStyle = 'rgba(170, 255, 0, 0.28)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, floorY)
      ctx.lineTo(w, floorY)
      ctx.stroke()

      // --- Bars (3D extruded columns) ---
      for (let i = 0; i < numBars; i++) {
        // Log-scale bin mapping (wide) or linear (bass)
        let bin: number
        if (mode === 'wide') {
          const minBin = 2
          const maxBin = Math.min(data.length - 1, 512)
          const ratio = i / numBars
          bin = Math.floor(minBin * Math.pow(maxBin / minBin, ratio))
        } else {
          bin = Math.floor(2 + (i / numBars) * 32)
        }
        const value = data[bin] / 255
        const barHeight = Math.max(2, value * maxBarH)

        // Peak-hold update (snap up, decay down ~1.2px/frame ≈ 72px/s @ 60fps)
        if (barHeight > peaks[i]) {
          peaks[i] = barHeight
        } else {
          peaks[i] = Math.max(barHeight, peaks[i] - 1.2)
        }
        const peakH = peaks[i]

        // Color zones (preserved from V5)
        let color: string
        if (mode === 'bass') {
          color = '#F97316'
        } else if (i < numBars * 0.15) {
          color = '#EF4444' // sub/bass
        } else if (i < numBars * 0.4) {
          color = '#F97316' // low mids
        } else if (i < numBars * 0.7) {
          color = '#AAFF00' // mids/highs
        } else {
          color = '#00D4FF' // air
        }
        const frontColor = color
        const topColor = lighten(color, 0.2)
        const sideColor = darken(color, 0.3)

        const x = i * barWidth + gap / 2
        const bw = barWidth - gap
        const y = floorY - barHeight
        // Isometric-ish extrusion skew: back edge is up-and-right by (dx, dy).
        const dx = depth * 0.7
        const dy = -depth * 0.7

        // --- Reflection (mirrored gradient fading to transparent) ---
        const reflectH = Math.min(barHeight * 0.4, h - floorY - 1)
        if (reflectH > 1) {
          const reflectGrad = ctx.createLinearGradient(0, floorY, 0, floorY + reflectH)
          reflectGrad.addColorStop(0, withAlpha(color, 0.35))
          reflectGrad.addColorStop(1, withAlpha(color, 0))
          ctx.fillStyle = reflectGrad
          ctx.fillRect(x, floorY, bw, reflectH)
        }

        // --- Right side face (darker — drawn first so the front overlaps) ---
        ctx.fillStyle = sideColor
        ctx.beginPath()
        ctx.moveTo(x + bw, y)
        ctx.lineTo(x + bw + dx, y + dy)
        ctx.lineTo(x + bw + dx, floorY + dy)
        ctx.lineTo(x + bw, floorY)
        ctx.closePath()
        ctx.fill()

        // --- Top face (lighter parallelogram — the lid viewed from above) ---
        ctx.fillStyle = topColor
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + bw, y)
        ctx.lineTo(x + bw + dx, y + dy)
        ctx.lineTo(x + dx, y + dy)
        ctx.closePath()
        ctx.fill()

        // --- Front face (brightest, with glow) ---
        ctx.shadowColor = frontColor
        ctx.shadowBlur = 8
        ctx.fillStyle = frontColor
        ctx.fillRect(x, y, bw, barHeight)
        ctx.shadowBlur = 0

        // --- Peak-hold cap (floating 3D cap above the bar) ---
        const peakY = floorY - peakH
        const capH = 2.5
        const capDx = depth * 0.5
        const capDy = -depth * 0.5
        // Drop shadow (offset by +1px, +1px, semi-transparent black)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(x + 1, peakY - capH + 1, bw, capH)
        // Top face of the cap
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.beginPath()
        ctx.moveTo(x, peakY - capH)
        ctx.lineTo(x + bw, peakY - capH)
        ctx.lineTo(x + bw + capDx, peakY - capH + capDy)
        ctx.lineTo(x + capDx, peakY + capDy)
        ctx.closePath()
        ctx.fill()
        // Front face of the cap
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.fillRect(x, peakY - capH, bw, capH)
      }

      rafRef.current = requestAnimationFrame(render)
    }
    rafRef.current = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [mode])

  // Extra wrapper height reserves a strip for the frequency labels so they
  // can sit OUTSIDE the perspective-tilted canvas and remain readable.
  const labelStrip = mode === 'wide' ? 16 : 0

  // P2-METERS: format helpers for the numeric readouts.
  const fmtHz = (hz: number) => {
    if (!Number.isFinite(hz) || hz <= 0) return '—'
    if (hz >= 1000) return `${(hz / 1000).toFixed(2)}k`
    return `${Math.round(hz)}`
  }
  const fmtFlat = (f: number) => {
    if (!Number.isFinite(f) || f <= 0) return '—'
    return f.toFixed(3)
  }
  const fmtFlux = (f: number) => {
    if (!Number.isFinite(f) || f <= 0) return '0'
    // Flux uses linear power differences — typically tiny values.
    return f.toExponential(2)
  }

  return (
    <div className="space-y-1">
      <div
        className="relative rounded-md overflow-visible"
        style={{
          height: height + labelStrip,
          boxShadow: '0 0 32px -8px var(--rain-glow), inset 0 0 24px rgba(0,0,0,0.4)',
        }}
      >
        <div
          className="absolute left-0 right-0 top-0"
          style={{
            height,
            transform: reduceMotion ? 'none' : 'perspective(800px) rotateX(35deg)',
            transformOrigin: 'bottom center',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%' }}
            role="img"
            aria-label="Real-time frequency spectrum"
          />
        </div>
        {mode === 'wide' && (
          <div className="absolute left-0 right-0 bottom-0 h-4 pointer-events-none">
            {FREQ_LABELS.map((l) => {
              // Same log-scale mapping the bars use (20Hz..20kHz).
              const ratio = Math.log(l.hz / 20) / Math.log(20000 / 20)
              return (
                <span
                  key={l.hz}
                  className="absolute -translate-x-1/2 text-[9px] font-mono uppercase tracking-wider text-rain-accent/50 leading-4 whitespace-nowrap"
                  style={{ left: `${ratio * 100}%` }}
                >
                  {l.label}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* P2-METERS — REAL FFT-derived numeric readouts, updated at ~10 Hz. */}
      {showReadouts && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
          <span className="text-muted-foreground/60 uppercase tracking-wider">Spectral</span>
          <Readout label="Centroid" value={readouts ? `${fmtHz(readouts.centroid)} Hz` : '—'} />
          <Readout label="R85" value={readouts ? `${fmtHz(readouts.rolloff85)} Hz` : '—'} />
          <Readout label="R95" value={readouts ? `${fmtHz(readouts.rolloff95)} Hz` : '—'} />
          <Readout label="Flat" value={readouts ? fmtFlat(readouts.flatness) : '—'} />
          <Readout label="Flux" value={readouts ? fmtFlux(readouts.flux) : '—'} />
        </div>
      )}
    </div>
  )
})

/** Compact label/value readout for the spectral descriptors strip. */
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="text-rain-accent font-bold tabular-nums">{value}</span>
    </span>
  )
}
