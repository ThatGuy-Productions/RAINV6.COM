'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCcw } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { MACROS, DEFAULT_MACROS, GENRES } from '@/lib/rain/constants'
import { notifyInfo } from '@/lib/rain/notifications'
import type { MacroKey, MacroValues } from '@/lib/rain/types'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Genre preset definitions — typical mastering approaches per genre
// ---------------------------------------------------------------------------

export interface GenrePreset {
  key: string
  label: string
  emoji: string
  macros: MacroValues
}

const GENRE_PRESETS: GenrePreset[] = [
  {
    key: 'pop',
    label: 'Pop',
    emoji: '🎤',
    macros: { brighten: 6, glue: 7, width: 6, punch: 5, warmth: 3, space: 3, repair: 1 },
  },
  {
    key: 'rock',
    label: 'Rock',
    emoji: '🎸',
    macros: { brighten: 5, glue: 7, width: 5, punch: 7, warmth: 4, space: 2, repair: 1 },
  },
  {
    key: 'hiphop',
    label: 'Hip-Hop',
    emoji: '🎧',
    macros: { brighten: 4, glue: 6, width: 7, punch: 8, warmth: 5, space: 2, repair: 1 },
  },
  {
    key: 'electronic',
    label: 'Electronic',
    emoji: '⚡',
    macros: { brighten: 7, glue: 5, width: 8, punch: 7, warmth: 2, space: 5, repair: 0 },
  },
  {
    key: 'classical',
    label: 'Classical',
    emoji: '🎻',
    macros: { brighten: 3, glue: 2, width: 4, punch: 2, warmth: 3, space: 6, repair: 2 },
  },
  {
    key: 'jazz',
    label: 'Jazz',
    emoji: '🎷',
    macros: { brighten: 3, glue: 3, width: 4, punch: 3, warmth: 5, space: 4, repair: 2 },
  },
  {
    key: 'metal',
    label: 'Metal',
    emoji: '🤘',
    macros: { brighten: 4, glue: 8, width: 4, punch: 9, warmth: 3, space: 1, repair: 1 },
  },
  {
    key: 'folk',
    label: 'Folk',
    emoji: '🪕',
    macros: { brighten: 4, glue: 3, width: 3, punch: 3, warmth: 6, space: 3, repair: 2 },
  },
  {
    key: 'rnb',
    label: 'R&B',
    emoji: '🎶',
    macros: { brighten: 5, glue: 5, width: 6, punch: 5, warmth: 5, space: 4, repair: 1 },
  },
  {
    key: 'country',
    label: 'Country',
    emoji: '🤠',
    macros: { brighten: 5, glue: 4, width: 4, punch: 4, warmth: 5, space: 2, repair: 1 },
  },
  {
    key: 'reggae',
    label: 'Reggae',
    emoji: '🇯🇲',
    macros: { brighten: 4, glue: 4, width: 6, punch: 4, warmth: 6, space: 5, repair: 1 },
  },
  {
    key: 'ambient',
    label: 'Ambient',
    emoji: '🌊',
    macros: { brighten: 2, glue: 2, width: 9, punch: 1, warmth: 4, space: 8, repair: 2 },
  },
]

// The 7 macro keys in display order (matches MACROS constant order)
const MACRO_KEYS: MacroKey[] = ['brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair']

// Macro colors from constants
const MACRO_COLORS: Record<MacroKey, string> = MACROS.reduce((acc, m) => {
  acc[m.key] = m.color
  return acc
}, {} as Record<MacroKey, string>)

// ---------------------------------------------------------------------------
// Mini bar chart — 7 bars showing relative macro values
// ---------------------------------------------------------------------------

