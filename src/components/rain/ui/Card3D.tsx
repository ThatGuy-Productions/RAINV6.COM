'use client'

/**
 * Card3D — reusable 3D perspective card with cursor-tracking tilt,
 * parallax glow, sheen sweep, and layered depth (translateZ on content).
 *
 * Performance: uses framer-motion `useMotionValue` + `useSpring` so cursor
 * tracking never triggers a React re-render. The sheen sweep is fired via
 * `useAnimationControls` (imperative `.start()`), avoiding setState in any
 * mouse handler.
 *
 * Accessibility: when `prefers-reduced-motion: reduce` is set, all motion
 * (tilt, glow, sheen, parallax depth) is disabled and the card renders as a
 * flat `rain-panel` surface.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  motion,
  useAnimationControls,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'

export interface Card3DProps {
  /** Card body. Floated at translateZ(40px) above the panel surface. */
  children: ReactNode
  /** Extra classes appended to the default `rain-panel rounded-xl p-6` styling. */
  className?: string
  /** Color of the parallax glow + sheen sweep. Defaults to RAIN lime #AAFF00. */
  glowColor?: string
  /** Max tilt in degrees on each axis. Default 10. */
  intensity?: number
  /** When false, no mouse tracking / tilt / glow. Default true. */
  interactive?: boolean
  /** Optional icon node floated at translateZ(60px) for extra depth pop. */
  icon?: ReactNode
}

const TILT_SPRING = { stiffness: 150, damping: 20, mass: 0.5 }
const HOVER_SPRING = { stiffness: 150, damping: 20 }

export function Card3D({
  children,
  className = '',
  glowColor = '#AAFF00',
  intensity = 10,
  interactive = true,
  icon,
}: Card3DProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [reduced, setReduced] = useState(false)

  // SSR-safe prefers-reduced-motion detection (subscribes to live changes).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const enabled = interactive && !reduced

  // Cursor position as a fraction of the card (0..1), centered at 0.5.
  // Spring-smoothed for buttery tilt tracking.
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  // Hover envelope (0 = idle, 1 = hovered) — drives scale + glow opacity.
  const hover = useMotionValue(0)

  const sx = useSpring(px, TILT_SPRING)
  const sy = useSpring(py, TILT_SPRING)
  const sHover = useSpring(hover, HOVER_SPRING)

  // Cursor offset → rotation in degrees. rotateY follows X, rotateX inverts Y
  // so the card "leans toward" the cursor like a physical surface.
  const rotateY = useTransform(sx, [0, 1], [-intensity, intensity])
  const rotateX = useTransform(sy, [0, 1], [intensity, -intensity])
  const scale = useTransform(sHover, [0, 1], [1, 1.02])

  // Parallax glow position (percentage) for the radial-gradient light blob.
  const glowX = useTransform(sx, (v) => `${(v * 100).toFixed(2)}%`)
  const glowY = useTransform(sy, (v) => `${(v * 100).toFixed(2)}%`)
  // `${glowColor}22` ≈ 13% alpha hex suffix — subtle depth glow.
  const glowBg = useMotionTemplate`radial-gradient(circle at ${glowX} ${glowY}, ${glowColor}22, transparent 60%)`
  const glowOpacity = useTransform(sHover, [0, 1], [0, 1])

  // Sheen sweep — fire a one-shot diagonal sweep on mouse enter.
  // Using useAnimationControls keeps the mouseenter handler free of setState.
  const sheenControls = useAnimationControls()

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!enabled) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }

  function handleMouseEnter() {
    if (!enabled) return
    hover.set(1)
    sheenControls.start({
      x: ['-120%', '220%'],
      transition: { duration: 0.7, ease: [0.4, 0, 0.2, 1] },
    })
  }

  function handleMouseLeave() {
    if (!enabled) return
    hover.set(0)
    // Reset cursor position to center so the next hover enters from neutral.
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`group rain-panel rounded-xl p-6 relative overflow-hidden will-change-transform ${className}`}
      style={{
        transformStyle: 'preserve-3d',
        transformPerspective: 1000,
        rotateX: enabled ? rotateX : 0,
        rotateY: enabled ? rotateY : 0,
        scale: enabled ? scale : 1,
      }}
    >
      {/* Parallax glow — radial light blob that tracks the cursor inside the card.
          Sits at translateZ(0) so preserve-3d sorts it beneath the floated content. */}
      {enabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: glowBg, opacity: glowOpacity }}
        />
      )}

      {/* Sheen sweep — diagonal translucent gradient that sweeps across once on
          mouse enter. Skewed for a premium "light catching an edge" feel. */}
      {enabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -skew-x-12"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${glowColor}1f 50%, transparent 100%)`,
          }}
          initial={{ x: '-120%' }}
          animate={sheenControls}
        />
      )}

      {/* Optional icon — floats at translateZ(60px) for extra pop. */}
      {icon && (
        <div
          className="mb-3"
          style={{ transform: enabled ? 'translateZ(60px)' : undefined }}
        >
          {icon}
        </div>
      )}

      {/* Children — floated at translateZ(40px) above the card surface. The
          wrapper has no `position: relative` so absolute-positioned descendants
          (e.g. corner badges) resolve to the Card3D's `relative` container. */}
      <div style={{ transform: enabled ? 'translateZ(40px)' : undefined }}>
        {children}
      </div>
    </motion.div>
  )
}
