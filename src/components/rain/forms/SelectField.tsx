'use client'

/**
 * RAIN V6 — shared SelectField component.
 *
 * Wraps the shadcn/ui `Select` (Radix) with the same label + hint + error
 * layout as `Field`. Used for dropdowns like Language, PRO, Genre, etc.
 */

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  label: string
  value: string
  onValueChange: (v: string) => void
  options: SelectOption[]
  hint?: string
  error?: string
  warning?: string
  placeholder?: string
  containerClassName?: string
  triggerClassName?: string
}

export function SelectField({
  label,
  value,
  onValueChange,
  options,
  hint,
  error,
  warning,
  placeholder,
  containerClassName,
  triggerClassName,
}: SelectFieldProps) {
  const showError = Boolean(error)
  const showWarning = !showError && Boolean(warning)
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          aria-invalid={showError || undefined}
          className={cn(
            'w-full bg-rain-surface-2 border rounded-md px-2 h-8 text-xs font-mono',
            'focus:outline-none focus:border-rain-accent/70 transition-colors',
            showError
              ? 'border-red-500/70'
              : showWarning
                ? 'border-amber-400/60'
                : 'border-rain-border',
            triggerClassName,
          )}
        >
          <SelectValue placeholder={placeholder ?? 'Select…'} />
        </SelectTrigger>
        <SelectContent
          className="bg-rain-surface-2 border-rain-border text-foreground"
          position="popper"
        >
          {options
            .filter((opt) => opt.value !== '')
            .map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="text-xs font-mono focus:bg-rain-accent/15 focus:text-rain-accent"
              >
                {opt.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {hint && !showError && !showWarning && (
        <div className="text-[9px] font-mono text-muted-foreground/70">{hint}</div>
      )}
      {showWarning && (
        <div className="text-[9px] font-mono text-amber-400/90">{warning}</div>
      )}
      {showError && (
        <div className="text-[9px] font-mono text-red-400">{error}</div>
      )}
    </div>
  )
}
