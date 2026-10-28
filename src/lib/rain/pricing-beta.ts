/**
 * Beta pricing / entitlement copy used by marketing and in-app surfaces.
 * Must stay aligned with beta-entitlement-policy.ts and operator decisions.
 */

export const BETA_PRICING_SUMMARY = {
  slug: 'free',
  name: 'Free Beta',
  priceZar: 0,
  unlockZar: 49,
  period: 'beta stage',
  renders: '2 free full-capability renders (1 export each), then R49 once-off unlock',
  tagline: 'Two free full-capability renders, then a once-off R49 beta unlock',
  accent: '#AAFF00',
  highlight: true,
  features: [
    'Two free full-capability renders; each includes one export',
    'After free allowance: once-off R49.00 ZAR unlock for the beta stage only',
    'Paid beta: 1 500 credits/month (25 per completed render) + max 30 exports/month',
    'Unlock ends when the commercial product launches',
    'Verified beta unlock holders receive a discounted commercial fee at launch',
    'In-browser DSP path — audio stays on device unless a separate feature says otherwise',
    'Server-side entitlement ledger (not localStorage flags)',
    'Checkout disabled until public URL and PayFast live switch are confirmed',
  ],
  notIncludedUntilProven: [
    'Neural 12-stem separation (gated until a verified model is shipped)',
    'Live PayFast charging (blocked until URL confirmation)',
    'Commercial subscription tiers (launch migration)',
  ],
} as const
