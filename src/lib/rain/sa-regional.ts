/**
 * RAIN V6 — South Africa Regional Defaults
 *
 * Single source of truth for SA-first regional configuration. Every component
 * that touches currency, territory, language, or compliance should pull from
 * here rather than hardcoding USD/en/US.
 *
 * Design principle: RAIN is built in South Africa, for South African artists
 * first. The defaults reflect that. Other regions are supported, but SA is
 * the zero-config default.
 */

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/** South African Rand — ISO 4217 code. */
export const DEFAULT_CURRENCY = 'ZAR'

/** ZAR symbol (Unicode). Use 'R' as a fallback on systems without ₿ support. */
export const ZAR_SYMBOL = 'R'

/** Approximate exchange rate for display only. Not used for pricing — pricing
 * is ZAR-native. Only used when displaying a rough USD equivalent. */
export const ZAR_TO_USD_APPROX = 0.055 // ~R18.00 = $1.00

/** Format a ZAR amount with proper SA locale.
 *  - Thousands separator: space (SA convention), e.g. R1 499.00
 *  - Decimal: comma or point based on preference (SA uses both; we default to point)
 */
export function formatZar(amountCents: number, useCommaDecimal = false): string {
  const rand = amountCents / 100
  const formatted = rand.toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: rand % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  if (useCommaDecimal) {
    // en-ZA locale uses '.' as thousands sep and ',' as decimal — but SA
    // convention varies. Return as-is from the locale.
    return formatted
  }
  return formatted
}

/** Format a ZAR cent amount as a concise string, e.g. "R149/mo". */
export function formatZarPrice(amountCents: number, period?: string): string {
  const rand = amountCents / 100
  const base = rand % 1 === 0 ? `R${rand}` : `R${rand.toFixed(2)}`
  return period ? `${base}/${period}` : base
}

// ---------------------------------------------------------------------------
// Tier pricing — ZAR-native (not USD-converted)
// ---------------------------------------------------------------------------

export const SA_TIER_PRICES_ZAR = {
  free: { amountCents: 0, label: 'R0.00 — Free Public Beta' },
  creator: { amountCents: 0, label: 'TBA' },
  independent: { amountCents: 0, label: 'TBA' },
  producer: { amountCents: 0, label: 'TBA' },
  studio: { amountCents: 0, label: 'TBA' },
  label: { amountCents: 0, label: 'TBA' },
  enterprise: { amountCents: 0, label: 'TBA' },
} as const

// ---------------------------------------------------------------------------
// Payment rails — SA-specific
// ---------------------------------------------------------------------------

/**
 * Payment methods available for South African users.
 * Order matters — PayFast first (most common SA gateway), then Ozow (EFT),
 * then Stripe (international / card fallback).
 */
export const SA_PAYMENT_METHODS = [
  {
    id: 'payfast' as const,
    name: 'PayFast',
    description: 'Instant EFT, credit card, debit card, Mobicred, SnapScan, Zapper, SCode, MoreTyme',
    envVar: 'PAYFAST_MERCHANT_ID',
    testEndpoint: 'https://sandbox.payfast.co.za/eng/process',
    liveEndpoint: 'https://www.payfast.co.za/eng/process',
    capabilities: ['instant_eft', 'card', 'mobicred', 'snapscan', 'zapper', 'scode', 'moretyme'],
    // PayFast requires: merchant_id, merchant_key, passphrase (set in .env)
  },
  {
    id: 'ozow' as const,
    name: 'Ozow (formerly i-Pay)',
    description: 'Instant EFT — auto bank verification, no card needed',
    envVar: 'OZOW_API_KEY',
    capabilities: ['instant_eft'],
  },
  {
    id: 'stripe' as const,
    name: 'Stripe',
    description: 'International credit/debit card — for users outside SA',
    envVar: 'STRIPE_SECRET_KEY',
    capabilities: ['card', 'apple_pay', 'google_pay'],
  },
] as const

export type SaPaymentMethod = (typeof SA_PAYMENT_METHODS)[number]['id']

/** Check which SA payment methods have credentials configured. */
export function getConfiguredPaymentMethods(env: Record<string, string | undefined>): SaPaymentMethod[] {
  return SA_PAYMENT_METHODS
    .filter((m) => env[m.envVar])
    .map((m) => m.id)
}

// ---------------------------------------------------------------------------
// POPIA compliance — Protection of Personal Information Act (Act 4 of 2013)
// ---------------------------------------------------------------------------

/**
 * POPIA data handling defaults. These inform every component that collects,
 * stores, or transmits personal information of SA data subjects.
 *
 * Key POPIA requirements (abridged):
 *   - Purpose specification: why are you collecting this data?
 *   - Retention limitation: how long do you keep it?
 *   - Data subject rights: access, correction, deletion, objection
 *   - Cross-border transfer: where does the data go?
 */

