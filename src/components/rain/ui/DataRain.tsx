'use client'

import { useEffect, useRef } from 'react'

interface DataRainProps {
  /** Opacity of the whole rain layer (0–1). Default 0.55 */
  opacity?: number
  /** Tailwind/CSS color for the leading character. Default '#AAFF00' (lime). */
  color?: string
  /** Secondary (trailing) color. Default 'rgba(170,255,0,0.35)' */
  trailColor?: string
  /** Font size in px. Default 14 */
  fontSize?: number
  /** Rain density — column width in px (smaller = denser). Default 18 */
  columnWidth?: number
  /** Fall speed multiplier. Default 1 */
  speed?: number
  /** Character set to draw. Defaults to a katakana + hex + symbol mix. */
  charset?: string
  /** Extra className for the wrapper. */
  className?: string
  /** Fixed pixel height; if omitted, canvas fills its parent. */
  height?: number
}

const DEFAULT_CHARSET =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF░▒▓<>/\\|=+-*'
const GLYPH_POOL = DEFAULT_CHARSET.split('')

/**
 * DataRain — Matrix-style falling-code canvas background.
 *
 * Renders a single <canvas> that fills its parent. Each column drops a stream
 * of random glyphs; the leading glyph is bright, trailing glyphs fade out.
 * Subtle lime palette matches the RAIN V6 design language.
 *
 * Performance: one canvas, one rAF loop, devicePixelRatio-aware, pauses when
 * tab is hidden, caps at 60fps.
 */
export function DataRain({
  opacity = 0.55,
  color = '#AAFF00',
  trailColor = 'rgba(170,255,0,0.35)',
  fontSize = 14,
  columnWidth = 18,
  speed = 1,
  charset,
  className = '',
  height,
}: DataRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const dropsRef = useRef<number[]>([])
  const lastTickRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const pool = (charset ?? DEFAULT_CHARSET).split('')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, height ?? rect.height)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // (Re)build drops array — one Y position per column
      const cols = Math.max(1, Math.floor(w / columnWidth))
      dropsRef.current = Array.from({ length: cols }, () =>
        Math.floor((Math.random() * h) / fontSize),
      )
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = (now: number) => {
      // Throttle to ~30fps for the rain to keep it cheap
      if (now - lastTickRef.current < 33) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      lastTickRef.current = now

      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = height ?? rect.height

      // Translucent black fill creates the trailing fade effect
      ctx.fillStyle = 'rgba(10, 11, 14, 0.12)'
      ctx.fillRect(0, 0, w, h)

      ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`
      ctx.textBaseline = 'top'

      const drops = dropsRef.current
      for (let i = 0; i < drops.length; i++) {
        const x = i * columnWidth
        const y = drops[i] * fontSize

        // Leading glyph — bright
        const lead = pool[Math.floor(Math.random() * pool.length)]
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 6
        ctx.fillText(lead, x, y)

        // Trail glyph — dimmer, no shadow
        ctx.shadowBlur = 0
        const trail = pool[Math.floor(Math.random() * pool.length)]
        ctx.fillStyle = trailColor
        ctx.fillText(trail, x, y - fontSize)

        // Advance drop; reset to top occasionally for varied cadence
        if (y > h && Math.random() > 0.975) {
          drops[i] = Math.floor(Math.random() * -10)
        }
        drops[i] += speed
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    // Pause when tab hidden — saves CPU
    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      } else if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [color, trailColor, fontSize, columnWidth, speed, charset, height])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none ${className}`}
      style={{
        width: '100%',
        height: height ? `${height}px` : '100%',
        opacity,
        display: 'block',
      }}
    />
  )
}

/**
 * Glyph pool re-export for callers that want to customize.
 */
export const RAIN_GLYPHS = GLYPH_POOL
