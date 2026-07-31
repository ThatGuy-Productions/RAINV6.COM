---
title: "RAIN V6 Beta — Payment Terms"
version: "1.0.0-beta"
effective: "2026-07-31"
jurisdiction: "South Africa"
company: "ThatGuy Productions / ARCOVEL Technologies International"
license: "Proprietary"
---

# RAIN V6 Beta — Payment Terms

**Effective Date:** 31 July 2026

**Last Updated:** 31 July 2026

## 1. Overview

These Payment Terms govern the pricing, payment, and billing aspects of RAIN V6 Beta ("RAIN," "the Service"), operated by **ThatGuy Productions / ARCOVEL Technologies International**. These Payment Terms supplement the RAIN V6 Beta Terms of Service and Privacy Policy.

### 1.1 Contact Information

- **Company:** ThatGuy Productions / ARCOVEL Technologies International
- **Email:** legal@rainv6.com
- **Display Currency:** South African Rand (ZAR)
- **Jurisdiction:** Republic of South Africa

## 2. Beta Phase Pricing

### 2.1 Current Pricing: R0.00

**During the Beta phase, all tiers and features of RAIN V6 are provided at R0.00 (South African Rand).** No payment is required. No payment information is collected. There is no billing whatsoever.

This zero-cost access applies to:

- All processing features (16-stage DSP pipeline)
- All platform targets (27 streaming platforms)
- All export formats (24-bit WAV, 320 kbps MP3)
- All genre presets
- All macro controls
- QC validation (18 checks)
- DDEX ERN 4.3.2 package generation
- RAIN-CERT provenance certificates
- Multi-stem processing
- AI Co-Master suggestions
- DistroKid delivery integration (ZIP download only)

### 2.2 Nature of Beta Pricing

The R0.00 Beta pricing:

- Is temporary and applies only during the Beta phase
- Does not constitute a binding price commitment for any future commercial release
- May end at any time at our sole discretion
- Does not create any contractual right to continued free access
- Is explicitly characterised as a testing and evaluation arrangement

### 2.3 No Price Guarantee

**We make no guarantee, promise, or representation about future pricing.** Beta users may or may not receive preferential pricing upon commercial release. Any future pricing is at our sole discretion.

## 3. Future Payment Methods

### 3.1 Planned Payment Providers

Upon commercial release, RAIN intends to support the following payment methods:

#### South African Methods

| Provider | Type | Description | Status |
|----------|------|-------------|--------|
| **PayFast** | Payment Gateway | South Africa's leading online payment processor; supports credit/debit cards, Instant EFT, Masterpass, Mobicred, SCode, and Bitcoin | Planned |
| **Ozow** | Instant EFT | Real-time bank transfer (EFT) processing for South African bank accounts (FNB, Standard Bank, Absa, Nedbank, Capitec, Investec, TymeBank) | Planned |

#### International Methods

| Provider | Type | Description | Status |
|----------|------|-------------|--------|
| **Stripe** | Payment Gateway | Global payment processing supporting credit/debit cards, Apple Pay, Google Pay, and local payment methods across 135+ currencies | Planned |

### 3.2 Display Currency

All prices will be displayed in **South African Rand (ZAR)** as the primary currency. International users will see approximate conversions at the prevailing exchange rate, but all transactions will be settled in ZAR.

### 3.3 Currency Conversion

Where ZAR-equivalent prices are shown for international users:

- Conversion rates are approximate and for informational purposes only
- Actual transaction amounts are determined by the payment provider at the time of transaction
- Exchange rate fluctuations between display and settlement are the user's responsibility
- Refunds, if any, are processed in ZAR regardless of the user's local currency

## 4. Planned Pricing Tiers

### 4.1 Tier Structure (Future)

The following pricing structure is planned for commercial release. **All prices are provisional and subject to change.**

| Tier | Artists | Price (ZAR/yr) | Key Features |
|------|---------|----------------|--------------|
| Casual | 1 | Free (limited) | Basic mastering, 3 exports/month |
| Creator | 1 | TBD | Unlimited processing, all targets |
| Independent | 1 | TBD | DDEX packages, multi-stem, QC |
| Producer | 5 | TBD | Client management, batch processing |
| Studio | 10 | TBD | Advanced analytics, API access |
| Label | 50 | TBD | White-label, enterprise SSO |
| Enterprise | Unlimited | Custom | Volume pricing, custom integrations |

### 4.2 Tier Gate Implementation

Tier enforcement is handled server-side by the `src/lib/rain/tier-gate.ts` module. Features are gated by tier precedence:

```
casual < creator < independent < producer < studio < label < enterprise
```

During Beta, all tier gates are effectively open — the tier gate module returns `ANONYMOUS_TIER = 'free'` when no authenticated session exists, and all features are accessible at no charge.

## 5. DistroKid Bundled Pricing

### 5.1 Integration Model

RAIN V6 provides direct integration with DistroKid for music distribution. Pricing follows a **DistroKid + 20% markup** model, rounded up to the nearest South African Rand.

