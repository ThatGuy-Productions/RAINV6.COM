'use client'

import { useEffect, useRef, useCallback } from 'react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'
import { LUFS_SCALE } from '@/lib/rain/constants'
import { kWeight } from '@/lib/rain/dsp'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LufsHistoryGraphProps {
  height?: number
}

interface LufsDataPoint {
  time: number   // seconds from start
  lufs: number   // short-term LUFS value
}

// ---------------------------------------------------------------------------
// Short-term LUFS computation (400ms blocks, 75% overlap, no gating)
// Returns raw per-block LUFS values for graphing purposes — gating would
// remove silent segments and misrepresent the time axis.
// ---------------------------------------------------------------------------

function computeShortTermLufs(
  channels: Float32Array[],
  sampleRate: number,
): LufsDataPoint[] {
  const blockSize = Math.floor(sampleRate * 0.4)   // 400 ms
  const hopSize = Math.floor(blockSize * 0.25)     // 75% overlap
  const channelWeights = [1.0, 1.0, 1.0, 1.0, 1.41]
  const totalLength = channels[0].length

  // K-weight each channel once
  const weighted: Float32Array[] = channels.map((c) => kWeight(c, sampleRate))

  const points: LufsDataPoint[] = []

  for (let start = 0; start + blockSize <= totalLength; start += hopSize) {
    let sum = 0
    for (let ch = 0; ch < weighted.length; ch++) {
      const w = channelWeights[ch] ?? 1.0
      let s = 0
      const buf = weighted[ch]
      for (let i = start; i < start + blockSize; i++) {
        s += buf[i] * buf[i]
      }
      sum += w * (s / blockSize)
    }
    const lufs = sum > 0 ? -0.691 + 10 * Math.log10(sum) : -70
    const time = (start + blockSize / 2) / sampleRate  // center of window
    points.push({ time, lufs: Math.max(LUFS_SCALE.min, Math.min(LUFS_SCALE.max, lufs)) })
  }

  return points
}

// ---------------------------------------------------------------------------
// Reference targets to draw on the graph
// ---------------------------------------------------------------------------

