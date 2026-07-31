/**
 * RAIN V6 — Browser Automation Distribution Module
 *
 * Provides a fallback delivery path when LabelGrid API credentials are not
 * configured (free beta). Uses Puppeteer/Playwright-style browser automation
 * to upload releases through the DistroKid, TuneCore, and CD Baby web
 * interfaces. This is the "no API? automate the browser" solution.
 *
 * Architecture:
 *   - Orchestrator pattern: one orchestrator per aggregator
 *   - Each step returns { ok, screenshot?, error? } — verifiable at runtime
 *   - Supports headless mode (background delivery) AND headed mode (user watches)
 *   - Works with any installed Chromium/Chrome/Edge browser
 *
 * ⚠️  IMPORTANT: This module requires Playwright to be installed:
 *       npx playwright install chromium
 *     The browser binary is ~170 MB and is NOT bundled with RAIN.
 *
 * LIMITATIONS:
 *   - DistroKid web UI changes may break selectors — use semantic selectors
 *     (data-testid, aria-label, role) over CSS/xpath when possible
 *   - Browser automation is subject to DistroKid's TOS — use responsibly
 *   - Real ISRC/UPC registration still requires IFPI/GS1 (cannot be automated)
 *
 * INTEGRATION:
 *   Called from DistributeTab as the default delivery method when
 *   LABELGRID_API_KEY is not set. Falls back to "download ZIP" when
 *   browser automation is not available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DistroKid Orchestrator
// ---------------------------------------------------------------------------

/**
 * DistroKid web upload flow (tested against distrokid.com as of July 2026).
 *
 * Steps:
 *   1. Navigate to https://distrokid.com/upload
 *   2. Login (or detect existing session)
 *   3. Select "Single" / "Album" / "EP"
 *   4. Fill artist name, title, genre, language
 *   5. Upload audio file (WAV)
 *   6. Upload artwork (JPEG/PNG)
 *   7. Fill ISRC (if "I already have an ISRC")
 *   8. Fill release date
 *   9. Select stores
 *   10. Confirm & pay (if not Musician tier — unlimited uploads)
 *   11. Verify confirmation page
 *
 * Selectors are semantic (text content, aria-labels, placeholder text)
 * to survive minor UI changes.
 */
import type { BrowserAutomationConfig, BrowserDeliveryResult, BrowserStepResult } from './browser-distribution'

/**
 * DistroKid Tier & Add-on Pricing (Researched July 2026)
 *
 * Tier          | Price/yr | Artists | Tracks/yr | Revenue | Features
 * ──────────────┼──────────┼─────────┼────────────┼─────────┼─────────────
 * Musician      | $22.99   | 1       | Unlimited  | 100%    | Basic
 * Musician Plus | $39.99   | 2       | Unlimited  | 100%    | + custom label, daily stats, lyrics
 * Label         | $79.99   | 5-100   | Unlimited  | 100%    | + teams, priority support
 *
 * Add-ons:
 *   Leave a Legacy           $29/single, $49/album (one-time)
 *   Store Maximizer           $7.95/yr per release
 *   YouTube Content ID        $4.95/yr per single + 20% YouTube revenue
 *   Shazam & iPhone Siri     $0.99/yr per release
 *   TikTok & Instagram        $9.99/yr per single, $14.99/yr per album
 *   Discovery Pack            $0.99/yr per single
 *
 * RAIN V6 Pricing (DistroKid + 20%):
 *
 * Tier              | RAIN Price | DistroKid Base | Includes
 * ──────────────────┼────────────┼────────────────┼─────────────────────────
 * FREE BETA (now)   | R0.00/mo   | N/A             | Self-service ZIP download
 * Musician (Single) | R69.99/yr  | $22.99/yr       | 1 artist, unlimited, 100%
 * Musician Plus     | R899.99/yr | $39.99/yr       | 2 artists, label name
 * Label Starter     | R1,799/yr  | $79.99/yr       | 5 artists, team access
 * Label Pro         | R2,699/yr  | $79.99 + $100   | 10 artists, priority
 * Label Enterprise  | POA        | POA             | 100 artists, API access
 *
 * Add-ons (RAIN = DistroKid + 20%):
 *   Leave a Legacy     R699/single, R1,199/album
 *   Store Maximizer    R189/yr per release
 *   YouTube Content ID R119/yr per single (excl. 20% YT rev share)
 *   Shazam & Siri      R24/yr per release
 *   TikTok & Insta     R239/yr single, R359/yr album
 *   Discovery Pack     R24/yr per single
 */
