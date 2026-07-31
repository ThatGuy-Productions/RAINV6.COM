'use client'

import { useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play,
  Square,
  RotateCcw,
  Repeat,
  Wand2,
  SlidersHorizontal,
  ArrowLeftRight,
  Layers,
  Download,
  Keyboard,
  X,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShortcutDef {
  keys: string[]
  description: string
  icon?: React.ReactNode
}

interface ShortcutCategory {
  name: string
  shortcuts: ShortcutDef[]
}

// ---------------------------------------------------------------------------
// Shortcut definitions organized by category
// ---------------------------------------------------------------------------

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: 'Playback',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause', icon: <Play className="w-3.5 h-3.5" /> },
      { keys: ['Esc'], description: 'Stop & Rewind', icon: <Square className="w-3.5 h-3.5" /> },
      { keys: ['A'], description: 'Preview Original', icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
      { keys: ['B'], description: 'Preview Mastered', icon: <Layers className="w-3.5 h-3.5" /> },
    ],
  },
  {
    name: 'Mastering',
    shortcuts: [
      { keys: ['R'], description: 'Render Master', icon: <Wand2 className="w-3.5 h-3.5" /> },
      { keys: ['E'], description: 'Export WAV', icon: <Download className="w-3.5 h-3.5" /> },
      { keys: ['1', '2', '3', '4', '5', '6', '7'], description: 'Focus Macros', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
    ],
  },
  {
    name: 'Navigation',
    shortcuts: [
      { keys: ['?'], description: 'Toggle Shortcuts', icon: <Keyboard className="w-3.5 h-3.5" /> },
      // P1 FIX: now that KeyboardShortcuts.tsx accepts either Ctrl or Cmd
      // (metaKey) for undo/redo, the overlay labels reflect both platforms.
      { keys: ['Ctrl/⌘', 'Z'], description: 'Undo Macro Change' },
      { keys: ['Ctrl/⌘', '⇧', 'Z'], description: 'Redo Macro Change' },
      { keys: ['Ctrl/⌘', 'Y'], description: 'Redo Macro Change' },
    ],
  },
  {
    name: 'A/B Comparison',
    shortcuts: [
      { keys: ['C'], description: 'Toggle Compare View', icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
      { keys: ['A'], description: 'Preview Original' },
      { keys: ['B'], description: 'Preview Mastered' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Keyboard badge component
// ---------------------------------------------------------------------------

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md border border-rain-border bg-rain-surface-3 font-mono text-[11px] text-rain-accent shadow-sm">
      {children}
    </kbd>
  )
}

// ---------------------------------------------------------------------------
// Shortcut row component
// ---------------------------------------------------------------------------

function ShortcutRow({ shortcut }: { shortcut: ShortcutDef }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-rain-surface-2/50 transition-colors group">
      <div className="flex items-center gap-2.5">
        {shortcut.icon && (
          <span className="text-muted-foreground group-hover:text-rain-accent transition-colors">
            {shortcut.icon}
          </span>
        )}
        <span className="text-sm text-foreground/90">{shortcut.description}</span>
      </div>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/50 text-xs mx-0.5">+</span>}
            <Kbd>{part}</Kbd>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category section component
// ---------------------------------------------------------------------------

function CategorySection({ category }: { category: ShortcutCategory }) {
  return (
    <section>
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-rain-accent mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-rain-accent" />
        {category.name}
      </h3>
      <div className="space-y-0.5">
        {category.shortcuts.map((s, i) => (
          <ShortcutRow key={i} shortcut={s} />
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main overlay component
// ---------------------------------------------------------------------------

interface KeyboardShortcutsOverlayProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Store the previously focused element and announce to screen readers
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
      // Announce to screen readers
      const announcement = document.createElement('div')
      announcement.setAttribute('role', 'status')
      announcement.setAttribute('aria-live', 'polite')
      announcement.className = 'sr-only'
      announcement.textContent = 'Keyboard shortcuts dialog opened'
      document.body.appendChild(announcement)
      setTimeout(() => announcement.remove(), 1000)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  // Focus trap
  useEffect(() => {
    if (!open) return
    const focusableElements = overlayRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = focusableElements?.[0] as HTMLElement
    const lastElement = focusableElements?.[focusableElements.length - 1] as HTMLElement

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (!firstElement || !lastElement) return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    window.addEventListener('keydown', handleTab)
    // Focus the close button initially
    setTimeout(() => firstElement?.focus(), 100)

    return () => window.removeEventListener('keydown', handleTab)
  }, [open])

  // Restore focus on close
  useEffect(() => {
    if (!open && previousFocusRef.current) {
      previousFocusRef.current.focus()
    }
  }, [open])

  // Split categories into 2 columns
  const leftColumn = SHORTCUT_CATEGORIES.slice(0, 2)
  const rightColumn = SHORTCUT_CATEGORIES.slice(2)

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard Shortcuts"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            ref={overlayRef}
            className="relative w-full max-w-3xl mx-4 rounded-2xl border border-rain-border overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(18,20,26,0.95) 0%, rgba(25,28,38,0.95) 100%)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(170,255,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-rain-border bg-rain-surface/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center">
                  <Keyboard className="w-5 h-5 text-rain-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
                  <p className="text-xs text-muted-foreground font-mono">RAIN V6 Studio</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-rain-surface-3 transition-colors text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-rain-accent/50"
                aria-label="Close keyboard shortcuts"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body — 2-column grid */}
            <div className="px-6 py-5 max-h-[65vh] overflow-y-auto rain-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left column */}
                <div className="space-y-6">
                  {leftColumn.map((cat) => (
                    <CategorySection key={cat.name} category={cat} />
                  ))}
                </div>

                {/* Right column */}
                <div className="space-y-6">
                  {rightColumn.map((cat) => (
                    <CategorySection key={cat.name} category={cat} />
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-rain-border bg-rain-surface/30 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-mono">
                Shortcuts are disabled while typing in input fields
              </span>
              <div className="flex items-center gap-2">
                <Kbd>Esc</Kbd>
                <span className="text-xs text-muted-foreground">to close</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}