const REFERENCE_TARGETS = [
  { label: 'Spotify', value: -14, color: '#10B981' },
  { label: 'Apple', value: -16, color: '#06B6D4' },
  { label: 'EBU R128', value: -23, color: '#64748B' },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LufsHistoryGraph({ height = 120 }: LufsHistoryGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lufsDataRef = useRef<LufsDataPoint[]>([])
  const engineStateRef = useRef({ position: 0, duration: 0, isPlaying: false })

  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const fileDuration = useSessionStore((s) => s.fileDuration)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)

  // -----------------------------------------------------------------------
  // Compute short-term LUFS from processed buffer (once per render)
  // -----------------------------------------------------------------------
  const computeData = useCallback(() => {
    const channels = audioEngine.getProcessedChannels()
    const sr = audioEngine.inputSampleRate
    if (!channels || sr === 0) {
      lufsDataRef.current = []
      return
    }
    lufsDataRef.current = computeShortTermLufs(channels, sr)
  }, [])

  // Compute data when output analysis changes (i.e. after render)
  useEffect(() => {
    if (hasProcessed && outputAnalysis) {
      computeData()
    } else {
      lufsDataRef.current = []
    }
  }, [hasProcessed, outputAnalysis, computeData])

  // -----------------------------------------------------------------------
  // Subscribe to engine state for playhead
  // -----------------------------------------------------------------------
  useEffect(() => {
    const unsub = audioEngine.subscribe((s) => {
      engineStateRef.current = {
        position: s.position,
        duration: s.duration,
        isPlaying: s.isPlaying,
      }
    })
    return unsub
  }, [])

  // -----------------------------------------------------------------------
  // Canvas render loop
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const data = lufsDataRef.current
      const dur = fileDuration || engineStateRef.current.duration
      const minY = LUFS_SCALE.min  // -36
      const maxY = LUFS_SCALE.max  // 0
      const range = maxY - minY     // 36

      // -- Clear --
      ctx.fillStyle = 'rgba(10, 11, 14, 1)'
      ctx.fillRect(0, 0, w, h)

      // -- Empty state --
      if (data.length === 0 || dur === 0) {
        ctx.fillStyle = 'rgba(170, 255, 0, 0.25)'
        ctx.font = '11px ui-monospace, SFMono-Regular, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Load audio to view LUFS history', w / 2, h / 2)
        rafRef.current = requestAnimationFrame(render)
        return
      }

      // -- Subtle grid lines (horizontal at 6 LU intervals) --
      ctx.strokeStyle = 'rgba(170, 255, 0, 0.06)'
      ctx.lineWidth = 1
      for (let lufs = minY; lufs <= maxY; lufs += 6) {
        const y = h - ((lufs - minY) / range) * h
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // -- Vertical time grid lines --
      const timeStep = dur > 120 ? 30 : dur > 30 ? 10 : dur > 10 ? 5 : 2
      ctx.fillStyle = 'rgba(170, 255, 0, 0.2)'
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let t = timeStep; t < dur; t += timeStep) {
        const x = (t / dur) * w
        ctx.strokeStyle = 'rgba(170, 255, 0, 0.06)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
        // Time label
        const mins = Math.floor(t / 60)
        const secs = Math.floor(t % 60)
        const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`
        ctx.fillText(label, x, h - 14)
      }

      // -- Y-axis labels --
      ctx.fillStyle = 'rgba(170, 255, 0, 0.25)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
      for (let lufs = minY; lufs <= maxY; lufs += 12) {
        const y = h - ((lufs - minY) / range) * h
        ctx.fillText(`${lufs}`, 3, y)
      }

      // -- Reference target lines --
      for (const ref of REFERENCE_TARGETS) {
        const y = h - ((ref.value - minY) / range) * h
        // Dashed line
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = ref.color + '55'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
        ctx.setLineDash([])
        // Label at right
        ctx.fillStyle = ref.color + '99'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
        ctx.fillText(`${ref.label} ${ref.value}`, w - 4, y - 2)
      }

      // -- LUFS line + fill --
      // Map data points to canvas coordinates
      const points: { x: number; y: number }[] = data.map((d) => ({
        x: (d.time / dur) * w,
        y: h - ((d.lufs - minY) / range) * h,
      }))

      if (points.length > 1) {
        // Fill gradient below line
        const gradient = ctx.createLinearGradient(0, 0, 0, h)
        gradient.addColorStop(0, 'rgba(170, 255, 0, 0.15)')
        gradient.addColorStop(1, 'rgba(170, 255, 0, 0.0)')

        ctx.beginPath()
        ctx.moveTo(points[0].x, h)
        for (const p of points) ctx.lineTo(p.x, p.y)
        ctx.lineTo(points[points.length - 1].x, h)
        ctx.closePath()
        ctx.fillStyle = gradient
        ctx.fill()

        // Line with glow
        ctx.shadowColor = '#AAFF00'
        ctx.shadowBlur = 8
        ctx.strokeStyle = '#AAFF00'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // -- Playhead --
      const pos = engineStateRef.current.position
      if (dur > 0 && pos >= 0 && pos <= dur) {
        const px = (pos / dur) * w
        // Glow line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.lineWidth = 1
        ctx.shadowColor = 'rgba(255, 255, 255, 0.4)'
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, h)
        ctx.stroke()
        ctx.shadowBlur = 0

        // Time label at playhead
        const pMins = Math.floor(pos / 60)
        const pSecs = (pos % 60).toFixed(1)
        const posLabel = pMins > 0 ? `${pMins}:${Number(pSecs) < 10 ? '0' : ''}${pSecs}` : `${pSecs}s`
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
        const labelX = Math.min(Math.max(px, 30), w - 30)
        ctx.fillText(posLabel, labelX, 2)
      }

      // -- Bottom edge border --
      ctx.strokeStyle = 'rgba(170, 255, 0, 0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h - 0.5)
      ctx.lineTo(w, h - 0.5)
      ctx.stroke()

      rafRef.current = requestAnimationFrame(render)
    }
    rafRef.current = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [fileDuration])

  return (
    <div className="w-full">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
        LUFS History
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        className="rounded-md"
        role="img"
        aria-label="LUFS loudness history over time"
      />
    </div>
  )
}