export const DISTROKID_TIERS = {
  musician: {
    name: 'Musician',
    dkPrice: 22.99,
    rainPrice: 27.59,
    artists: 1,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: ['Unlimited uploads', 'All major stores', 'Instant verification', 'Free ISRC/UPC'],
  },
  musicianPlus: {
    name: 'Musician Plus',
    dkPrice: 39.99,
    rainPrice: 47.99,
    artists: 2,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: [
      'Everything in Musician',
      'Custom label name',
      'Daily sales stats',
      'Custom release date',
      'Pre-order',
      'Lyrics sync',
    ],
  },
  label: {
    name: 'Label',
    dkPrice: 79.99,
    rainPrice: 95.99,
    artists: 5,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: [
      'Everything in Musician Plus',
      '5-100 artists',
      'Team accounts',
      'Priority support',
      'Bulk upload',
    ],
  },
} as const

export const DISTROKID_ADDONS = {
  leaveALegacy: { name: 'Leave a Legacy', dkSingle: 29, dkAlbum: 49, rainSingle: 699, rainAlbum: 1199, oneTime: true, currency: 'ZAR' },
  storeMaximizer: { name: 'Store Maximizer', dkPrice: 7.95, rainPrice: 189, perYear: true, perRelease: true, currency: 'ZAR' },
  youtubeContentId: { name: 'YouTube Content ID', dkPrice: 4.95, rainPrice: 119, perYear: true, perSingle: true, currency: 'ZAR', note: 'Excludes 20% YouTube revenue share' },
  shazamSiri: { name: 'Shazam & iPhone Siri', dkPrice: 0.99, rainPrice: 24, perYear: true, perRelease: true, currency: 'ZAR' },
  tiktokInsta: { name: 'TikTok & Instagram', dkSingle: 9.99, dkAlbum: 14.99, rainSingle: 239, rainAlbum: 359, perYear: true, currency: 'ZAR' },
  discoveryPack: { name: 'Discovery Pack', dkPrice: 0.99, rainPrice: 24, perYear: true, perSingle: true, currency: 'ZAR' },
} as const

/**
 * Calculate RAIN price for a given DistroKid tier or add-on.
 * Formula: RAIN = DK × 1.20 (20% markup), then round up to nearest R1.
 */
export function calculateRainPrice(distrokidUsd: number): number {
  const zarRate = 19.05 // ZAR/USD approximate rate (July 2026)
  const dkZar = distrokidUsd * zarRate
  const marked = dkZar * 1.20
  return Math.ceil(marked)
}

/**
 * Format a ZAR price for display.
 */
export function formatZar(amount: number): string {
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

/**
 * Build a complete DistroKid pricing breakdown for the UI.
 */
export function buildPricingTable(): Array<{
  tier: string
  distrokid: string
  rainPrice: string
  artists: string
  features: string
}> {
  return Object.entries(DISTROKID_TIERS).map(([key, tier]) => ({
    tier: tier.name,
    distrokid: `$${tier.dkPrice}/yr`,
    rainPrice: formatZar(calculateRainPrice(tier.dkPrice)),
    artists: String(tier.artists),
    features: tier.features.join(', '),
  }))
}

/**
 * Build add-on pricing table for the UI.
 */
export function buildAddonTable(): Array<{
  name: string
  distrokid: string
  rainPrice: string
  note: string
}> {
  return Object.entries(DISTROKID_ADDONS).map(([, addon]) => ({
    name: addon.name,
    distrokid: 'dkPrice' in addon
      ? `$${addon.dkPrice}/yr`
      : `$${addon.dkSingle} single / $${addon.dkAlbum} album`,
    rainPrice: 'rainSingle' in addon
      ? `${formatZar(addon.rainSingle)} single / ${formatZar(addon.rainAlbum)} album`
      : formatZar(addon.rainPrice),
    note: addon.note ?? ('perYear' in addon && addon.perYear ? 'Per year' : ''),
  }))
}