### 5.2 DistroKid Tier Pricing (ZAR)

Researched from distrokid.com/pricing/ (geolocated ZA, July 2026):

| DistroKid Tier | DK Price (ZAR/yr) | RAIN Price (ZAR/yr) | Artists | Features |
|----------------|-------------------|---------------------|---------|----------|
| Musician | R459.99 | **R551.99** | 1 | Unlimited uploads, 150+ stores, royalty splits, free ISRC/UPC |
| Musician Plus ⭐ | R826.99 | **R992.39** | 2 | Custom label name, release date, daily stats, synced lyrics |
| Ultimate 🏆 | R1,649.00 | **R1,978.80** | 100 | Advanced analytics, playlist contact search, file sharing, 21 extra tools |

### 5.3 DistroKid Add-on Pricing (ZAR)

| Add-on | DK Price | RAIN Price | Notes |
|--------|----------|------------|-------|
| Leave a Legacy | $29 single / $49 album | R699 single / R1,199 album | One-time; track stays live if subscription ends |
| Store Maximizer | $7.95/yr | R189/yr | Per release |
| YouTube Content ID | $4.95/yr (single) / $14.95/yr (album) | R119/yr (single) | 20% YouTube Content ID revenue share applies |
| Shazam & iPhone Siri | $0.99/yr | R24/yr | Per release |
| Discovery Pack | $0.99/yr | R24/yr | Per release |

### 5.4 Pricing Formula

```typescript
// From src/lib/rain/distrokid-pricing.ts
export function calculateRainPrice(distrokidUsd: number): number {
  const zarRate = 19.05 // ZAR/USD approximate rate (July 2026)
  const dkZar = distrokidUsd * zarRate
  const marked = dkZar * 1.20
  return Math.ceil(marked)
}
```

The 20% markup covers:
- RAIN's DDEX ERN 4.3.2 package generation
- RAIN-CERT provenance certificates
- ISRC/UPC identifier generation
- Pre-submission QC validation against 27 platform targets
- Browser automation delivery (when LabelGrid API not available)
- Customer support for distribution issues

### 5.5 DistroKid Terms

Users are subject to DistroKid's own Terms of Service, Privacy Policy, and pricing in addition to RAIN's terms. DistroKid's terms govern:

