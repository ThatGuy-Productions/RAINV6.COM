# R∞N — RAIN V6 Beta

### AI Audio Mastering, Distribution & Provenance Infrastructure

**ThatGuy Productions · ARCOVEL Technologies International**

> "Rain doesn't live in the cloud." — Audio never leaves your device. Every stage of the mastering pipeline runs locally in your browser via Web Audio API at 48 kHz/64-bit precision. No uploads. No server-side processing. No account required.

---

## 🎛️ Quick Start

```bash
bun install          # Install dependencies
bun run dev          # Dev server → http://localhost:3000
bun run build        # Production build
bun test             # Run 100+ test suite
npx playwright install chromium  # Optional: browser-based DistroKid delivery
```

**Prerequisites:** Bun ≥1.2, Node ≥22. PostgreSQL not required for free beta (SQLite fallback via Prisma).

---

## ⚡ What It Does

1. **Drop in any audio file** — WAV, MP3, FLAC, AIFF, OGG
2. **16-stage mastering pipeline** processes it in your browser
3. **7 macro controls** — BRIGHTEN / GLUE / WIDTH / PUNCH / WARMTH / SPACE / REPAIR
4. **AI-powered (RainNet v2 ONNX)** with graceful heuristic fallback
5. **Export mastered WAV** at 24-bit/48 kHz + 320 kbps MP3
6. **Distribute to 150+ stores** via DDEX ERN 4.3.2 → DistroKid (free tier) or your own aggregator

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  RAIN V6 — Dual-Path Architecture                        │
│                                                         │
│  Preview Path                    Render Path            │
│  ┌──────────────────┐          ┌──────────────────────┐ │
│  │ Web Audio API     │          │ Custom DSP            │ │
│  │ Native nodes      │          │ Float32Array pipeline │ │
│  │ 32-bit float      │          │ 16-stage, deterministic│ │
│  │ Low latency (~5ms)│          │ OfflineAudioContext   │ │
│  └──────────────────┘          └──────────────────────┘ │
│                                                         │
│  Live A/B comparison            Mastering + Export +    │
│                                  Distribution           │
└─────────────────────────────────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Runtime | Bun 1.2+ |
| Language | TypeScript (strict) |
| Database | SQLite (dev) / PostgreSQL 18 (prod) via Prisma 6 |
| UI | React 19 · Tailwind CSS 4 · shadcn/ui (Radix) |
| DSP | TypeScript Web Audio API — all processing in-browser, 48 kHz |
| AI/ML | RainNet v2 ONNX → 46 ProcessingParams per render |
| Provenance | Ed25519 signatures · C2PA v2.2 manifest · Chain-of-custody |
| Distribution | DDEX ERN 4.3.2 · LabelGrid API · DistroKid browser automation |
| Payments | PayFast (ZA) · Ozow (ZA) · Stripe (INTL) — R0.00 during BETA |
| Security | scrypt auth · timing-safe compares · SHA-256 hashing · httpOnly cookies |

---

## 🧬 16-Stage Mastering Pipeline

| Stage | Name | What Happens |
|---|---|---|
| 1 | Format Normalization | Resample to 48 kHz, 64-bit float stereo |
| 2 | Signal Analysis | ITU-R BS.1770-4 LUFS, true peak (4× oversampled), RMS, crest factor, LRA |
| 3 | Loudness Survey | Pre-master LUFS + true peak baselines |
| 4 | AI Inference | RainNet v2 ONNX → 46 ProcessingParams (falls back to heuristics) |
| 5 | Genre Profile Match | Genre-specific EQ tilt + 31-band 1/3-octave reference curves |
| 6 | Spectral Repair | High-pass filter + de-essing biquad cascade |
| 7 | Source Separation | BS-RoFormer 4-pass cascade → 12 stems (audio ≤60s) |
| 8 | Per-Stem Repair | HPF/de-ess/DC offset correction per stem |
| 9 | Per-Stem Processing | SAIL v2 limiting + gain faders + mute/solo + stereo bus summation |
| 10 | Master Bus | 8-band parametric EQ + multiband compression + M/S width + groove + vitality |
| 11 | Loudness Targeting | LUFS-based gain compensation to platform target |
| 12 | True-Peak Limiting | Closed-loop ISP protection (limit → measure dBTP → re-limit) |
| 13 | QC Validation | Final re-analysis + corrective re-limit if ceiling exceeded |
| 14 | Provenance Signature | Ed25519 cert + C2PA manifest embedding |
| 15 | Output Packing | AudioBuffer build, TPDF dither, 24-bit/48 kHz WAV + 320 kbps MP3 |
| 16 | Distribution Readiness | Final LUFS/TP gate → `_distributionReady` flag |

