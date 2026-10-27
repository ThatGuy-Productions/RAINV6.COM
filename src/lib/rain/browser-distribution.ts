/**
 * Shared contracts for browser-based distributor delivery.
 *
 * These types describe the integration boundary only; they do not imply
 * that a provider's website automation has passed live acceptance testing.
 */
export interface BrowserAutomationConfig {
  browserType?: 'chromium' | 'chrome' | 'edge'
  headless?: boolean
  credentials?: { email: string; password: string }
  packagePath: string
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
  timeouts?: { navigation?: number; upload?: number; form?: number }
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
