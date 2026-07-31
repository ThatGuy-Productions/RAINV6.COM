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

import type { BrowserAutomationConfig, BrowserDeliveryResult, BrowserStepResult } from './browser-distribution'

// Re-export types for consumers that import from this module
export type { BrowserAutomationConfig, BrowserDeliveryResult, BrowserStepResult }

/**
 * DistroKid Tier & Add-on Pricing (Researched July 2026 from distrokid.com/pricing/)
 *
 * ZAR prices scraped directly from the page (geolocated ZA).
 * All tiers: 100% royalty retention, 150+ stores, unlimited uploads.
 *
 * Tier              | ZAR/yr    | Artists  | Key Differentiator
 * ──────────────────┼───────────┼──────────┼─────────────────────────────
 * Musician          | R459.99   | 1        | Fast release essentials
 * Musician Plus ⭐   | R826.99   | 2        | Custom label name + date
 * Ultimate 🏆       | R1,649.00 | 1-100    | Advanced analytics + teams
 *
 * Add-ons (historical USD — verified via DistroKid support docs):
 *   Leave a Legacy      $29 single / $49 album (one-time)
 *   Store Maximizer     $7.95/yr per release
 *   YouTube Content ID  $4.95/yr single / $14.95/yr album (+20% YT rev)
 *   Shazam & Siri       $0.99/yr per release
 *   Discovery Pack      $0.99/yr per release
 *
 * RAIN V6 Pricing = DistroKid + 20% markup:
 *
 * Tier              | RAIN Price  | DK Base    | Includes
 * ──────────────────┼─────────────┼────────────┼─────────────────────────
 * FREE BETA (now)   | R0.00       | N/A        | ZIP download only
 * Musician          | R551.99/yr  | R459.99/yr | 1 artist, unlimited, 100%
 * Musician Plus ⭐   | R992.39/yr  | R826.99/yr | 2 artists, label name
 * Ultimate 🏆       | R1,978.80/yr| R1,649/yr  | 5-100 artists, analytics
 */
export const DISTROKID_TIERS = {
  musician: {
    name: 'Musician',
    dkPriceZar: 459.99,
    rainPriceZar: 551.99, // DK + 20%
    artists: 1,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: ['Unlimited uploads', '150+ stores', 'Spotify artist profile', 'Royalty splits', 'Free ISRC/UPC'],
  },
  musicianPlus: {
    name: 'Musician Plus',
    dkPriceZar: 826.99,
    rainPriceZar: 992.39, // DK + 20%
    artists: 2,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: [
      'Everything in Musician',
      'Custom label name',
      'Custom release date + preorder',
      'Daily streaming stats',
      'Synced lyrics in Apple Music',
      'Custom iTunes pricing',
    ],
  },
  ultimate: {
    name: 'Ultimate',
    dkPriceZar: 1649.00,
    rainPriceZar: 1978.80, // DK + 20%
    artists: 100,
    tracksPerYear: Infinity,
    revenueShare: 100,
    features: [
      'Everything in Musician Plus',
      '1-100 artists',
      'Advanced analytics',
      'Playlist contact search',
      'Replace song audio',
      '1,000 GB file sharing',
      'Spotify & Apple Music monitoring',
      '21 extra tools',
    ],
  },
} as const

export const DISTROKID_ADDONS = {
  leaveALegacy: { name: 'Leave a Legacy', dkSingle: 29, dkAlbum: 49, rainSingle: 699, rainAlbum: 1199, oneTime: true, currency: 'ZAR', note: 'One-time payment — track stays live forever even if subscription ends' },
  storeMaximizer: { name: 'Store Maximizer', dkPrice: 7.95, rainPrice: 189, perYear: true, perRelease: true, currency: 'ZAR', note: 'Adds stores not in the standard 150+ list' },
  youtubeContentId: { name: 'YouTube Content ID', dkPrice: 4.95, rainPrice: 119, perYear: true, perSingle: true, currency: 'ZAR', note: 'Excludes 20% YouTube Content ID revenue share' },
  shazamSiri: { name: 'Shazam & iPhone Siri', dkPrice: 0.99, rainPrice: 24, perYear: true, perRelease: true, currency: 'ZAR' },
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
  return Object.entries(DISTROKID_TIERS).map(([_key, tier]) => ({
    tier: tier.name,
    distrokid: `${formatZar(tier.dkPriceZar)}/yr`,
    rainPrice: formatZar(tier.rainPriceZar),
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
    note: 'note' in addon ? addon.note : ('perYear' in addon && addon.perYear ? 'Per year' : ''),
  }))
}