---

## 📦 Key Features

### AI & Machine Learning
- **RainNet v2** — ONNX transformer (4 layers, 8 heads, 256-dim) with 66 MB of model weights
- **Genre heuristics** — 17 genres with per-genre multiband compression and EQ curves
- **Groove + Emotion intelligence** — BPM detection, groove classification, valence/arousal estimation, tension arc mapping
- **Chain of custody** — 8 AI tool detection patterns (Suno, Udio, AIVA, Mubert, Boomy, Soundraw, Beatoven, Unknown)

### Audio Processing
- **12-stem source separation** — BS-RoFormer 4-pass cascade (vocals, drums, bass, guitar, piano, etc.)
- **8-module repair suite** — De-noise, de-click, de-crackle, de-hum, de-reverb, de-clip, resonance suppression, spectral gating
- **Spatial Audio** — 7.1.4 Dolby Atmos, HRTF binaural rendering, ADM BWF export
- **18-point QC engine** — LUFS, true peak, LRA, crest factor, stereo width, phase, sibilance, clipping, and more

### Distribution
- **DDEX ERN 4.3.2** — Single + multi-track (album/EP) XML packaging with AI disclosure per EU AI Act Article 50
- **LabelGrid API** — Enterprise delivery path (requires API key)
- **DistroKid browser automation** — Free beta distribution via Playwright-driven Chromium upload (no API key needed)
- **DistroKid pricing** — Real-time ZAR pricing with RAIN = DK + 20% markup

### Security & Provenance
- **Ed25519 RAIN-CERT** — Every render carries a cryptographic provenance certificate
- **C2PA v2.2** — Content authenticity manifest embedded in exports
- **scrypt auth** — N=16384, timing-safe compares, SHA-256 token hashing
- **Payment isolation** — Per-session UUIDv7, one-time tokens, zero cross-contamination

### SA-First Design
- **ZAR currency** — R0.00 during BETA, PayFast/Ozow ready for activation
- **SAMRO / CAPASSO / SAMPRA** — Performing rights organisations in metadata
- **11 South African languages** — Afrikaans, Zulu, Xhosa, Tswana, Sotho, and more
- **Amapiano / Gospel / Gqom** — Genre-specific DSP profiles with tape saturation, stereo width, and vocal emphasis
- **POPIA compliant** — No PII collected during BETA. Audio stays on-device.

---

## 📁 Project Structure

