'use client'

import { useEffect, useRef, memo } from 'react'
import { useReducedMotion } from 'framer-motion'
import { audioEngine } from '@/lib/rain/audio-engine'

interface WaveformProps {
  height?: number
  color?: string
  showProgress?: boolean
}

/**
 * Real-time waveform visualizer driven by AnalyserNode.getByteTimeDomainData().
 *
 * V6 3D upgrade: rendered as a glossy ribbon on a perspective-tilted plane
 * with motion-blur depth layering (3 stacked copies), a mirrored ghost
 * reflection below the centerline, and a glowing lime playhead. The canvas
 * stays 2D — the CSS perspective wrapper (perspective(800px) rotateX(35deg))
 * makes the plane recede into the distance like a hardware analyzer display.
 *
 * Reduced-motion: the perspective tilt is dropped (flat) but the depth
 * layering, reflection and glowing playhead are preserved.
 *
 * Wrapped in React.memo — props (height, color, showProgress) are stable
 * across renders, so the component avoids unnecessary re-renders while
 * its internal RAF loop drives the canvas animation.
 */
export const Waveform = memo(function Waveform({ height = 120, color = '#AAFF00', showProgress = true }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const dataRef = useRef<Uint8Array>(new Uint8Array(2048))
  const reduceMotion = !!useReducedMotion()

  useEffect(() => {
    const unsub = audioEngine.subscribe((s) => {
      dataRef.current = s.waveform
    })
    return unsub
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      // Use offsetWidth/offsetHeight (layout size, pre-transform) — the
      // parent has a 3D perspective transform applied, so getBoundingClientRect
      // would return the foreshortened projected size and starve the canvas
      // of device pixels (blurry).
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
      const cy = h / 2

      // Clear with translucent bg for motion-blur trail
      ctx.fillStyle = 'rgba(10, 11, 14, 0.35)'
      ctx.fillRect(0, 0, w, h)

      // Grid (vertical lines)
      ctx.strokeStyle = 'rgba(170, 255, 0, 0.06)'
      ctx.lineWidth = 1
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * w
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // Glossy floor / center line (slightly stronger than the grid)
      ctx.strokeStyle = 'rgba(170, 255, 0, 0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(w, cy)
      ctx.stroke()

      const data = dataRef.current
      const slice = w / data.length

      // --- Mirrored ghost reflection below the centerline ---
      // Faded upside-down copy with reduced amplitude + small vertical offset,
      // simulating a reflection on a glossy floor.
      const reflectGrad = ctx.createLinearGradient(0, cy, 0, h)
      reflectGrad.addColorStop(0, color + '55')
      reflectGrad.addColorStop(1, color + '00')
      ctx.fillStyle = reflectGrad
      ctx.beginPath()
      ctx.moveTo(0, cy)
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        const y = cy - v * h * 0.32 + 3 // mirrored + reduced amplitude + slight gap
        ctx.lineTo(i * slice, y)
      }
      ctx.lineTo(w, cy)
      ctx.closePath()
      ctx.fill()

      // --- Depth layering: 3 stacked copies of the line ---
      // offsets 4, 2, 0 — back-to-front. Back copies are dimmer (motion blur),
      // front copy is brightest with the lime glow.
      const layers = [
        { off: 4, alpha: 0.15, blur: 0 },
        { off: 2, alpha: 0.4, blur: 0 },
        { off: 0, alpha: 1.0, blur: 6 },
      ]
      for (const layer of layers) {
        ctx.globalAlpha = layer.alpha
        ctx.lineWidth = 1.5
        ctx.strokeStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = layer.blur
        ctx.beginPath()
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          const y = cy + v * h * 0.45 + layer.off
          if (i === 0) ctx.moveTo(0, y)
          else ctx.lineTo(i * slice, y)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      // --- Filled gradient band (top edge bright lime → transparent center) ---
      const fillGrad = ctx.createLinearGradient(0, 0, 0, cy)
      fillGrad.addColorStop(0, color + '30')
      fillGrad.addColorStop(1, color + '00')
      ctx.fillStyle = fillGrad
      ctx.beginPath()
      ctx.moveTo(0, cy)
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        const y = cy + v * h * 0.45
        ctx.lineTo(i * slice, y)
      }
      ctx.lineTo(w, cy)
      ctx.closePath()
      ctx.fill()

      // --- Glowing playhead (lime gradient + glowing dot at top) ---
      if (showProgress && audioEngine.duration > 0) {
        const pos = (audioEngine.position / audioEngine.duration) * w
        const phGrad = ctx.createLinearGradient(0, 0, 0, h)
        phGrad.addColorStop(0, color)
        phGrad.addColorStop(0.4, color + 'AA')
        phGrad.addColorStop(1, color + '00')
        ctx.strokeStyle = phGrad
        ctx.lineWidth = 1.5
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(pos, 0)
        ctx.lineTo(pos, h)
        ctx.stroke()
        // Glowing dot at top (rain-pulse style)
        ctx.fillStyle = color
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(pos, 3, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }

      rafRef.current = requestAnimationFrame(render)
    }
    rafRef.current = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [color, showProgress])

  return (
    <div
      className="relative rounded-md overflow-visible"
      style={{
        height,
        boxShadow: '0 0 32px -8px var(--rain-glow), inset 0 0 24px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: reduceMotion ? 'none' : 'perspective(800px) rotateX(35deg)',
          transformOrigin: 'bottom center',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label="Real-time audio waveform"
        />
      </div>
    </div>
  )
})
