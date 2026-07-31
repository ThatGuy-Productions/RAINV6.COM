'use client'

/**
 * RAIN V6 — shared RadioField component.
 *
 * Wraps the shadcn/ui `RadioGroup` (Radix) with the same label + hint + error
 * layout as `Field`. Used for Release Type, Explicit Lyrics, and AI Disclosure
 * stages.
 */

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface RadioOption {
  value: string
  label: string
  /** Optional tooltip shown when hovering the option label. */
  tooltip?: string
}

export interface RadioFieldProps {
  label: string
  value: string
  onValueChange: (v: string) => void
  options: RadioOption[]
  /** Layout: 'row' (horizontal, label beside option) or 'grid' (3-column). */
  layout?: 'row' | 'grid'
  hint?: string
  error?: string
  containerClassName?: string
}

export function RadioField({
  label,
  value,
  onValueChange,
  options,
  layout = 'row',
  hint,
  error,
  containerClassName,
}: RadioFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        className={cn(
          layout === 'grid' ? 'grid grid-cols-3 gap-2' : 'flex flex-wrap gap-3',
        )}
      >
        {options.map((opt) => (
          <div
            key={opt.value}
            className={cn(
              'flex items-center gap-2 px-2 py-1 rounded-md border transition-colors cursor-pointer',
              value === opt.value
                ? 'border-rain-accent/60 bg-rain-accent/10'
                : 'border-rain-border bg-rain-surface-2 hover:border-rain-accent/30',
            )}
          >
            <RadioGroupItem value={opt.value} id={`rf-${label}-${opt.value}`} />
            <label
              htmlFor={`rf-${label}-${opt.value}`}
              className="text-[11px] font-mono cursor-pointer select-none"
            >
              {opt.label}
            </label>
            {opt.tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto text-[9px] text-muted-foreground cursor-help">?</span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="bg-rain-surface-2 border-rain-border text-rain-accent text-[10px] font-mono max-w-[200px]"
                >
                  {opt.tooltip}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        ))}
      </RadioGroup>
      {hint && !error && (
        <div className="text-[9px] font-mono text-muted-foreground/70">{hint}</div>
      )}
      {error && (
        <div className="text-[9px] font-mono text-red-400">{error}</div>
      )}
    </div>
  )
}
