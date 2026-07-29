'use client'

import { motion } from 'framer-motion'
import { Disc3, Volume2 } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'

/**
 * A/B Comparison Toggle — allows users to switch between original and mastered audio.
 * Rendered in the mastering tab, visible only when audio has been processed.
 * Provides instant switching with visual feedback showing which version is active.
 *
 * NOTE: The 'C' keyboard shortcut is handled by MasteringTab (toggles the
 * BeforeAfterOverlay). We intentionally do NOT also listen for 'rain:compare'
 * here — doing so would both open the overlay AND flip the audio mode
 * simultaneously, which was a bug.
 */

export function ABComparisonToggle() {
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const isPlaying = useSessionStore((s) => s.isPlaying)
  const abMode = useSessionStore((s) => s.abMode)
  const setAbMode = useSessionStore((s) => s.setAbMode)

  // Sync audio engine preview mode with store abMode
  const handleModeChange = (mode: 'original' | 'mastered') => {
    setAbMode(mode)
    // Map store mode to engine previewMode: 'original' → 'A', 'mastered' → 'B'
    const engineMode = mode === 'original' ? 'A' : 'B'
    audioEngine.setPreviewMode(engineMode)
  }

  // Only show when audio has been processed
  if (!hasProcessed) return null

  return (
    <div className="rain-panel rounded-lg p-3 flex items-center justify-between">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-rain-accent" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          A/B Preview
        </span>
      </div>

      {/* Toggle buttons */}
      <div className="flex items-center gap-1 relative">
        {/* Original button */}
        <button
          onClick={() => handleModeChange('original')}
          className={`relative px-4 py-2 rounded-md text-xs font-mono font-bold uppercase tracking-wider transition-all duration-200 ${
            abMode === 'original'
              ? 'bg-orange-500/90 text-white shadow-[0_0_12px_rgba(249,115,22,0.3)]'
              : 'bg-rain-surface-2 text-muted-foreground hover:text-foreground hover:bg-rain-surface-3'
          }`}
          aria-label="Switch to original audio"
          aria-pressed={abMode === 'original'}
        >
          Original
          {/* Animated indicator when playing original */}
          {abMode === 'original' && isPlaying && (
            <motion.div
              className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-orange-400"
              initial={{ scale: 0.8, opacity: 0.5 }}
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-rain-border" />

        {/* Mastered button */}
        <button
          onClick={() => handleModeChange('mastered')}
          className={`relative px-4 py-2 rounded-md text-xs font-mono font-bold uppercase tracking-wider transition-all duration-200 ${
            abMode === 'mastered'
              ? 'bg-rain-accent text-black shadow-[0_0_12px_rgba(170,255,0,0.3)]'
              : 'bg-rain-surface-2 text-muted-foreground hover:text-foreground hover:bg-rain-surface-3'
          }`}
          aria-label="Switch to mastered audio"
          aria-pressed={abMode === 'mastered'}
        >
          Mastered
          {/* Animated indicator when playing mastered */}
          {abMode === 'mastered' && isPlaying && (
            <motion.div
              className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-rain-accent"
              initial={{ scale: 0.8, opacity: 0.5 }}
              animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </button>
      </div>

      {/* Playing indicator */}
      {isPlaying && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1.5"
        >
          <Disc3 className="w-3.5 h-3.5 animate-spin text-rain-accent" />
          <span className="text-[9px] font-mono text-muted-foreground">
            {abMode === 'original' ? 'Playing original' : 'Playing mastered'}
          </span>
        </motion.div>
      )}
    </div>
  )
}