```
rain-beta/
├── src/
│   ├── app/api/rain/         # 20+ API route handlers
│   │   ├── auth/             # Registration, login, logout, me
│   │   ├── distribute/       # LabelGrid + DistroKid finalize
│   │   ├── payment/          # Isolated payment sessions
│   │   ├── render/           # Render completion events
│   │   ├── session/          # Anonymous session management
│   │   ├── assist/           # AI co-mastering engineer
│   │   ├── suggest/          # Mastering report generation
│   │   ├── provenance/       # Certificate verification
│   │   ├── feedback/         # User feedback collection
│   │   ├── source/           # Provenance ZIP download
│   │   ├── stats/            # Usage analytics
│   │   ├── reviews/          # Public reviews
│   │   ├── events/           # Event logging
│   │   └── admin/            # Admin console (bootstrap, accounts, renders)
│   ├── components/rain/      # Feature components (tabs, visualizers, forms)
│   │   ├── mastering/        # MasteringTab with 16-stage pipeline UI
│   │   ├── tabs/             # Stems, Spatial, QC, Distribute, Export, etc.
│   │   ├── forms/            # AiDisclosurePanel, metadata forms
│   │   ├── landing/          # Landing page (hero, nav, partner logos)
│   │   └── ui/               # DataRain, SpectrumAnalyzer, visualizers
│   ├── hooks/                # Custom React hooks
│   └── lib/rain/             # CORE ENGINE — all DSP, AI, security, distribution
│       ├── audio-engine.ts   # 16-stage pipeline orchestrator (113 KB)
│       ├── dsp.ts            # LUFS, EQ, FFT, saturation, limiting (61 KB)
│       ├── stems.ts          # BS-RoFormer 4-pass, 12 stems (66 KB)
│       ├── spatial.ts        # 7.1.4 Atmos, HRTF, ADM BWF (71 KB)
│       ├── repair.ts         # 8 repair modules (54 KB)
│       ├── distribution.ts   # DDEX ERN 4.3.2, ZIP packaging (47 KB)
│       ├── distribution-multitrack.ts  # Album/EP DDEX support (15 KB)
│       ├── rainnet-inference.ts  # ONNX → 46 ProcessingParams (19 KB)
│       ├── provenance.ts     # Ed25519 cert, C2PA manifest, ISRC/UPC (18 KB)
│       ├── qc.ts             # 18-point QC engine (38 KB)
│       ├── groove-emotion.ts # BPM, groove, valence/arousal (55 KB)
│       ├── chain-of-custody.ts  # AI detection, metadata stripping (76 KB)
│       ├── constants.ts      # Genres, platforms, DSP partners (20 KB)
│       ├── sa-regional.ts    # ZAR, PayFast, POPIA, SA defaults (10 KB)
│       ├── metadata-validation.ts  # Ditto-standard validation (15 KB)
│       ├── distrokid-delivery.ts  # Browser automation upload (16 KB)
│       ├── distrokid-pricing.ts   # Live pricing + 20% markup (9 KB)
│       ├── payment-isolation.ts   # Payment session isolation (NEW)
│       ├── auth.ts           # scrypt + timing-safe auth
│       ├── rate-limit.ts     # Token bucket rate limiting
│       ├── tier-gate.ts      # Tier-based feature gating
│       ├── usage.ts          # Usage tracking
│       ├── analytics.ts      # Client-side IndexedDB analytics
│       ├── server-analytics.ts  # Server-side event analytics
│       ├── heuristics.ts     # Genre/emotion/genome heuristics
│       └── types.ts          # All TypeScript types
├── tests/lib/                # Test suite (100+ tests, 6 files)
├── docs/
│   ├── MASTER_DOSSIER.md     # Complete system documentation
│   ├── legal/                # Legal documents (6 files)
│   ├── audit/                # Forensic audit reports
│   └── handbook/             # User & developer handbooks
├── prisma/schema.prisma      # Database schema
├── public/models/            # RainNet ONNX models (66 MB, Git LFS)
├── .github/workflows/ci.yml  # CI: lint, tsc --noEmit, prisma check, build, test
└── .zscripts/                # Build, dev, start scripts
```

---

## 🔒 Security

- **No PII collected** during BETA — no accounts, no passwords, no email, no IP logging
- **Audio never leaves your device** — all processing via browser Web Audio API
- **Ed25519 provenance signatures** — cryptographic proof of origin on every render
- **scrypt authentication** (N=16384, r=8, p=1) — OWASP-correct key derivation
- **Timing-safe token compares** — resistant to timing side-channel attacks
- **SHA-256 hashed auth tokens** — database breach doesn't expose credentials
- **httpOnly + SameSite cookies** — prevents XSS token theft
- **Payment isolation** — per-session UUIDv7, one-time tokens, no cross-user contamination
- **Rate limiting** — token bucket (3 attempts/minute per session)
- **BETA mode** — all payments R0.00, payment infrastructure verified but inactive

---

## 📊 BETA Status — Free Public Beta

