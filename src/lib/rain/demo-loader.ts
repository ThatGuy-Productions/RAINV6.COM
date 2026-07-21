'use client'

/**
 * RAIN V6 — Demo Track Loader
 *
 * Utility for loading the pre-generated demo sample into the mastering pipeline.
 * The demo track is designed to showcase the mastering effect:
 * - Peak ~-4dB (should be limited to -1dB TP)
 * - LUFS ~-8 (should be mastered to -14)
 * - Unbalanced spectrum (too much bass, weak highs)
 * - 30 seconds: 80Hz drone, 440→880Hz sweep, noise burst at 10-12s
 */

import { audioEngine } from './audio-engine'
import { useSessionStore } from './store'
import { notifySuccess, notifyInfo, notifyError } from './notifications'
import type { MacroValues } from './types'

/**
 * Recommended macro values for the demo track (brighten, warmth, width).
 * AUDIT2-1 FIX: macros use a 0–10 scale, not 0–1. Previous 0.35 meant
 * 3.5% of full range — essentially OFF. Toast lied "Recommended macros applied".
 */
export const DEMO_RECOMMENDED_MACROS: MacroValues = {
  brighten: 3.5,   // Boost high frequencies (demo is weak in highs)
  glue: 2.5,       // Light compression for cohesion
  width: 4.0,      // Enhance stereo width
  punch: 2.0,      // Add transient punch
  warmth: 3.0,     // Add warmth to counter brighten
  space: 1.5,      // Subtle reverb/ambiance
  repair: 1.0,     // Minimal repair (demo has intentional imperfections)
}

/** Demo track metadata. */
export const DEMO_TRACK_NAME = 'Demo Track (rain-demo.wav)'
export const DEMO_FILE_PATH = '/demo-sample.wav'

/**
 * Load the demo sample into the mastering pipeline.
 *
 * @returns Promise<boolean> — true if loaded successfully, false if failed
 */
export async function loadDemoTrack(): Promise<boolean> {
  const store = useSessionStore.getState()

  try {
    // Fetch the demo file from public directory
    const response = await fetch(DEMO_FILE_PATH)
    if (!response.ok) {
      throw new Error(`Failed to fetch demo sample: ${response.status}`)
    }

    // Get the ArrayBuffer
    const arrayBuffer = await response.arrayBuffer()

    // Load into audio engine
    const { analysis, duration, sampleRate, channels } = await audioEngine.loadFile(arrayBuffer)

    // Update store with demo track info
    store.setFileInfo(DEMO_TRACK_NAME, duration, sampleRate, 16, channels)
    store.setInputAnalysis(analysis)
    store.setIsDemo(true)
    store.resetProcessing()

    // Auto-fill metadata
    store.setMetadata({
      title: 'Demo Track',
      artist: 'RAIN V6 Demo',
    })

    // Set recommended macros for the demo track
    store.setMacros(DEMO_RECOMMENDED_MACROS)
    store.setMacroSource('HEURISTIC', 85)

    // Show toast notification
    notifySuccess('Demo track loaded', 'Click "Run 16-Stage Master" to hear mastering')
    notifyInfo('Recommended macros applied', 'Brighten · Width · Warmth')

    return true
  } catch (error) {
    console.error('[RAIN demo-loader] Error loading demo track:', error)
    // P1 FIX: previously the catch only logged to the console and returned
    // false — the caller (MasteringTab.handleLoadDemo) ignored the return
    // value, so a missing /demo-sample.wav or a decode failure produced NO
    // user-visible feedback. The "Try Demo Track" button would just stop
    // spinning and the user had no idea why. Surface a real toast error so
    // the failure is honestly disclosed (per the "NO silent failure" clause
    // of the directive).
    const reason = error instanceof Error ? error.message : 'Unknown error'
    notifyError(
      'Demo track failed to load',
      `Could not load ${DEMO_FILE_PATH}. ${reason}`,
    )
    return false
  }
}

/**
 * Hook-style wrapper for React components.
 * Returns a function to trigger demo load.
 */
export function useDemoLoader() {
  return loadDemoTrack
}