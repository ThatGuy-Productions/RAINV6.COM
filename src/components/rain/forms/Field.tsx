'use client'

/**
 * RAIN V6 — shared form Field component.
 *
 * Promoted from DistributeTab's local `Field` helper so the new MetadataTab
 * (and any future tab) can reuse the same label + input + hint + error layout.
 *
 * Visual language: dark `rain-surface-2` background, `rain-border` border,
 * font-mono uppercase 10px label, lime accent on focus, red border + red
 * error text when `error` is set, amber border when `warning` is set.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface FieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string
  value: string
  onValueChange: (v: string) => void
  /** Optional small mono hint shown under the input. */
  hint?: string
  /** Red error message — also turns the border red. */
  error?: string
  /** Amber warning — used for "required and empty" feedback. */
  warning?: string
  /** Optional suffix element rendered inside the input row (e.g. a Generate button). */
  suffix?: React.ReactNode
  /** Container className. */
  containerClassName?: string
}

export function Field({
  label,
  value,
  onValueChange,
  hint,
  error,
  warning,
  suffix,
  containerClassName,
  className,
  ...inputProps
}: FieldProps) {
  const showError = Boolean(error)
  const showWarning = !showError && Boolean(warning)
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {inputProps.required && <span className="text-rain-accent">*</span>}
      </label>
      <div className="flex items-stretch gap-1">
        <input
          {...inputProps}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          aria-invalid={showError || undefined}
          className={cn(
            'flex-1 min-w-0 bg-rain-surface-2 border rounded-md px-2 py-1.5 text-xs font-mono',
            'focus:outline-none focus:border-rain-accent/70 transition-colors',
            'placeholder:text-muted-foreground/60',
            showError
              ? 'border-red-500/70'
              : showWarning
                ? 'border-amber-400/60'
                : 'border-rain-border',
            className,
          )}
        />
        {suffix}
      </div>
      {hint && !showError && !showWarning && (
        <div className="text-[9px] font-mono text-muted-foreground/70 leading-tight">{hint}</div>
      )}
      {showWarning && (
        <div className="text-[9px] font-mono text-amber-400/90 leading-tight">{warning}</div>
      )}
      {showError && (
        <div className="text-[9px] font-mono text-red-400 leading-tight">{error}</div>
      )}
    </div>
  )
}

/** Convenience wrapper for a Textarea (used by the release notes section). */
export interface TextAreaFieldProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label: string
  value: string
  onValueChange: (v: string) => void
  hint?: string
  error?: string
  containerClassName?: string
}

export function TextAreaField({
  label,
  value,
  onValueChange,
  hint,
  error,
  containerClassName,
  className,
  ...textareaProps
}: TextAreaFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <textarea
        {...textareaProps}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-invalid={Boolean(error) || undefined}
        className={cn(
          'w-full bg-rain-surface-2 border rounded-md px-2 py-1.5 text-xs font-mono',
          'focus:outline-none focus:border-rain-accent/70 transition-colors resize-y min-h-20',
          'placeholder:text-muted-foreground/60',
          error ? 'border-red-500/70' : 'border-rain-border',
          className,
        )}
      />
      {hint && !error && (
        <div className="text-[9px] font-mono text-muted-foreground/70">{hint}</div>
      )}
      {error && (
        <div className="text-[9px] font-mono text-red-400">{error}</div>
      )}
    </div>
  )
}
