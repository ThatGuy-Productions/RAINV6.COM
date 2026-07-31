'use client'

/**
 * RAIN V6 — Simple Mode Panel (Wave 3 P2-4)
 *
 * Replaces the 7 CreativeMacros knobs with a single 0–100 Intensity slider
 * and a compact Genre selector. The (intensity, genre) pair is mapped to
 * the full 7-macro state deterministically by simple-mode.ts. Each change
 * writes through `setMacros` so undo/redo and the macro history still work.
 *
 * Visible only when the Simple/Pro toggle at the top of MasteringTab is ON.
 */

import { useCallback } from 'react'
import { Gauge } from 'lucide-react'
import { GENRES } from '@/lib/rain/constants'
import { useSessionStore } from '@/lib/rain/store'
import { applySimpleMode, mapSimpleModeToMacros } from '@/lib/rain/simple-mode'
import { Slider } from '@/components/ui/slider'
import { MACROS } from '@/lib/rain/constants'
import type { MacroValues } from '@/lib/rain/types'

export function SimpleModePanel() {
  const simpleIntensity = useSessionStore((s) => s.simpleIntensity)
  const setSimpleIntensity = useSessionStore((s) => s.setSimpleIntensity)
  const genre = useSessionStore((s) => s.genre)
  const setGenre = useSessionStore((s) => s.setGenre)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setMacroSource = useSessionStore((s) => s.setMacroSource)

  // Live preview of the macro values the current (intensity, genre) pair
  // produces — same pure function the apply step uses, so the bars always
  // match what a render will actually receive.
  const preview: MacroValues = mapSimpleModeToMacros(simpleIntensity, genre)

  const onIntensityChange = useCallback(
    (v: number) => {
      setSimpleIntensity(v)
      applySimpleMode(v, genre, setMacros, setMacroSource)
    },
    [genre, setMacros, setMacroSource, setSimpleIntensity],
  )

  const onGenreChange = useCallback(
    (g: string) => {
      setGenre(g)
      applySimpleMode(simpleIntensity, g, setMacros, setMacroSource)
    },
    [setGenre, setMacros, setMacroSource, simpleIntensity],
  )

  return (
    <div className="rain-panel rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
            Simple Mode
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Intensity · Genre-driven</span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border text-[#00D4FF] border-[#00D4FF40] bg-[#00D4FF10]">
              HEURISTIC 100%
            </span>
          </div>
        </div>
        <Gauge className="w-4 h-4 text-rain-accent" />
      </div>

      {/* Intensity slider */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="rain-simple-intensity"
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
          >
            Intensity
          </label>
          <span className="text-sm font-mono font-bold text-rain-accent tabular-nums">
            {simpleIntensity}
          </span>
        </div>
        <Slider
          id="rain-simple-intensity"
          min={0}
          max={100}
          step={1}
          value={[simpleIntensity]}
          onValueChange={(vals) => {
            const v = Array.isArray(vals) ? vals[0] : vals
            if (typeof v === 'number') onIntensityChange(v)
          }}
          aria-label="Mastering intensity"
        />
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/70">
          <span>Subtle (defaults)</span>
          <span>Balanced</span>
          <span>Maximum</span>
        </div>
      </div>

      {/* Genre selector — drives the additive tilt */}
      <div className="mt-4">
        <label
          htmlFor="rain-simple-genre"
          className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1"
        >
          Genre · tilts the macro mapping
        </label>
        <select
          id="rain-simple-genre"
          value={genre}
          onChange={(e) => onGenreChange(e.target.value)}
          className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-rain-accent/50"
        >
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Live preview of the derived 7-macro state */}
      <div className="mt-4 pt-3 border-t border-rain-border">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Derived macros · live preview
        </div>
        <div className="grid grid-cols-7 gap-2">
          {MACROS.map((m) => {
            const v = preview[m.key]
            const pct = (v / 10) * 100
            return (
              <div key={m.key} className="flex flex-col items-center gap-1">
                <div className="text-[9px] font-mono uppercase text-muted-foreground">
                  {m.label.slice(0, 3)}
                </div>
                <div className="relative w-full h-12 rounded bg-rain-surface-3 overflow-hidden border border-rain-border">
                  <div
                    className="absolute bottom-0 left-0 right-0 transition-all duration-200"
                    style={{
                      height: `${pct}%`,
                      backgroundColor: m.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <div
                  className="text-[10px] font-mono font-bold tabular-nums"
                  style={{ color: m.color }}
                >
                  {v.toFixed(1)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-rain-border text-[10px] font-mono text-muted-foreground">
        Toggle Pro Mode to access individual macro knobs · Simple Mode writes through undo/redo
        history
      </div>
    </div>
  )
}
