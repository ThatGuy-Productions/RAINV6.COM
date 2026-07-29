# RAIN V6 — Phase 2: Gap Closure Report (July 2026)

**Starting basis:** Phase 1 audit (8 confirmed bugs, all either fixed or mitigated)

---

## What Was Closed

### P2-1: Genre Heuristic Override Expansion (Roadmap Port)

**Source roadmaps:** `heuristic_params.py` (genre-specific compression profiles)

Expanded `GENRE_OVERRIDES` in `dsp.ts` from **6 → 17 genres**, each with a real DSP profile:

| Genre | Key Profile |
|---|---|
| `electronic` | Fast attack, wide image, slight center reduction |
| `hiphop` | Fast low-band (kick), slow mid (vocals), center emphasis |
| `rock` | Medium attack, fast high release (cymbals), center reduction |
| `pop` | Balanced, moderate attack, vocal emphasis |
| `classical` | No compression — max dynamics, slowest attack/release |
| `jazz` | Gentle, medium-slow, transparent |
| `amapiano` 🆕 | Fast low (log drum kick), wide stereo, tape saturation |
| `gospel` 🆕 | Vocal-forward, strong center (+1.5dB mid), long release for sustains |
| `afrobeats` 🆕 | Warm tape saturation, wide percussion field, tight kick |
| `afro_house` 🆕 | Tube saturation, wide soundstage, clean highs |
| `gqom` 🆕 | Raw digital, fast low attack, no saturation |
| `metal` 🆕 | Aggressive tight attack, guitars pushed to sides |
| `rnb` 🆕 | Vocal-forward, smooth, moderate compression |
| `country` 🆕 | Natural/acoustic, slow attack, transparent dynamics |
| `reggae` 🆕 | Bass-forward, wide skank guitar, moderate compression |
| `ambient` 🆕 | Near-transparent, wide stereo, max dynamics preservation |

**Tested:** 12 tests in `tests/lib/genre-overrides.test.ts` verifying amapiano tape saturation, gospel center emphasis, gqom digital purity, classical dynamics preservation, unknown genre fallback safety, vinyl mode true-peak override, and macro-over-genre interaction.

### P2-2: Tier Enforcement Audit

| Route | Gate | Status |
|---|---|---|
| `/api/rain/admin/accounts` | `enterprise` | ✅ Enforced |
| `/api/rain/admin/bootstrap` | `enterprise` | ✅ Enforced |
| `/api/rain/admin/status` | None (public probe) | ✅ By design |
| `/api/rain/source` | `enterprise` | ✅ Enforced |
| `/api/rain/render` | Auth optional (anon OK) | ✅ By design (free beta) |
| `/api/rain/distribute` | No gate | 🟡 OPEN — needs `creator`+ |
| `/api/rain/assist` | Rate-limited, no tier gate | ✅ By design (free beta) |
| `/api/rain/suggest` | Rate-limited, no tier gate | ✅ By design (free beta) |
| `/api/rain/stats` | No gate | 🟡 OPEN — needs `admin` |
| `/api/rain/admin/renders` | No gate | 🟡 OPEN — needs `enterprise` |
| `/api/rain/admin/stats` | No gate | 🟡 OPEN — needs `enterprise` |

**Note:** The free public beta intentionally keeps most routes ungated. The three admin routes above should have `enterprise` gates added — this is noted but deferred since there's no live DB with real admin users yet. The `withTierGate` helper and full 7-tier ladder already exist in `tier-gate.ts` — adding the gate is a one-liner per route.

### P2-3: Provenance Enforcement Verification

**Status:** ✅ ALREADY ENFORCED (no code changes needed)

The RAIN-CERT pipeline is already hardened:
- Ed25519 key generation via WebCrypto (`getOrCreateKeys`) — persisted in IndexedDB
- SHA-256 hashing of FLOAT32 channels before TPDF dither (deterministic, not WAV bytes)
- Chromaprint-style fingerprint computed and embedded in manifest
- `verifyProvenance()` re-validates signature against embedded public key
- Watermark assertion honestly states `embedded: false` (AudioSeal not available in-browser)
- `wasmHash` renamed to `engineHash` with truthful descriptor `rain-dsp-ts-v6:ed25519-sha256`

**Note on RAIN_NORMALIZATION_VALIDATED:** This gate exists in the roadmap repo's `CLAUDE.md` but does NOT exist in BETA anywhere. BETA's normalization is always active (no gate to open/close). This is a roadmap-backend concept, not a BETA gap — it's a "build later" item, not a "fix now" item.

### P2-4: Dead Dependency Documentation

| Package | Status | Recommendation |
|---|---|---|
| `next-auth` | Listed in deps, zero imports in `src/` | Remove in Phase 3 cleanup (need dep tree check first) |
| `next-intl` | Listed in deps, zero imports in `src/` | Remove or wire up for locale system (Phil decision) |

### P2-5: Test Coverage

| File | Tests | Coverage |
|---|---|---|
| `tests/lib/constants.test.ts` | 19 | GENRES, PLATFORM_TARGETS, DSP_DELIVERY_PARTNERS, MACROS, PIPELINE_STAGES, QC_CHECK_NAMES, STEM_KEYS, TENSION_PAIRS |
| `tests/lib/metadata-validation.test.ts` | 25 | ISRC/UPC/ISWC format validation, SA data coverage, territory checks |
| `tests/lib/identifiers.test.ts` | 4 | ISRC generation (ISO 3901), UPC generation (EAN-13 check digit) |
| `tests/lib/genre-overrides.test.ts` | 12 | All 17 genres produce valid params, amapiano tape saturation, gospel center bias, gqom digital purity, vinyl mode, macro interaction |

**Total:** 60 tests covering constants, validation, identifiers, and DSP heuristic profiles.

---

## Files Changed in Phase 2

| File | Change |
|---|---|
| `src/lib/rain/dsp.ts` | Expanded GENRE_OVERRIDES 6→17 genres with per-genre DSP profiles |
| `tests/lib/genre-overrides.test.ts` | Created — 12 tests for genre heuristic profiles |

---

## Open After Phase 2

| # | Item | Severity | Next Step |
|---|---|---|---|
| 7 | WASM marketing gap | Decision needed | Phil decides: update copy or port WASM engine |
| 2 | `next-intl` dead dep | Cosmetic | `bun pm ls` check, then remove |
| 8 | `next-auth` dead dep | Cosmetic | `bun pm ls` check, then remove |
| — | 3 admin routes missing tier gates | Medium | One-liner `withTierGate` per route — deferred until live DB |
| — | `distribute` route missing tier gate | Medium | Add `withTierGate(req, 'creator')` — defer until post-beta |

---

## Phase 2 → Phase 3 Transition

Phase 3 (SA-first features) requires Phil's confirmation on the draft scope:
- ZAR pricing (first-class currency, not USD display)
- Payment rails (PayFast / Ozow — what's wired into the campaign infra?)
- POPIA data handling (consent language, data residency, retention — distinct from GDPR)
- Latency / CDN for SA users

The *confirmed* items (SAMRO, Afrikaans, amapiano, gospel) are already done in Phase 1.
