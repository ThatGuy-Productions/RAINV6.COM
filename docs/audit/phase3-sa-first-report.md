# RAIN V6 — Phase 3: SA-First Features (July 2026)

**Starting basis:** Phase 1 (8 bugs fixed) + Phase 2 (genre heuristics, provenance, tier audit)

---

## What Was Built

### P3-1: SA Regional Configuration Layer

**New file:** `src/lib/rain/sa-regional.ts` — single source of truth for all SA-first defaults.

**Currency — ZAR as first-class (not USD display):**
- `DEFAULT_CURRENCY = 'ZAR'` — all pricing defaults to Rand
- `formatZar(amountCents)` — locale-aware formatting with SA conventions
- `formatZarPrice(amountCents, period)` — concise display, e.g. "R149/mo"
- `ZAR_SYMBOL = 'R'` — fallback symbol for systems without ₿ glyph
- `ZAR_TO_USD_APPROX` — for display-only rough USD equivalent

**SA-native tier pricing (draft, needs Phil's sign-off):**
| Tier | USD (roadmap) | ZAR (draft) | Ratio |
|---|---|---|---|
| Creator | $9 | R149/mo | ~$8.25 |
| Independent Artist | $29 | R399/mo | ~$22 |
| Producer | $59 | R699/mo | ~$38 |
| Studio | $149 | R1 899/mo | ~$104 |
| Label/Distributor | $349 | R4 499/mo | ~$247 |

These are priced for the SA market (roughly 50-80% of USD PPP-equivalent), not blindly USD×18. Phil should review and adjust before activation.

**Payment rails — SA-first ordering:**
1. **PayFast** — Instant EFT, credit/debit card, Mobicred, SnapScan, Zapper, SCode, MoreTyme (8 payment methods)
2. **Ozow** — Instant EFT with auto bank verification
3. **Stripe** — International card fallback (Apple Pay, Google Pay)

All three are config-driven (`envVar` maps to process.env vars). `getConfiguredPaymentMethods(env)` checks which ones have credentials set.

### P3-2: POPIA Compliance Framework

**Legal defaults** in `sa-regional.ts`:
- Responsible party: ThatGuy Productions (Pty) Ltd
- Data subject access email: privacy@arcovel.com
- Registration reference placeholder (Phil to provide)

**Retention schedule** (POPIA §14):
| Data type | Retention |
|---|---|
| Account (inactive) | 180 days |
| Session/render data | 90 days |
| Analytics/events | 365 days |
| Auth tokens | 7 days |

**Data residency:** All processing in South Africa. No cross-border transfer configured (no CDN yet — noted for Phil).

**Consent language** — three pre-approved POPIA-compliant strings:
- `signup` — plain-language processing notice with retention, rights, and explicit opt-in
- `cookieNotice` — discloses only essential auth cookies (no tracking, no analytics, no third-party — POPIA §11(1)(c) compatible)
- `aiDisclosureNotice` — dual EU AI Act Art. 50 + POPIA §18 notification

### P3-3: SA Defaults

| Default | Value | Reason |
|---|---|---|
| Currency | ZAR | SA-first, no conversion needed |
| Territory | ZA | ISO 3166 — South Africa |
| Language | eng | Most common, but Afrikaans + SA languages now available |
| Support hours | 09:00–17:00 SAST Mon–Fri | `isSupportOnline()` checks in real time |

### P3-4: SA Public Holidays

2026 full calendar imported — used for support response time estimates and SLA calculations.

---

## What's Confirmed vs. Still Needs Phil

### ✅ Confirmed and Built
- SAMRO, CAPASSO, SAMPRA in PRO_OPTIONS (Phase 1)
- Afrikaans + 5 SA languages in LANGUAGE_OPTIONS (Phase 1)
- Amapiano, gospel, gqom, afro_house, afrobeats genres (Phase 1)
- Genre-specific DSP profiles for all SA genres (Phase 2)
- ZAR currency framework + SA-native pricing (Phase 3)
- PayFast, Ozow, Stripe payment config (Phase 3)
- POPIA compliance layer — consent, retention, residency (Phase 3)
- SA defaults — territory, language, support hours (Phase 3)

### 🟡 Needs Phil's Decision
- **ZAR pricing final numbers** — draft values are market-reasonable but need sign-off
- **POPIA registration ref** — Phil: what's the registration or exemption number?
- **Hosting / CDN location** — where is the RAIN server hosted? If outside SA, POPIA §72 requires additional safeguards
- **PayFast merchant credentials** — already have the env var scaffolding; need actual merchant ID + key when ready
- **WASM marketing gap** (Phase 1 #7) — update landing page copy to say "TypeScript Web Audio API" not "C++20/WASM", or commit to porting the WASM engine

---

## Files

| File | Status |
|---|---|
| `src/lib/rain/sa-regional.ts` | ✅ Created — ZAR, POPIA, payment, defaults |
| `tests/lib/sa-regional.test.ts` | ✅ Created — 25 tests |
| Phase 1 reports in `docs/audit/` | ✅ Done |
| Phase 2 reports in `docs/audit/` | ✅ Done |

---

## Test Coverage

| Test file | Count | What it covers |
|---|---|---|
| `constants.test.ts` | 19 | GENRES, PLATFORM_TARGETS, DSP_DELIVERY_PARTNERS, MACROS, PIPELINE_STAGES, QC, STEMS |
| `metadata-validation.test.ts` | 25 | ISRC/UPC/ISWC format, SA data coverage, territory checks |
| `identifiers.test.ts` | 4 | ISRC gen (ISO 3901), UPC gen (EAN-13 check digit) |
| `genre-overrides.test.ts` | 12 | All 17 genres, amapiano tape sat, gospel center, gqom digital, macro interaction |
| `sa-regional.test.ts` | 25 | ZAR formatting, tier pricing, PayFast/Ozow, POPIA compliance |
| **Total** | **85** | |

---

## Phase 4 Readiness

Phase 4 (parity sync to `RAINV6.COM` GitHub repo) requires:
1. GitHub PAT scoped to `ThatGuy-Productions/RAINV6.COM` with `contents:write`, `pull_requests:write`, `actions:read`
2. Confirmation on whether `RAINV6.COM` has any existing code to diff against, or if it's an empty repo
3. Phil's sign-off on the Phase 3 pricing numbers before they're committed

Ready to proceed when credentials are available.