function MiniMacroChart({ macros, barWidth = 3, barGap = 1.5, height = 20 }: {
  macros: MacroValues
  barWidth?: number
  barGap?: number
  height?: number
}) {
  const maxVal = 10
  return (
    <svg
      width={MACRO_KEYS.length * (barWidth + barGap) - barGap}
      height={height}
      viewBox={`0 0 ${MACRO_KEYS.length * (barWidth + barGap) - barGap} ${height}`}
      className="flex-shrink-0"
    >
      {MACRO_KEYS.map((key, i) => {
        const val = macros[key]
        const barH = Math.max(1, (val / maxVal) * (height - 2))
        const x = i * (barWidth + barGap)
        const y = height - barH - 1
        return (
          <rect
            key={key}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            rx={0.75}
            fill={MACRO_COLORS[key]}
            opacity={0.5 + (val / maxVal) * 0.5}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Determine if a preset is "active" — all macro values match
// ---------------------------------------------------------------------------

function isPresetActive(currentMacros: MacroValues, presetMacros: MacroValues): boolean {
  return MACRO_KEYS.every((k) => Math.abs(currentMacros[k] - presetMacros[k]) < 0.01)
}

function isAutoActive(currentMacros: MacroValues): boolean {
  return MACRO_KEYS.every((k) => Math.abs(currentMacros[k] - DEFAULT_MACROS[k]) < 0.01)
}

// ---------------------------------------------------------------------------
// Main GenrePresets component
// ---------------------------------------------------------------------------

export function GenrePresets() {
  const macros = useSessionStore((s) => s.macros)
  const genre = useSessionStore((s) => s.genre)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setGenre = useSessionStore((s) => s.setGenre)
  const setMacroSource = useSessionStore((s) => s.setMacroSource)
  const resetMacros = useSessionStore((s) => s.resetMacros)

  const activePreset = useMemo(() => {
    for (const p of GENRE_PRESETS) {
      if (isPresetActive(macros, p.macros)) return p.key
    }
    if (isAutoActive(macros)) return '__auto__'
    return null
  }, [macros])

  const handleApplyPreset = (preset: GenrePreset) => {
    setMacros(preset.macros)
    setGenre(preset.key)
    setMacroSource('HEURISTIC', 85)
    notifyInfo(`${preset.label} preset applied`, `7 macros configured for ${preset.label.toLowerCase()} mastering`)
  }

  const handleAuto = () => {
    resetMacros()
    setGenre('pop') // default genre
    setMacroSource('MANUAL', 0)
  }

  // Build tooltip lines for a preset
  const buildTooltipContent = (preset: GenrePreset) => (
    <div className="space-y-1 min-w-[180px]">
      <div className="font-mono font-bold text-rain-accent text-[11px] mb-1.5">
        {preset.emoji} {preset.label} Preset
      </div>
      {MACRO_KEYS.map((key) => {
        const def = MACROS.find((m) => m.key === key)!
        const val = preset.macros[key]
        return (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono" style={{ color: def.color }}>
              {def.label}
            </span>
            <span className="text-[10px] font-mono tabular-nums text-foreground">
              {val.toFixed(1)}
            </span>
          </div>
        )
      })}
    </div>
  )

  const autoTooltipContent = (
    <div className="space-y-1 min-w-[180px]">
      <div className="font-mono font-bold text-rain-accent text-[11px] mb-1.5">
        ↺ Reset Defaults
      </div>
      {MACRO_KEYS.map((key) => {
        const def = MACROS.find((m) => m.key === key)!
        return (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono" style={{ color: def.color }}>
              {def.label}
            </span>
            <span className="text-[10px] font-mono tabular-nums text-foreground">
              {DEFAULT_MACROS[key].toFixed(1)}
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="rain-panel rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Genre Presets
        </span>
        <span className="text-[9px] font-mono text-muted-foreground/60">
          Click to apply macro profile
        </span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 rain-scrollbar">
        {/* AUTO pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              onClick={handleAuto}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className={`
                flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                transition-colors cursor-pointer select-none
                ${activePreset === '__auto__'
                  ? 'border-rain-accent bg-rain-accent/15 shadow-[0_0_12px_rgba(170,255,0,0.2)]'
                  : 'border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 hover:shadow-[0_0_8px_rgba(170,255,0,0.15)]'
                }
              `}
            >
              <RotateCcw className="w-3 h-3 text-rain-accent flex-shrink-0" />
              <span className={`text-[11px] font-mono font-semibold ${activePreset === '__auto__' ? 'text-rain-accent' : 'text-foreground/80'}`}>
                AUTO
              </span>
              <MiniMacroChart macros={DEFAULT_MACROS} barWidth={2.5} barGap={1} height={14} />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-zinc-900 border border-rain-border text-foreground">
            {autoTooltipContent}
          </TooltipContent>
        </Tooltip>

        {/* Genre pills */}
        {GENRE_PRESETS.map((preset) => {
          const isActive = activePreset === preset.key
          return (
            <Tooltip key={preset.key}>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={() => handleApplyPreset(preset)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className={`
                    flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                    transition-colors cursor-pointer select-none
                    ${isActive
                      ? 'border-rain-accent bg-rain-accent/15 shadow-[0_0_12px_rgba(170,255,0,0.2)]'
                      : 'border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 hover:shadow-[0_0_8px_rgba(170,255,0,0.15)]'
                    }
                  `}
                >
                  <span className="text-xs flex-shrink-0">{preset.emoji}</span>
                  <span className={`text-[11px] font-mono font-semibold ${isActive ? 'text-rain-accent' : 'text-foreground/80'}`}>
                    {preset.label}
                  </span>
                  <MiniMacroChart macros={preset.macros} barWidth={2.5} barGap={1} height={14} />
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-900 border border-rain-border text-foreground">
                {buildTooltipContent(preset)}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
