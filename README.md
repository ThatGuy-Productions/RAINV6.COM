# R∞N — RAIN v6

### AI Audio Transformation, Mastering & Distribution Infrastructure

**ThatGuy Productions · ARCOVEL Technologies International**

> "Rain doesn't live in the cloud." — The render engine runs on your machine. Audio never leaves your device during processing.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Database | PostgreSQL (Prisma ORM) |
| State | Zustand 5 · TanStack Query 5 |
| UI | React 19 · Tailwind CSS 4 · shadcn/ui (Radix) |
| DSP | TypeScript Web Audio API (in-browser, 48 kHz) |
| Provenance | Ed25519 · C2PA v2.2 |
| Distribution | DDEX ERN 4.3.2 · LabelGrid API |

## Getting Started

```bash
# Install dependencies
bun install

# Push DB schema (if using Prisma + PostgreSQL)
bun run db:push
bun run db:generate

# Dev server (http://localhost:3000)
bun run dev

# Production build
bun run build
```

## Project Structure

```
rain-beta/
├── src/
│   ├── app/              # Next.js App Router (pages + API routes)
│   │   ├── api/rain/    # 15+ API route handlers
│   │   └── ...
│   ├── components/rain/ # Feature components (tabs, visualizers, etc.)
│   ├── components/ui/   # shadcn/ui primitives
│   ├── hooks/           # Custom React hooks
│   └── lib/rain/        # Core engine (DSP, auth, QC, provenance, etc.)
├── prisma/              # Database schema
├── public/              # Static assets
├── .github/workflows/   # CI (lint, typecheck, build, prisma check)
└── docker-compose.yml   # Local PostgreSQL
```

## CI

- **Lint**: `bun run lint`
- **Typecheck**: `tsc --noEmit` (independent from the app's relaxed build config)
- **Prisma**: schema validation + formatting
- **Build**: `bun run build`
- **Tests**: placeholder (test suite under construction — audit finding #6)

Note: `next.config.ts` sets `typescript.ignoreBuildErrors: true` for the
`next build` step. This is intentional — it allows the app to build even with
type warnings. CI adds an independent `tsc --noEmit` step to catch real type
errors without changing this config.

## Key Features

- **16-stage mastering pipeline** — Format normalization → provenancing → feature extraction → AI inference → spectral repair → stem separation → per-stem processing → master bus → loudness targeting → true-peak limiting → QC → watermarks → packaging → distribution
- **7 macro controls** — BRIGHTEN / GLUE / WIDTH / PUNCH / WARMTH / SPACE / REPAIR
- **12-stem source separation** — BS-RoFormer cascade
- **27 platform loudness targets** — Spotify through vinyl, broadcast, and niche platforms
- **18 automated QC checks** — LUFS, true peak, LRA, crest factor, stereo width, phase, sibilance, clipping, more
- **Ed25519 provenance** — RAIN-CERT certificates on every render
- **DDEX ERN 4.3.2** — Automated XML packaging and DSP delivery
- **Local-first** — Free tier processes everything in-browser; audio never leaves your device
- **EU AI Act Article 50 compliant** — C2PA v2.2 manifests, AI disclosure fields
- **SA-first design** — SAMRO/CAPASSO/SAMPRA support, South African languages, amapiano/gospel genres

## License

Proprietary — © 2026 ThatGuy Productions. All rights reserved.

Contact [philippusbolke@gmail.com](mailto:philippusbolke@gmail.com) for licensing enquiries.

---

*RAIN v6 · Engine stamp: `RAIN v6 — BS-RoFormer 12-stem` · Engine: TypeScript Web Audio API · 48 kHz · 64-bit deterministic*