| Item | Status |
|---|---|
| Pricing | R0.00 across all tiers |
| User accounts | Not required — anonymous sessions |
| PII collection | None — POPIA compliant by design |
| Mastering | Full 16-stage pipeline, all features available |
| Distribution | DDEX ZIP download + DistroKid browser automation |
| AI disclosure | EU AI Act Article 50 compliant |
| Support | Community only — no SLA during BETA |

---

## ⚖️ Legal

RAIN V6 is proprietary software — © 2026 ThatGuy Productions / ARCOVEL Technologies International.

| Document | Purpose |
|---|---|
| [Terms of Service](docs/legal/TERMS_OF_SERVICE.md) | Service use, liability limits, IP rights |
| [Privacy Policy](docs/legal/PRIVACY_POLICY.md) | POPIA compliance, data collection, user rights |
| [Data Processing Agreement](docs/legal/DATA_PROCESSING_AGREEMENT.md) | Processing relationships, security measures |
| [AI Disclosure Compliance](docs/legal/AI_DISCLOSURE_COMPLIANCE.md) | EU AI Act Article 50, DDEX AIInvolvement, C2PA |
| [Payment Terms](docs/legal/PAYMENT_TERMS.md) | Payment processing, refunds, PCI compliance |
| [Liability Waiver](docs/legal/LIABILITY_WAIVER.md) | AI disclaimers, user responsibility, distribution chain |

Jurisdiction: South Africa (ZA). Governing law: Republic of South Africa.

Contact: legal@rainv6.com

---

## 🧪 Testing

```bash
bun test              # Run 100+ tests across 6 test files
bun run lint          # ESLint checks
tsc --noEmit           # Independent type-check gate (CI also runs this)
```

---

## 📚 Documentation

- [MASTER DOSSIER](docs/MASTER_DOSSIER.md) — Complete system architecture, all 20 sections
- [Pipeline Audit](docs/audit/pipeline-audit.md) — Every processing stage mapped
- [Feature Gap Analysis](docs/audit/feature-gap-analysis.md) — 36 features by implementation status
- [Roadmap Gap Analysis](docs/audit/roadmap-gap-analysis.md) — BETA vs. master plan
- [Industry Research](docs/audit/industry-research.md) — DDEX, C2PA, Dolby Atmos, distribution APIs
- [Quality Audit](docs/audit/quality-audit.md) — 16 subsystems scored, upgrade priorities
- [Forensic Audit Report](docs/audit/forensic-audit-report.md) — Initial codebase assessment

---

## 🚀 Roadmap

### Immediate (BETA polish)
- [ ] Run `bun install && bun test` on dev machine to validate 100+ tests
- [ ] Run `bun run dev` to verify full build with ONNX models
- [ ] Test DistroKid browser automation end-to-end
- [ ] Add tier gates to admin routes (one-liners, deferred until live DB)

### Near-term upgrades
- [ ] Real Chromaprint (AcoustID-compatible fingerprinting)
- [ ] Linear-phase EQ (replace minimum-phase biquads)
- [ ] 6-band multiband compression (currently 3-band)
- [ ] TuneCore + CD Baby browser automation (expand beyond DistroKid)

### Production launch
- [ ] C++/WASM DSP engine (64-bit float spec compliance)
- [ ] GPU-accelerated stem separation (remove 60s limit)
- [ ] PostgreSQL 18 production deployment
- [ ] Redis/Upstash rate limiting (multi-instance scaling)
- [ ] Activate payment tiers (R551.99–R1,978.80/year)

---

## 🤝 Contact

- **Email:** legal@rainv6.com / philippusbolke@gmail.com
- **GitHub:** [ThatGuy-Productions/RAINV6.COM](https://github.com/ThatGuy-Productions/RAINV6.COM)
- **Company:** ThatGuy Productions / ARCOVEL Technologies International

---

*RAIN V6 Beta · Engine stamp: `RAIN V6 — BS-RoFormer 12-stem` · Engine: TypeScript Web Audio API · 48 kHz · 64-bit deterministic · BETA Candidate 3 · 2026-07-31*
