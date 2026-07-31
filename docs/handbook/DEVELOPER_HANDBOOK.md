# RAIN V6 Beta — Developer Handbook

**Target audience:** Contributors, auditors, future maintainers  
**Version:** Beta Candidate 3  
**Date:** 2026-07-31

---

## Table of Contents

1. [Codebase Architecture](#1-codebase-architecture)
2. [Development Setup](#2-development-setup)
3. [DSP Engine Internals](#3-dsp-engine-internals)
4. [Adding a New Genre](#4-adding-a-new-genre)
5. [Adding a New Repair Module](#5-adding-a-new-repair-module)
6. [Adding a New Distribution Aggregator](#6-adding-a-new-distribution-aggregator)
7. [RAIN-CERT Provenance System](#7-rain-cert-provenance-system)
8. [RainNet ONNX Training Pipeline](#8-rainnet-onnx-training-pipeline)
9. [Database Schema](#9-database-schema)
10. [API Design Conventions](#10-api-design-conventions)
11. [Testing Strategy](#11-testing-strategy)
12. [Security Model](#12-security-model)
13. [CI/CD Pipeline](#13-cicd-pipeline)
14. [Performance Profiling](#14-performance-profiling)
15. [Contribution Guidelines](#15-contribution-guidelines)

---

## 1. Codebase Architecture

```
rain-beta/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/rain/                 # 20+ API route handlers
│   │   │   ├── render/route.ts       # Render completion event persistence
│   │   │   ├── distribute/
│   │   │   │   ├── route.ts          # Legacy multipart LabelGrid submit
│   │   │   │   └── finalize/route.ts # Unified distribution finalize
│   │   │   ├── payment/route.ts      # Isolated payment session creation
│   │   │   ├── auth/                 # Register, login, logout, me
│   │   │   ├── session/route.ts      # Anonymous session management
│   │   │   ├── assist/route.ts       # AI co-mastering engineer
│   │   │   ├── suggest/route.ts      # Mastering report generation
│   │   │   ├── provenance/route.ts   # Certificate verification
│   │   │   ├── feedback/route.ts     # User feedback submission
│   │   │   ├── source/route.ts       # Enterprise provenance ZIP
│   │   │   ├── stats/route.ts        # Usage statistics
│   │   │   ├── reviews/route.ts      # Public review submission
│   │   │   ├── events/route.ts       # Event log recording
│   │   │   └── admin/                # Admin console
│   │   │       ├── accounts/route.ts
│   │   │       ├── status/route.ts
│   │   │       └── renders/route.ts
│   │   ├── (pages)/                   # Page routes
│   │   │   ├── page.tsx               # Landing page
│   │   │   ├── dashboard/page.tsx     # Main mastering interface
│   │   │   └── admin/page.tsx         # Admin dashboard
│   │   ├── layout.tsx                 # Root layout
│   │   └── globals.css                # Global styles
│   ├── components/rain/               # Feature components
│   │   ├── mastering/MasteringTab.tsx # 16-stage pipeline UI
│   │   ├── tabs/                      # All 14 tabs
│   │   ├── forms/                     # AiDisclosurePanel, metadata forms
│   │   ├── landing/                   # Landing page components
│   │   └── ui/                        # DataRain, SpectrumAnalyzer, etc.
│   ├── hooks/                         # Custom React hooks
│   └── lib/rain/                      # CORE ENGINE (see §3 below)
├── tests/lib/                         # Test suite (6 files, 100+ tests)
├── docs/
│   ├── MASTER_DOSSIER.md
│   ├── legal/                         # 6 legal documents
│   ├── audit/                         # Forensic audit reports
│   └── handbook/                      # User + developer handbooks
├── prisma/schema.prisma               # Database schema
├── public/models/                     # RainNet ONNX models (Git LFS, 66 MB)
├── .github/workflows/ci.yml           # CI pipeline
└── .zscripts/                         # Build/dev helper scripts
```

### Data Flow

```
User Audio File
    │
    ▼
[src/lib/rain/audio-engine.ts]
    │  .loadAudio() — decode to AudioBuffer
    │  .renderPipeline() — 16 stages
    │  .exportWav() — 24-bit/48 kHz WAV
    │
    ├──► [src/lib/rain/dsp.ts] — LUFS, EQ, Saturation, Limiting
    ├──► [src/lib/rain/stems.ts] — 12-stem separation
    ├──► [src/lib/rain/spatial.ts] — Spatial audio rendering
    ├──► [src/lib/rain/repair.ts] — 8 repair modules
    ├──► [src/lib/rain/rainnet-inference.ts] — ONNX inference
    ├──► [src/lib/rain/groove-emotion.ts] — BPM, groove, valence
    ├──► [src/lib/rain/chain-of-custody.ts] — AI detection, metadata
    ├──► [src/lib/rain/provenance.ts] — Ed25519 signing, C2PA
    ├──► [src/lib/rain/distribution.ts] — DDEX XML, ZIP packaging
    └──► [src/lib/rain/qc.ts] — 18-point quality control
```

### State Management

- **Zustand 5** — Global `useRainStore` for audio state, UI state, processing params
- **TanStack Query 5** — Server state: events, reviews, stats, provenance
- **IndexedDB** — Client-side analytics (render telemetry, QC snapshots)

---

## 2. Development Setup

### Prerequisites

- **Bun** ≥ 1.2.0
- **Node.js** ≥ 22.0 (for Prisma)
- **Git LFS** (for ONNX model files)
- **Playwright** (optional — for DistroKid browser automation)
- **PostgreSQL 18** (optional — SQLite works for local dev)

### Initial Setup

```bash
# Clone
git clone https://github.com/ThatGuy-Productions/RAINV6.COM.git
cd RAINV6.COM

# Pull LFS models
git lfs pull

# Install
bun install

# Setup database
cp .env.example .env.local     # Edit DATABASE_URL for your setup
bun run db:generate            # Generate Prisma client
bun run db:push                # Push schema to database

# Install Playwright (optional)
npx playwright install chromium

# Dev server
bun run dev                    # → http://localhost:3000
```

### .env.local Reference

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rainv6"
# or for SQLite: "file:./db/dev.db"

# Optional: Only needed for enterprise LabelGrid distribution
LABELGRID_API_KEY=
LABELGRID_URL=https://api.labelgrid.com/v5

# Optional: Payment provider keys (not needed during BETA)
PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
OZOW_SITE_ID=
OZOW_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

### Scripts Reference

| Command | Purpose |
|---|---|
| `bun run dev` | Next.js dev server (port 3000) |
| `bun run build` | Production build (skips type errors on build) |
| `bun run start` | Production server |
| `bun run lint` | ESLint checks |
| `bun test` | Run all tests |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Prisma Studio (GUI) |
| `tsc --noEmit` | Independent type-check gate |

---

## 3. DSP Engine Internals

### Core Files

| File | Size | Role |
|---|---|---|
| `audio-engine.ts` | 113 KB | Pipeline orchestrator, load/render/export |
| `dsp.ts` | 61 KB | LUFS, true peak, biquad EQ, FFT, M/S processing, saturation, limiting |
| `stems.ts` | 66 KB | BS-RoFormer 4-pass cascade, 12 stems |
| `spatial.ts` | 71 KB | 7.1.4 spatial, HRTF, ADM BWF |
| `repair.ts` | 54 KB | 8 DSP repair modules |

### AudioEngine Class

```typescript
// src/lib/rain/audio-engine.ts

interface AudioEngine {
  // Load and decode audio
  loadAudio(file: File): Promise<LoadedAudio>;

  // Run the full 16-stage pipeline
  renderPipeline(
    audio: LoadedAudio,
    macroParams: MacroParams,
    genre: GenreId,
    platform: PlatformId,
    options?: RenderOptions
  ): Promise<RenderedAudio>;

  // Preview mode (subset of stages, low latency)
  previewPipeline(
    audio: LoadedAudio,
    macroParams: MacroParams,
    genre: GenreId,
    platform: PlatformId
  ): Promise<PreviewOutput>;

  // Export to formats
  exportWav(rendered: RenderedAudio): Promise<Blob>;
  exportMp3(rendered: RenderedAudio): Promise<Blob>;
  exportFlac(rendered: RenderedAudio): Promise<Blob>;
  exportAtmosZip(rendered: RenderedAudio, spatialParams: SpatialParams): Promise<Blob>;
}
```

### Pipelines Stage Implementation

Each stage is an `async` function that receives and returns a pipeline context:

```typescript
interface StageContext {
  audio: Float32Array;          // Left channel
  audioRight: Float32Array;     // Right channel
  sampleRate: number;           // Always 48000
  preMasterLU: number;          // Pre-master LUFS
  preMasterTP: number;          // Pre-master true peak
  processingParams: ProcessingParams;  // From RainNet or heuristics
  genre: GenreId;
  platform: PlatformId;
  stems?: StemResult[];         // Populated after Stage 7
  qcMetrics: QCMetrics;        // Populated during QC stages
}

// Stage signature
type StageHandler = (ctx: StageContext) => Promise<StageContext>;
```

### Adding a New Audio Processing Step

1. Add the function to the appropriate module in `src/lib/rain/`
2. Wire it into `audio-engine.ts` in the correct stage position
3. Register it in `PIPELINE_STAGES` in `constants.ts`
4. Add QC checks if it affects output quality
5. Write tests

---

## 4. Adding a New Genre

### Step 1: Register the genre

In `src/lib/rain/constants.ts`, add to `GENRE_OPTIONS` and `GENRES`:

```typescript
export const GENRES = {
  // ...existing genres...
  ['your-genre-id']: 'Your Genre Name',
} as const;
```

### Step 2: Add ISO 639-2 language if genre is language-specific

```typescript
export const LANGUAGE_OPTIONS: Record<string, LanguageData> = {
  // ...existing languages...
  ['iso-par']: {
    name: 'Language Name',
    region: 'Africa',
    proOrganizations: ['SAMRO'],
  },
};
```

### Step 3: Add DSP overrides

In `src/lib/rain/dsp.ts` → `GENRE_OVERRIDES`:

```typescript
export const GENRE_OVERRIDES: Record<string, GenreProcessingProfile> = {
  // ...existing overrides...
  ['your-genre-id']: {
    mb_attack_low: 15,        // ms — low band compressor attack
    mb_attack_mid: 8,          // ms — mid band compressor attack
    mb_attack_high: 3,         // ms — high band compressor attack
    mb_release_low: 80,        // ms — low band compressor release
    mb_release_high: 40,       // ms — high band compressor release
    mid_gain: 0.0,             // dB — mid channel (M/S) emphasis
    stereo_width: 0.5,         // 0.0=mono, 1.0=max width
    analog_saturation: false,   // Enable tape/valve saturation
    saturation_drive: 0.0,     // Saturation intensity
    eq_preset: {              // 31-band target EQ curve
      // dB offsets per 1/3-octave band
    },
    mb_preset: {               // Multiband compression preset
      // Per-band threshold/ratio/knee/gain
    },
  },
};
```

### Step 4: Add to RainNet genre mapping

In `src/lib/rain/rainnet-inference.ts`, update `GENRE_ID_MAP`:

```typescript
const GENRE_ID_MAP: Record<string, number> = {
  // ...existing mappings...
  ['your-genre-id']: 17, // Increment from last ID
};
```

### Step 5: Write tests

Add genre override assertions in `tests/lib/genre-overrides.test.ts`.

---

## 5. Adding a New Repair Module

### Architecture

All repair modules share the same FFT framework (`FFTContext`):

```typescript
interface RepairModule {
  name: string;
  description: string;
  process(
    audio: Float32Array,
    sampleRate: number,
    intensity: number,     // 0.0–1.0
    fftContext: FFTContext,
    cancelToken?: { cancelled: boolean }
  ): Promise<Float32Array>;
}
```

### Implementation Template

```typescript
// src/lib/rain/repair.ts — add your module

export async function repairYourModule(
  audio: Float32Array,
  sampleRate: number,
  intensity: number,
  fftCtx: FFTContext,
  cancelToken?: { cancelled: boolean }
): Promise<Float32Array> {
  const fftSize = 1024;
  const hopSize = fftSize / 4;  // 75% overlap

  // Forward STFT
  const { real, imag } = await stft(audio, fftSize, hopSize, fftCtx);

  // Process frequency bins
  const numFrames = real.length / fftSize;
  for (let f = 0; f < numFrames; f++) {
    const start = f * fftSize;
    for (let b = 0; b < fftSize / 2; b++) {
      const mag = Math.sqrt(real[start + b] ** 2 + imag[start + b] ** 2);

      // Your DSP logic here

      // Apply
      const factor = /* computed scale factor */;
      real[start + b] *= factor;
      imag[start + b] *= factor;
    }
  }

  // Inverse STFT
  return await istft(real, imag, fftSize, hopSize, audio.length, fftCtx);
}
```

### Registration

1. Add to `REPAIR_MODULES` in `constants.ts`
2. Wire into `REPAIR_PIPELINE` order in `audio-engine.ts`
3. Add UI toggle in `RepairTab.tsx`
4. Add QC check if applicable

---

## 6. Adding a New Distribution Aggregator

### Implementation Template

Create a new file: `src/lib/rain/your-aggregator-delivery.ts`

```typescript
/**
 * [Your Aggregator] web upload flow — browser automation delivery.
 *
 * Steps:
 *   1. Navigate to aggregator upload page
 *   2. Login or detect session
 *   3. Select release type
 *   4. Fill metadata (artist, title, genre, ISRC, UPC)
 *   5. Upload mastered WAV
 *   6. Upload artwork
 *   7. Set release date + store selection
 *   8. Confirm + submit
 *   9. Verify confirmation page
 */

import type { BrowserAutomationConfig, BrowserDeliveryResult } from './browser-distribution';

async function stepNavigate(page: any, config: BrowserAutomationConfig): Promise<BrowserStepResult> {
  // ...implementation...
}

export async function deliverViaYourAggregator(
  config: BrowserAutomationConfig
): Promise<BrowserDeliveryResult> {
  // ...orchestrator...
}
```

### Registration

1. Add aggregator name to `DISTRIBUTION_AGGREGATORS` in `constants.ts`
2. Add pricing to `src/lib/rain/distrokid-pricing.ts` (or create separate pricing file)
3. Wire into distribution method selector in `DistributeTab.tsx`
4. Update `getRecommendedDistributionMethod()` in `distrokid-delivery.ts`

### Selector Guidelines

- Always use **semantic selectors**: `[aria-label*="..." i]`, `[placeholder*="..." i]`, `button:has-text("...")`
- Never use brittle CSS classes or XPaths that target generated class names
- Test selectors against the live page at least once per quarter

---

## 7. RAIN-CERT Provenance System

### Key Generation

```typescript
// src/lib/rain/provenance.ts

// Ed25519 key pair generated via WebCrypto
// Persisted in IndexedDB (survives browser restart)
const keyPair = await generateRainKey();
// → { publicKey: CryptoKey, privateKey: CryptoKey, keyId: string }
```

### Signing Flow

```
Input Audio (Float32Array channels)
    │
    ▼
SHA-256 hash of Float32 samples
    │
    ├──► Signed with Ed25519 private key via crypto.subtle.sign()
    │
    ▼
C2PA Manifest (JSON-LD)
    ├── assertions: [{ ops: ['mastered', 'dsp-processed'] }]
    ├── ingredients: [{ hash, format }]
    └── claim_generator: "RAIN V6 Beta"
    │
    ▼
Embedded in WAV (RIFF 'RAIN' + 'CERT' chunks)
Embedded in MP3 (ID3v2 PRIV frames)
Embedded in DDEX (as ProvenanceAssertion)
```

### Verification

```typescript
// 1. Load original + rendered audio
// 2. Extract signature from rendered file
// 3. Recompute SHA-256 of original
// 4. crypto.subtle.verify(publicKey, signature, hash)
//    → true = provenance confirmed
```

---

## 8. RainNet ONNX Training Pipeline

### Model Architecture

```
Input: Mel spectrogram (128 mel bins × 128 time frames, Hamming window)
    │
    ▼
MelSpecEncoder (Conv1d + LayerNorm)
    │
    ▼
Transformer (4 layers, 8 heads, 256-dim hidden)
    │
    ▼
Decoder (Linear → 46 neuron output)
    │
    ▼
46 ProcessingParams (sigmoid/tanh/softplus activation)
    │
    ├── Genre ID (softmax over 17 categories)
    ├── Platform ID (softmax over 8 categories)
    └── 44 continuous parameters (sigmoid/tanh)
```

### Source

Training code in reference roadmap repo:
`rain-roadmap-repo/.../ml/rainnet/model.py` + `__init__.py`

### Export to ONNX

```python
# Conceptual — reference roadmap repo has exact code
torch.onnx.export(
    model,                    # Trained PyTorch model
    dummy_input,              # Shape: [1, 128, 128]
    "rain_base.onnx",
    input_names=["mel_spec"],
    output_names=["processing_params"],
    opset_version=17,
)
```

### Model Deployment

1. Export ONNX model + external data file
2. Place in `public/models/`
3. Track with Git LFS (ONNX files are binary and large)
4. `rainnet-inference.ts` loads from `/models/` at runtime

---

## 9. Database Schema

### Prisma Schema (prisma/schema.prisma)

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  tierId    String
  createdAt DateTime @default(now())
  sessions  Session[]
}

model Session {
  id        String   @id @default(uuid())
  userId    String?
  createdAt DateTime @default(now())
  expiresAt DateTime
  renders   Render[]
  events    Event[]
}

model Render {
  id              String   @id @default(uuid())
  sessionId       String
  durationMs      Int
  genreId         String
  platformId      String
  macroSnapshot   Json
  qcSnapshot      Json
  provenanceHash  String
  createdAt       DateTime @default(now())
}

model Event {
  id        String   @id @default(uuid())
  sessionId String
  kind      String
  payload   Json
  createdAt DateTime @default(now())
}

model Feedback {
  id        String   @id @default(uuid())
  sessionId String
  category  String
  message   String
  createdAt DateTime @default(now())
}
```

### Migration Commands

```bash
bun run db:generate     # Generate Prisma client from schema
bun run db:push         # Push schema to database (no migrations)
bun run db:migrate      # Create + apply migration (for production)
bun run db:studio       # Visual database browser
```

---

## 10. API Design Conventions

### Route Structure

```
/api/rain/[resource]/route.ts
/api/rain/[resource]/[action]/route.ts
```

### Request/Response Patterns

```typescript
// POST /api/rain/example
export async function POST(request: NextRequest) {
  // 1. Parse body
  const body = await request.json();

  // 2. Validate
  if (!body.requiredField) {
    return NextResponse.json({ ok: false, error: 'Missing requiredField' }, { status: 400 });
  }

  // 3. Process
  const result = await processSomething(body);

  // 4. Respond
  return NextResponse.json({ ok: true, data: result });
}

// GET /api/rain/example?id=xxx
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing "id" parameter' }, { status: 400 });
  }
  const record = await findById(id);
  if (!record) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: record });
}
```

### Error Response Format

```typescript
{
  ok: false,
  error: "Human-readable error message",
  code?: "ERROR_CODE",    // Machine-readable, optional
  details?: any           // Additional context, optional
}
```

### Authentication

- Protected routes use `withAuth()` wrapper
- Admin routes use `withAdmin()` wrapper
- Rate-limited routes use `withRateLimit()` wrapper (3 req/min)

---

## 11. Testing Strategy

### Test Structure

```
tests/lib/
├── constants.test.ts              # Genre, platform, partner constants
├── metadata-validation.test.ts    # ISRC, UPC, metadata validation
├── identifiers.test.ts            # ISRC format, UPC check digit, ISWC
├── genre-overrides.test.ts        # All 17 genre DSP profiles
├── rainnet.test.ts                # ONNX params, activation functions
└── sa-regional.test.ts            # ZAR formatting, POPIA, payment config
```

### Test Conventions

```typescript
import { describe, it, expect } from 'bun:test';

describe('ModuleName', () => {
  it('should do X when Y', () => {
    const result = moduleUnderTest(input);
    expect(result).toBe(expected);
  });

  it('should throw when Z is invalid', () => {
    expect(() => moduleUnderTest(badInput)).toThrow('Expected error');
  });

  // Edge cases
  it('should handle empty input', () => {
    expect(moduleUnderTest(null)).toBeNull();
  });

  it('should handle maximum values', () => {
    expect(moduleUnderTest(Number.MAX_VALUE)).toBeFinite();
  });
});
```

### Coverage Goals

- **Core DSP:** 80%+ coverage (LUFS, true peak, EQ, compression, limiting)
- **Constants:** 100% coverage (all value tables validated)
- **Security:** 100% coverage (auth, rate limiting, payment isolation)

---

## 12. Security Model

### Authentication Flow

```
User attempts login
    │
    ▼
POST /api/rain/auth/login { email, password }
    │
    ├── scrypt(password, salt, N=16384, r=8, p=1) → hash
    ├── timingSafeEqual(hash, storedHash)           → match?
    ├── SHA-256(randomBytes) → token
    ├── Store token in DB (hashed)
    └── Set httpOnly cookie "rain-token={token}; SameSite=Lax; Secure"
```

### Rate Limiting

Token bucket implementation in `src/lib/rain/rate-limit.ts`:

```typescript
const rateLimit = new TokenBucket({
  maxTokens: 10,
  refillRate: 10 / 60,     // 10 tokens per 60 seconds
  refillIntervalMs: 1000,  // Refill every 1 second (for smoothness)
});
```

Applied per session ID. In-memory (single instance). Notes for Redis migration.

### Payment Isolation

```typescript
// src/lib/rain/payment-isolation.ts

interface PaymentSession {
  paymentSessionId: string;    // UUIDv7 — unique per payment
  amount: number;              // ZAR, server-side only
  providerToken: string;       // One-time use, 5-min expiry
  confirmed: boolean;          // Immutable after confirmation
  confirmedAt?: string;        // ISO timestamp
}
```

Guarantees:
- No cross-user payment data leakage (session isolation via UUIDv7)
- Payment amounts stored server-side only (never in client)
- Signature verification (HMAC-SHA512 for PayFast, HMAC-SHA256 for Ozow)
- Idempotency keys prevent duplicate charges
- BETA mode: all confirmations return `{ ok: true, betaMode: true, amount: 0 }`

---

## 13. CI/CD Pipeline

### .github/workflows/ci.yml

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: tsc --noEmit

      - name: Prisma Check
        run: |
          bun run db:generate
          npx prisma format --check

      - name: Build
        run: bun run build

      - name: Test
        run: bun test
```

### Build Configuration

```typescript
// next.config.ts
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,  // Allow build even with TS warnings
  },
  // Other config...
};
```

The `ignoreBuildErrors: true` is intentional — it allows hotfix deployments when type warnings exist. CI adds an independent `tsc --noEmit` gate that must pass.

---

## 14. Performance Profiling

### Key Metrics

| Metric | Target | Measurement Method |
|---|---|---|
| Audio load time | < 2s for 3-min WAV | `performance.now()` around `decodeAudioData()` |
| Preview latency | < 10ms | `performance.now()` around preview pipeline |
| Render time | < 60s for 3-min track | `performance.now()` around render pipeline |
| Open time | < 3s for 3-min track | Included in render time |
| WAV export | < 1s | `performance.now()` around `exportWav()` |
| ONNX load time | < 5s | `performance.now()` around model loading |
| Peak memory | < 500 MB for 5-min track | `performance.memory` API |

### Profiling in Dev

Each stage logs its duration via `console.debug()` in development mode. Inspect in browser DevTools:

```
[RAIN] Stage 1 — Format Normalization: 12ms
[RAIN] Stage 2 — Signal Analysis: 45ms
[RAIN] Stage 3 — Loudness Survey: 8ms
[RAIN] Stage 4 — AI Inference: 1,230ms
[RAIN] Stage 5 — Genre Profile Match: 3ms
...
[RAIN] Total render: 14,200ms
```

### Memory Management

- **FFTContext** is reused across stages (single allocation, not re-allocation)
- **OfflineAudioContext** is created once per render (not per frame)
- **Float32Array** channels are zero-copy passed between stages
- **IndexedDB** analytics are batched and flushed every 30 seconds

---

## 15. Contribution Guidelines

### Commit Convention

```
type(scope): description

Types: feat, fix, docs, style, refactor, perf, test, chore, security
Scope: e.g., dsp, stems, spatial, distribution, ui, security, payments
```

Examples:
```
feat(dsp): add linear-phase EQ mode
fix(distribution): DDEX namespace URI trailing slash
security(payment): HMAC-SHA512 signature verification for PayFast
docs(legal): update AI Disclosure per EU AI Act Article 50
test(rainnet): add ONNX parameter validation edge cases
```

### Branch Strategy

```
main         — Production branch (deployable at any time)
feat/xxx     — Feature branches (merge via PR)
fix/xxx      — Bug fix branches
chore/xxx    — Tooling, CI, docs
security/xxx — Security patches (reviewed separately)
```

### PR Requirements

1. All tests pass (`bun test`)
2. Typecheck passes (`tsc --noEmit`)
3. No new lint warnings (`bun run lint`)
4. Relevant tests added for new functionality
5. Documentation updated (this handbook, README, MASTER DOSSIER)

### Coding Style

- **TypeScript strict mode** — `strict: true` in `tsconfig.json`
- **No `any` types** — Use `unknown` + type guards
- **No `Math.random()` in DSP** — All processing must be deterministic
- **No side effects in DSP functions** — Pure functions only
- **Explicit return types** on all exported functions
- **JSDoc comments** on public API

---

## Appendix: File Size Reference

| File | Lines | Code | Comments | Blanks |
|---|---|---|---|---|
| audio-engine.ts | ~3,400 | ~2,700 | ~400 | ~300 |
| dsp.ts | ~1,900 | ~1,500 | ~250 | ~150 |
| stems.ts | ~2,100 | ~1,650 | ~280 | ~170 |
| spatial.ts | ~2,200 | ~1,750 | ~260 | ~190 |
| repair.ts | ~1,800 | ~1,400 | ~240 | ~160 |
| chain-of-custody.ts | ~2,294 | ~1,800 | ~300 | ~194 |
| groove-emotion.ts | ~1,700 | ~1,350 | ~220 | ~130 |
| distribution.ts | ~1,500 | ~1,150 | ~200 | ~150 |

Total core engine: ~17,000 lines of TypeScript (excluding UI, tests, and config).

---

*Developer Handbook v1.0-beta · RAIN V6 Beta · © 2026 ThatGuy Productions / ARCOVEL Technologies International*