- Revenue collection and payouts
- Store relationships
- Content takedowns and disputes
- Royalty splits
- ISRC/UPC registration (when using DistroKid's identifiers)

RAIN does not control and is not responsible for DistroKid's pricing changes, service availability, or business decisions.

### 5.6 Beta Phase: DistroKid Integration

During Beta, the DistroKid integration is limited to:

- **ZIP download only** — RAIN generates a complete DDEX ERN 4.3.2 package for manual upload
- **No direct DistroKid API integration** — LabelGrid API credentials not configured
- **Browser automation fallback** — `src/lib/rain/distrokid-delivery.ts` provides a Playwright-based automated upload flow (requires Playwright installation)

## 6. Payment Isolation Architecture

### 6.1 Per-User Payment Isolation

Upon commercial release, RAIN's payment architecture will ensure complete isolation between users:

- Each user's payment instrument (card, bank account) is tokenised and stored by the payment processor (PayFast/Ozow/Stripe), **not by RAIN**
- RAIN stores only a payment token reference (e.g., `payfast_token_abc123`)
- No cross-contamination: User A's payments are never linked to User B's session
- Each transaction is independently verifiable via the payment processor's reconciliation API

### 6.2 Session Isolation

RAIN V6 uses UUIDv7 session tokens to maintain user session isolation:

```typescript
// From src/lib/rain/anon-id.ts — client-side anonymous ID
// Uses crypto.randomUUID() for RFC 4122 v4 UUID generation
export function getAnonId(): string | null {
  // Generates and caches a per-browser UUID for session attribution
  // Stored in localStorage, never contains PII
}
```

In the commercial release, this client-side anonymous ID will be supplemented with proper authenticated sessions:

```typescript
// From src/lib/rain/tier-gate.ts — authenticated session check
export async function getUserTier(req: NextRequest | null, userId?: string | null): Promise<string> {
  const sessionUser = await getSessionUser(req)
  if (sessionUser) return sessionUser.tier
  return ANONYMOUS_TIER
}
```

### 6.3 No Cross-Contamination

The architecture guarantees:

- Payment processor tokenisation isolates financial data from RAIN's application layer
- UUIDv7 session tokens prevent session hijacking and cross-user state leakage
- Tier resolution via authenticated session (cookie) prevents unauthorised tier escalation
- The legacy `x-user-id` header fallback has been removed (see `tier-gate.ts` security fix C3) to prevent impersonation attacks

## 7. PCI DSS Compliance

### 7.1 Current Status: Not Applicable

During the Beta phase, RAIN does **not** collect, process, store, or transmit any cardholder data. Therefore, PCI DSS compliance is not applicable.

### 7.2 Future PCI DSS Compliance

Upon commercial release, RAIN will:

- **Never store raw card numbers (PAN)** on RAIN servers
- Use **tokenisation** — all card data is captured by and tokenised with the payment processor's secure iframe or hosted payment page
- Maintain **SAQ A** (or **SAQ A-EP** if using a redirect integration) level of PCI DSS compliance
- Engage an **Approved Scanning Vendor (ASV)** for quarterly external vulnerability scans
- Complete an annual **Self-Assessment Questionnaire (SAQ)**
- Implement **TLS 1.2+** for all payment-related traffic
- Maintain a **cardholder data environment (CDE)** diagram documenting data flows

### 7.3 Payment Processor PCI Status

All planned payment processors maintain current PCI DSS compliance certification:

| Provider | PCI Level | Certification |
|----------|-----------|---------------|
| PayFast | Level 1 (PCI DSS v4.0) | Verified — payfast.io |
| Ozow | Level 1 (PCI DSS v4.0) | Verified — ozow.com |
| Stripe | Level 1 (PCI DSS v4.0) | Verified — stripe.com |

## 8. Refund Policy

### 8.1 Beta Phase: No Refunds

As the Service is provided at R0.00 during Beta, the concept of refunds is not applicable. There is nothing to refund.

### 8.2 Future Refund Policy (Provisional)

Upon commercial release, RAIN intends to implement the following refund policy:

| Scenario | Refund Eligibility | Timeframe |
|----------|-------------------|-----------|
| Subscription fees | Pro-rata refund for unused portion | Within 14 days of payment |
| DistroKid pass-through | Per DistroKid's refund policy | Per DistroKid terms |
| Service unavailability | Pro-rata refund for downtime exceeding SLA (if applicable) | Within 30 days |
| Accidental purchase | Full refund | Within 48 hours of payment |
| Feature dissatisfaction | No refund (free Beta allows full evaluation) | N/A |

**This refund policy is provisional and not currently in effect.** It will be formalised before commercial release and communicated to users.

### 8.3 Refund Processing

When refunds are applicable:

- Refunds will be processed through the original payment method
- Processing time depends on the payment provider and the user's financial institution
- Refunds are issued in ZAR; exchange rate fluctuations are the user's responsibility
- Transaction fees (if any) charged by the payment processor are not refundable

## 9. Disputed Charges

### 9.1 Dispute Resolution for Future Payments

If a user disputes a charge after commercial release:

1. Contact RAIN at **legal@rainv6.com** with transaction details
2. RAIN will investigate and respond within 5 business days
3. If the charge was erroneous, RAIN will initiate a refund promptly
4. If the charge was legitimate, RAIN will provide documentation supporting the charge
5. Unresolved disputes may be escalated to the dispute resolution process in the Terms of Service (Section 12)

### 9.2 Chargebacks

If a user initiates a chargeback with their card issuer:

- RAIN will provide transaction evidence to the payment processor
- The user's RAIN account may be suspended pending chargeback resolution
- Excessive chargebacks may result in permanent account termination
- Chargeback fees imposed by the payment processor may be charged to the user's account

## 10. Tax Considerations

### 10.1 South African VAT

RAIN operates in South Africa. Upon commercial release:

- **VAT (Value Added Tax)** at 15% will be applied to all sales to South African customers, unless the customer provides a valid VAT registration number
- VAT-inclusive pricing will be clearly displayed ("RXXX.XX incl. VAT")
- VAT invoices will be issued for all taxable transactions
- VAT registration number will be included on all invoices

### 10.2 International Taxes

For international customers:

- RAIN may be required to collect and remit VAT/GST/HST in certain jurisdictions
- Prices may include applicable local taxes where required by law
- Users are responsible for any customs duties, import taxes, or other levies

### 10.3 Tax Invoices

Upon request, RAIN will provide tax invoices including:

- RAIN's company details (ARCOVEL Technologies International)
- VAT registration number (when applicable)
- Invoice date and number
- Description of services provided
- Amount charged and tax breakdown
- Customer details (as provided)

## 11. Payment Terms for Enterprise Customers

### 11.1 Custom Pricing

Enterprise customers (Label and Enterprise tiers) may negotiate custom pricing arrangements. Contact **legal@rainv6.com** for details.

### 11.2 Invoicing

Enterprise customers on negotiated contracts may be invoiced:

- Monthly or annually, as agreed
- Net-30 payment terms (payment due within 30 days of invoice)
- Late payment interest at the South African prime lending rate + 2%

### 11.3 Volume Discounts

Volume pricing may be available for:

- High-volume mastering (e.g., 100+ tracks per month)
- Multi-seat licenses (e.g., 20+ users)
- White-label deployments
- API access contracts

## 12. Changes to Payment Terms

We reserve the right to update these Payment Terms at any time. Changes will be effective immediately upon posting. For the Beta phase, the primary notification mechanism is an in-application notice on the RAIN V6 interface.

---

**© ThatGuy Productions / ARCOVEL Technologies International. All Rights Reserved.**

**Contact:** legal@rainv6.com | **Jurisdiction:** Republic of South Africa
