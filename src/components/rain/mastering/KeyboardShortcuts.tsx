'use client'

import { useCallback, useEffect } from 'react'
import { audioEngine } from '@/lib/rain/audio-engine'

// ---------------------------------------------------------------------------
// Main KeyboardShortcuts component
// Handles all keyboard bindings; overlay is managed by KeyboardShortcutsOverlay
// ---------------------------------------------------------------------------

export function KeyboardShortcuts() {
  const isStudioActive = useCallback(() => {
    if (typeof window === 'undefined') return false
    return window.location.hash.includes('studio')
  }, [])

  const isInputFocused = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? ''
    // AUDIT2-7 FIX: include 'button' so Space activates a focused button
    // instead of being hijacked by the global play/pause toggle.
    return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button'
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only active in studio
      if (!isStudioActive()) return
      // Don't capture when typing in inputs
      if (isInputFocused(e)) return

      const key = e.key

      // ── Space — toggle play/pause ──────────────────────────────
      if (key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        audioEngine.init().then(() => audioEngine.togglePlay())
        return
      }

      // ── Escape — stop & rewind (overlay handles its own Esc close) ─────
      if (key === 'Escape') {
        e.preventDefault()
        audioEngine.stop()
        audioEngine.seek(0)
        return
      }

      // ── A — preview mode A (original) ────────────────────────
      if (key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        audioEngine.setPreviewMode('A')
        return
      }

      // ── B — preview mode B (mastered) ────────────────────────
      if (key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        audioEngine.setPreviewMode('B')
        return
      }

      // ── C — compare toggle (A/B comparison overlay) ──────────────────
      if (key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:compare'))
        return
      }

      // ── R — render ───────────────────────────────────────────
      if (key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:render'))
        return
      }

      // ── E — export ───────────────────────────────────────────
      if (key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:export'))
        return
      }

      // ── 1-7 — macro focus ────────────────────────────────────
      if (/^[1-7]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        const index = parseInt(key, 10) - 1
        window.dispatchEvent(new CustomEvent('rain:macro-focus', { detail: { index } }))
        return
      }

      // ── Ctrl+Shift+Z (or Cmd+Shift+Z on macOS) — redo ────────────────
      // P1 FIX: previously the modifier gate was `e.ctrlKey && !e.metaKey`,
      // which blocked the Cmd (metaKey) chord entirely — macOS users had no
      // working redo shortcut (and no working undo either, see below). The
      // spec mandates Cmd/Ctrl+Shift+Z, so we accept either modifier.
      if (key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:redo'))
        return
      }

      // ── Ctrl+Z (or Cmd+Z on macOS) — undo ───────────────────────────
      if (key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:undo'))
        return
      }

      // ── Ctrl+Y (or Cmd+Y on macOS) — redo (alternate chord) ─────────
      if (key === 'y' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:redo'))
        return
      }

      // ── ? — toggle shortcuts overlay (dispatches event for StudioApp) ───
      if (key === '?' || (key === '/' && e.shiftKey)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('rain:shortcuts-toggle'))
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isStudioActive, isInputFocused])

  // This component only handles keyboard bindings, no UI
  return null
}