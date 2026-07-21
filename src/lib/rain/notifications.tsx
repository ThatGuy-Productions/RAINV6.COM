'use client'

/**
 * RAIN V6 — Toast Notification Manager
 *
 * Provides styled toast notifications for key user actions using Sonner.
 * Each variant uses a colored accent border-left and matching Lucide icon,
 * following the RAIN aesthetic (dark bg, lime/cyan/red/orange accents).
 */

import { toast } from 'sonner'
import { Check, X, Info, AlertTriangle } from 'lucide-react'

// ---------------------------------------------------------------------------
// Accent colors matching the RAIN design language
// ---------------------------------------------------------------------------

const ACCENTS = {
  success: '#AAFF00', // lime — RAIN accent
  error: '#EF4444',   // red
  info: '#00D4FF',    // cyan
  warning: '#F97316', // orange
} as const

// ---------------------------------------------------------------------------
// Shared base style — dark bg, backdrop blur, mono font
// ---------------------------------------------------------------------------

function baseStyle(accent: string, borderRgb: string) {
  return {
    background: 'rgba(10, 12, 18, 0.95)',
    border: `1px solid rgba(${borderRgb}, 0.25)`,
    borderLeft: `3px solid ${accent}`,
    color: '#F0F0F0',
    fontFamily: 'var(--font-geist-mono), monospace',
    fontSize: '13px',
    borderRadius: '8px',
    backdropFilter: 'blur(12px)',
  } as React.CSSProperties
}

const ICON_SIZE = 16

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Lime-accent toast for successful actions (render complete, export done). */
export function notifySuccess(title: string, description?: string) {
  toast(title, {
    description,
    duration: 4000,
    icon: <Check size={ICON_SIZE} color={ACCENTS.success} strokeWidth={2.5} />,
    style: baseStyle(ACCENTS.success, '170,255,0'),
  })
}

/** Red-accent toast for errors (render failed, load failed). */
export function notifyError(title: string, description?: string) {
  toast.error(title, {
    description,
    duration: 4000,
    icon: <X size={ICON_SIZE} color={ACCENTS.error} strokeWidth={2.5} />,
    style: baseStyle(ACCENTS.error, '239,68,68'),
  })
}

/** Cyan-accent toast for informational messages (file loaded, preset applied). */
export function notifyInfo(title: string, description?: string) {
  toast.info(title, {
    description,
    duration: 4000,
    icon: <Info size={ICON_SIZE} color={ACCENTS.info} strokeWidth={2.5} />,
    style: baseStyle(ACCENTS.info, '0,212,255'),
  })
}

/** Orange-accent toast for warnings. */
export function notifyWarning(title: string, description?: string) {
  toast.warning(title, {
    description,
    duration: 4000,
    icon: <AlertTriangle size={ICON_SIZE} color={ACCENTS.warning} strokeWidth={2.5} />,
    style: baseStyle(ACCENTS.warning, '249,115,22'),
  })
}