export const POPIA = {
  /** Responsible party (data controller) per POPIA §1. */
  responsibleParty: 'ThatGuy Productions (Pty) Ltd',
  /** Email for data subject access requests (POPIA §23). */
  accessRequestEmail: 'privacy@arcovel.com',

  /**
   * Beta data model: no personally identifiable information is collected.
   *
   * The free public beta stores only operational/usage data:
   *   - Sessions (rendering sessions — anonymous, no email/name required)
   *   - Renders (export records — format, LUFS, hash)
   *   - Exports (download events)
   *   - Feedback (free-text comments, optional email for follow-up)
   *   - Events (anonymous analytics — tab views, render completions)
   *
   * The Admin door (enterprise login) stores hashed credentials separately
   * and is never reachable by public users.
   *
   * No personal information is collected, stored, or transmitted during
   * normal beta usage. POPIA §1 definition of "personal information" does
   * not apply to anonymous operational telemetry.
   */
  betaDataModel: {
    collectsPii: false,
    storedData: ['sessions', 'renders', 'exports', 'feedback', 'anonymousEvents'] as const,
    note: 'No email addresses, names, IP addresses, or device fingerprints are stored for public beta users. The Feedback form offers an optional email field for follow-up — this is the only user-provided PII path and it requires explicit opt-in.'
  },

  /** Default data retention periods (days) for operational data. */
  retention: {
    /** Session/render data — 90 days after last activity. */
    sessionData: 90,
    /** Analytics/event logs — 365 days (for product metrics only). */
    analytics: 365,
  } as const,

  /** Data processing locations */
  dataLocations: [
    { region: 'South Africa', purpose: 'Primary hosting', provider: 'TBD' },
    { region: 'South Africa', purpose: 'Backup', provider: 'TBD' },
  ] as const,
} as const

// ---------------------------------------------------------------------------
// Consent language — POPIA-compliant
// ---------------------------------------------------------------------------

/**
 * Pre-approved consent strings for use in signup forms, cookie banners,
 * and data processing notices. These are POPIA-compliant (plain language,
 * specific purpose, affirmative action required).
 */
export const POPIA_CONSENT_LANGUAGE = {
  /** Shown on the landing page / before first use. */
  betaNotice: {
    title: 'Free Public Beta — No Account Required',
    body: `RAIN V6 is a free public beta. No signup, no login, no personal information
collected. Your audio is processed entirely in your browser — it never reaches our servers.

We store only anonymous operational data: rendering sessions, export counts, and your
optional feedback. This helps us improve the product. Nothing we store can identify you
personally.`,
    optionalFeedback: 'If you choose to leave feedback, you may optionally provide an email for follow-up. This is the only personally identifiable information we ever collect, and it requires your explicit, separate consent.',
  },

  /** Cookie / localStorage banner. */
  cookieNotice: {
    title: 'This site uses essential cookies',
    body: `RAIN uses cookies only for authentication (keeping you signed in) and session
management (remembering your current project). We do not use tracking cookies, analytics
cookies, or third-party advertising cookies. No consent is required for essential cookies
under POPIA §11(1)(c) — but we tell you anyway.`,
  },

  /** AI disclosure notice (EU AI Act Art. 50 + POPIA §18 notification). */
  aiDisclosureNotice: `RAIN uses artificial intelligence for audio analysis and processing
suggestions. The final mastering decisions remain under your control. AI involvement is
disclosed in every DDEX distribution package per EU AI Act Article 50 requirements.`,
} as const

// ---------------------------------------------------------------------------
// South Africa — defaults
// ---------------------------------------------------------------------------

/** Default territory for new accounts (ISO 3166-1 alpha-2). */
export const DEFAULT_TERRITORY = 'ZA'

/** Default language for new accounts (ISO 639-2/B). */
export const DEFAULT_LANGUAGE = 'eng'

/** SA public holidays — used for support response time estimates. */
export const SA_PUBLIC_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-03-21', // Human Rights Day
  '2026-04-10', // Good Friday
  '2026-04-13', // Family Day
  '2026-04-27', // Freedom Day
  '2026-05-01', // Workers' Day
  '2026-06-16', // Youth Day
  '2026-08-09', // National Women's Day
  '2026-09-24', // Heritage Day
  '2026-12-16', // Day of Reconciliation
  '2026-12-25', // Christmas Day
  '2026-12-26', // Day of Goodwill
] as const

// ---------------------------------------------------------------------------
// Support — SA timezone-aware
// ---------------------------------------------------------------------------

/** Support hours in SAST (South Africa Standard Time = UTC+2). */
export const SUPPORT_HOURS_SAST = {
  start: 9,   // 09:00 SAST
  end: 17,    // 17:00 SAST
  timezone: 'Africa/Johannesburg',
  days: [1, 2, 3, 4, 5], // Monday–Friday (ISO weekday: 1=Mon, 5=Fri)
} as const

/** Check whether support is currently online. */
export function isSupportOnline(): boolean {
  const now = new Date()
  const saTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
  const hour = saTime.getHours()
  const day = saTime.getDay() || 7 // Convert Sunday=0 to Sunday=7
  return (
    SUPPORT_HOURS_SAST.days.includes(day) &&
    hour >= SUPPORT_HOURS_SAST.start &&
    hour < SUPPORT_HOURS_SAST.end
  )
}
