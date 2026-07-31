'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface MacroKnobProps {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  color?: string
  size?: number
  unit?: string
  description?: string
  /** DSP sub-parameters this macro controls (from MACROS constant) */
  subParams?: string[]
  /** Default value for delta computation */
  defaultValue?: number
}

/**
 * Delta color logic:
 *  - green (#10B981): at default (delta ≈ 0)
 *  - lime (#AAFF00): slight change (|delta| ≤ 2)
 *  - orange (#F97316): significant change (|delta| > 2)
 */
function deltaColor(delta: number): string {
  const abs = Math.abs(delta)
  if (abs < 0.05) return '#10B981' // green — at default
  if (abs <= 2) return '#AAFF00'   // lime — slight
  return '#F97316'                  // orange — significant
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '−'
  return `${sign}${Math.abs(delta).toFixed(1)}`
}

/**
 * SVG rotary knob with hover tooltip showing DSP parameter info.
 * Vertical drag to change value (drag up = increase).
 * Matches the original RAIN V6 MacroKnob design with arc + indicator.
 */
export function MacroKnob({
  label,
  value,
  min = 0,
  max = 10,
  onChange,
  color = '#AAFF00',
  size = 76,
  unit = '',
  description,
  subParams,
  defaultValue,
}: MacroKnobProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const dragStateRef = useRef<{ startY: number; startValue: number } | null>(null)

  const half = size / 2
  const radius = half - 4
  const normalized = (value - min) / (max - min)
  const angle = -135 + normalized * 270 // -135deg to +135deg
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - normalized * circumference * 0.75

  // Delta from default
  const defaultVal = defaultValue ?? (min + max) / 2
  const delta = value - defaultVal
  const dColor = deltaColor(delta)

  // AUDIT2-4 FIX: mousemove/mouseup listeners live in a useEffect keyed on
  // isDragging. If the component unmounts mid-drag (tab switch, render start),
  // the cleanup runs and removes the listeners — previously they leaked forever.
  useEffect(() => {
    if (!isDragging) return
    const handleMove = (ev: MouseEvent) => {
      if (!dragStateRef.current) return
      const delta = (dragStateRef.current.startY - ev.clientY) / 150
      const newVal = Math.round((dragStateRef.current.startValue + delta * (max - min)) * 10) / 10
      onChange(Math.min(max, Math.max(min, newVal)))
    }
    const handleUp = () => {
      setIsDragging(false)
      dragStateRef.current = null
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, min, max, onChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStateRef.current = { startY: e.clientY, startValue: value }
    setIsDragging(true)
  }, [value])

  // AUDIT2-5 FIX: WAI-ARIA slider requires arrow-key support.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        delta = e.shiftKey ? 1 : 0.5
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        delta = e.shiftKey ? -1 : -0.5
        break
      case 'PageUp':
        delta = 2
        break
      case 'PageDown':
        delta = -2
        break
      case 'Home':
        e.preventDefault()
        onChange(min)
        return
      case 'End':
        e.preventDefault()
        onChange(max)
        return
      default:
        return
    }
    e.preventDefault()
    const newVal = Math.round((value + delta) * 10) / 10
    onChange(Math.min(max, Math.max(min, newVal)))
  }, [value, min, max, onChange])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -Math.sign(e.deltaY) * 0.2
    const newVal = Math.round((value + delta) * 10) / 10
    onChange(Math.min(max, Math.max(min, newVal)))
  }, [value, min, max, onChange])

  const handleDoubleClick = useCallback(() => {
    // AUDIT-M4 FIX: previously reset to (min+max)/2 = 5.0 always, ignoring
    // the defaultValue prop. Macro defaults are NOT all 5.0 (repair=0, warmth=2.5,
    // space=3.0, glue=6.0) so double-click reset was putting knobs in the wrong
    // place. Reset to the actual default.
    onChange(defaultVal)
  }, [defaultVal, onChange])

  // Knob SVG (shared between trigger and non-tooltip mode)
  const knobSvg = (
    <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
      {/* Track */}
      <circle
        cx={half} cy={half} r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="3"
        strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
        strokeDashoffset={circumference * 0.125}
        strokeLinecap="round"
        transform={`rotate(135 ${half} ${half})`}
      />
      {/* Value arc */}
      <circle
        cx={half} cy={half} r={radius}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(135 ${half} ${half})`}
        style={{
          filter: `drop-shadow(0 0 6px ${color})`,
          transition: isDragging ? 'none' : 'stroke-dashoffset 0.15s ease',
        }}
      />
      {/* Knob body */}
      <circle
        cx={half} cy={half} r={radius - 6}
        fill="rgba(20, 22, 30, 0.95)"
        stroke={isHovered ? `${color}40` : 'rgba(255,255,255,0.06)'}
        strokeWidth={isHovered ? 1.5 : 1}
        style={{ transition: 'stroke 0.15s ease' }}
      />
      {/* Indicator line */}
      <line
        x1={half}
        y1={half - (radius - 8)}
        x2={half}
        y2={half - (radius - 18)}
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        transform={`rotate(${angle} ${half} ${half})`}
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  )

  // Tooltip content with DSP info
  const tooltipContent = (
    <div className="min-w-[180px] space-y-2">
      {/* Header: name + value */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono font-bold text-xs tracking-wider" style={{ color }}>
          {label}
        </span>
        <span className="font-mono font-bold text-xs tabular-nums" style={{ color }}>
          {value.toFixed(1)}{unit}
        </span>
      </div>

      {/* Delta from default */}
      <div className="flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: dColor }}
        />
        <span className="text-[10px] text-muted-foreground font-mono">
          Delta from default: <span style={{ color: dColor }} className="font-bold">{formatDelta(delta)}</span>
        </span>
      </div>

      {/* Delta bar visual */}
      <div className="h-1.5 rounded-full bg-white/5 relative overflow-hidden">
        {/* Default center marker */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20 z-10" />
        {/* Delta fill */}
        <div
          className="absolute top-0 bottom-0 rounded-full transition-all duration-200"
          style={{
            backgroundColor: dColor,
            opacity: 0.6,
            left: delta >= 0 ? '50%' : `${50 + (delta / (max - min)) * 100}%`,
            width: `${Math.abs(delta / (max - min)) * 100}%`,
          }}
        />
      </div>

      {/* Affects: DSP sub-params */}
      {subParams && subParams.length > 0 && (
        <div className="pt-1 border-t border-white/5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1">
            Affects:
          </div>
          <div className="flex flex-wrap gap-1">
            {subParams.map((p) => (
              <span
                key={p}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                style={{
                  color: `${color}CC`,
                  borderColor: `${color}30`,
                  backgroundColor: `${color}10`,
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <div
            className="relative cursor-ns-resize focus:outline-none focus-visible:ring-2 focus-visible:ring-rain-accent/50 rounded-full"
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ width: size, height: size, touchAction: 'none' }}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={`${value.toFixed(1)}${unit}`}
          >
            {knobSvg}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className="bg-[rgba(10,12,18,0.95)] border border-white/10 backdrop-blur-sm rounded-lg px-3 py-2.5 shadow-xl shadow-black/40"
        >
          {tooltipContent}
        </TooltipContent>
      </Tooltip>

      <div className="text-center">
        <div className="text-[10px] font-mono font-bold tracking-wider" style={{ color }}>
          {label}
        </div>
        <div className="text-sm font-mono font-bold tabular-nums" style={{ color }}>
          {value.toFixed(1)}{unit}
        </div>
        {description && (
          <div className="text-[9px] text-muted-foreground/70 leading-tight max-w-[88px] mt-0.5">
            {description}
          </div>
        )}
      </div>
    </div>
  )
}
