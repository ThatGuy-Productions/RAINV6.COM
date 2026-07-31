'use client'

/**
 * AI Disclosure Panel — honest, per-field selections for EU AI Act Article 50
 *
 * Users set what's TRUE about how AI was involved in their work:
 *   none      = No AI used in this area
 *   assisted  = AI helped (suggestions, corrections) — human made final decisions
 *   generated = AI generated this content — human curated/selected
 *
 * All five fields default to 'none'. Users must actively set their disclosure
 * level — no pre-filled assertions, no auto-detection guessing.
 *
 * Embedded in MasteringTab (pre-render) and DistributeTab (pre-package).
 * The disclosure is written into DDEX ERN 4.3.2 <AIInvolvement> block.
 */

import { Info, Mic, Music, PenTool, Sliders, Sparkles } from 'lucide-react'
import { useState } from 'react'

export type DisclosureLevel = 'none' | 'assisted' | 'generated'

export interface DisclosureState {
  vocals: DisclosureLevel
  instrumentation: DisclosureLevel
  composition: DisclosureLevel
  mixing: DisclosureLevel
  mastering: DisclosureLevel
}

const DEFAULT_DISCLOSURE: DisclosureState = {
  vocals: 'none',
  instrumentation: 'none',
  composition: 'none',
  mixing: 'none',
  mastering: 'none',
}

const FIELD_CONFIG = [
  {
    key: 'vocals' as const,
    label: 'Vocals',
    icon: Mic,
    description: 'Lead and backing vocals, harmonies, spoken word',
    examples: 'Recorded by a human, AI voice synthesis, Auto-Tune-assisted',
  },
  {
    key: 'instrumentation' as const,
    label: 'Instrumentation',
    icon: Music,
    description: 'Instruments, beats, samples, sound design',
    examples: 'Live instruments, virtual instruments, AI-generated stems',
  },
  {
    key: 'composition' as const,
    label: 'Composition',
    icon: PenTool,
    description: 'Songwriting, melody, harmony, arrangement, lyrics',
    examples: 'Human-written, AI-generated melody, AI-assisted chord progression',
  },
  {
    key: 'mixing' as const,
    label: 'Mixing',
    icon: Sliders,
    description: 'Levels, panning, EQ, compression, effects',
    examples: 'Human mixed, AI-assisted mixing, automatic mixdown',
  },
  {
    key: 'mastering' as const,
    label: 'Mastering',
    icon: Sparkles,
    description: 'Final loudness, EQ balance, stereo image, format export',
    examples: 'RAIN V6 AI mastering, human-tweaked master, manual mastering',
  },
] as const

const LEVEL_CONFIG: { value: DisclosureLevel; label: string; color: string; bg: string }[] = [
  { value: 'none', label: 'No AI used', color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
  { value: 'assisted', label: 'AI assisted', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  { value: 'generated', label: 'AI generated', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
]

interface AiDisclosurePanelProps {
  value: DisclosureState
  onChange: (state: DisclosureState) => void
  /** When true, shows preamble explaining legal context */
  showPreamble?: boolean
}

export function AiDisclosurePanel({ value, onChange, showPreamble = true }: AiDisclosurePanelProps) {
  const [expanded, setExpanded] = useState(false)

  const setField = (key: keyof DisclosureState, level: DisclosureLevel) => {
    onChange({ ...value, [key]: level })
  }

  // Count fields that are NOT 'none' — used in the collapsed badge
  const assistedCount = Object.values(value).filter((v) => v === 'assisted').length
  const generatedCount = Object.values(value).filter((v) => v === 'generated').length
  const totalDisclosed = assistedCount + generatedCount

  return (
    <div className="space-y-2">
      {/* Preamble */}
      {showPreamble && (
        <div
          className="flex items-start gap-2 p-3 rounded-md text-xs leading-relaxed"
          style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: '#8B5CF6' }} />
          <div>
            <span className="font-semibold" style={{ color: '#A78BFA' }}>
              EU AI Act Article 50 · Honest Disclosure
            </span>
            {' '}
            <span className="text-muted-foreground">
              Select how AI was involved in each area of this recording.
              This disclosure is embedded in your DDEX package and visible to
              streaming platforms. Set each field honestly — there is no
              penalty for AI use, only for misrepresentation.
            </span>
          </div>
        </div>
      )}

      {/* Collapsed summary */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-between p-2.5 rounded-md border border-rain-border/60 bg-rain-surface-2/40 hover:border-rain-border transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {totalDisclosed === 0
                ? 'No AI disclosure set — click to review'
                : `${totalDisclosed} field${totalDisclosed !== 1 ? 's' : ''} disclosed`}
            </span>
            {assistedCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
              >
                {assistedCount} assisted
              </span>
            )}
            {generatedCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}
              >
                {generatedCount} generated
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">▶</span>
        </button>
      )}

      {/* Expanded selector grid */}
      {expanded && (
        <div
          className="p-3 rounded-md space-y-2.5"
          style={{ background: 'rgba(18,20,26,0.6)', border: '1px solid rgba(42,46,58,0.5)' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Per-Area AI Involvement
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Collapse ▲
            </button>
          </div>

          {FIELD_CONFIG.map((field) => {
            const Icon = field.icon
            const currentLevel = value[field.key]
            const levelInfo = LEVEL_CONFIG.find((l) => l.value === currentLevel)!

            return (
              <div
                key={field.key}
                className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded"
                style={{ background: levelInfo.bg }}
              >
                {/* Label + icon */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: levelInfo.color }} />
                  <div>
                    <div className="text-sm font-medium">{field.label}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">
                      {field.description}
                    </div>
                  </div>
                </div>

                {/* Selector buttons */}
                <div className="flex gap-1 flex-shrink-0">
                  {LEVEL_CONFIG.map((level) => {
                    const isSelected = currentLevel === level.value
                    return (
                      <button
                        key={level.value}
                        onClick={() => setField(field.key, level.value)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                        style={{
                          background: isSelected ? level.color : 'rgba(42,46,58,0.3)',
                          color: isSelected ? '#0A0B0E' : 'var(--muted-foreground)',
                          border: isSelected ? `1px solid ${level.color}` : '1px solid transparent',
                        }}
                        title={`${field.label}: ${level.label}`}
                      >
                        {level.value === 'none' ? 'None' : level.value === 'assisted' ? 'Assisted' : 'Generated'}
                      </button>
                    )
                  })}
                </div>

                {/* Status word */}
                <span
                  className="text-[10px] font-mono flex-shrink-0 hidden sm:inline"
                  style={{ color: levelInfo.color }}
                >
                  {levelInfo.label}
                </span>
              </div>
            )
          })}

          {/* Examples */}
          <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-rain-border/40">
            <span className="font-semibold">What each level means:</span>
            {' '}
            <span style={{ color: '#10B981' }}>None</span> = no AI used ·{' '}
            <span style={{ color: '#F59E0B' }}>Assisted</span> = AI helped, human decided ·{' '}
            <span style={{ color: '#EF4444' }}>Generated</span> = AI created, human curated
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Convenience hook: returns disclosure state + setter, defaulting all to 'none'.
 */
export function useAiDisclosure(initial?: Partial<DisclosureState>): [DisclosureState, (s: DisclosureState) => void] {
  const [state, setState] = useState<DisclosureState>({ ...DEFAULT_DISCLOSURE, ...initial })
  return [state, setState]
}

export { DEFAULT_DISCLOSURE }
