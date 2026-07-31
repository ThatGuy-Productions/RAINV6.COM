/**
 * RAIN V6 — Browser Automation Distribution Types
 *
 * Shared type definitions for browser-based distribution delivery.
 * Used by distrokid-pricing.ts and distrokid-delivery.ts.
 */

export interface BrowserAutomationConfig {
  /** Which browser to launch. Default: system Chromium (Playwright-managed). */
  browserType?: 'chromium' | 'chrome' | 'edge'
  /** Run headless (no visible window). Default: true. */
  headless?: boolean
  /** DistroKid account credentials (optional — user can log in manually). */
  credentials?: {
    email: string
    password: string
  }
  /** Path to downloaded DDEX ZIP file to upload. */
  packagePath: string
  /** Release metadata for form filling. */
  metadata: {
    title: string
    artist: string
    album?: string
    genre: string
    isrc: string
    upc: string
    releaseDate: string
    explicitLyrics?: 'none' | 'explicit' | 'clean'
    artworkPath?: string
    language?: string
    label?: string
  }
  /** Maximum timeouts per step (ms). */
  timeouts?: {
    navigation?: number
    upload?: number
    form?: number
  }
}

export interface BrowserStepResult {
  step: string
  ok: boolean
  screenshotBase64?: string
  error?: string
  durationMs: number
}

export interface BrowserDeliveryResult {
  ok: boolean
  aggregator: string
  steps: BrowserStepResult[]
  confirmationUrl?: string
  confirmationScreenshot?: string
  error?: string
  totalDurationMs: number
}
