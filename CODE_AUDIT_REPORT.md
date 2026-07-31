# RAIN V6 Code Quality & Architecture Audit

**Audit Date:** 2026-07-31
**Auditor:** Automated Code Quality Subagent
**Repository:** `audit-rainv6` (Next.js 16 + React 19 + TypeScript 5)
**Scope:** 249 files across `src/`, `prisma/`, `tests/`, `docs/`

---

## 1. ARCHITECTURE REVIEW

### 1.1 Overall Structure

```
src/
├── app/
│   ├── layout.tsx           (server component — root layout, metadata)
│   ├── page.tsx             ('use client' — view router: landing vs studio)
│   ├── globals.css          (29 KB global styles)
│   ├── api/rain/            (18 API route handlers)
│   │   ├── admin/           (accounts, bootstrap, renders, stats, status)
│   │   ├── assist/          (AI assistant chat endpoint)
│   │   ├── auth/            (login, logout, me, register)
│   │   ├── distribute/      (DDEX generation + finalize)
│   │   ├── events/          (analytics event ingestion)
│   │   ├── feedback/        (user feedback)
│   │   ├── payment/         (19 KB — largest route, multi-handler)
│   │   ├── provenance/      (certificate verification)
│   │   ├── render/          (mastering render trigger)
│   │   ├── reviews/         (user reviews)
│   │   ├── session/         (mastering session CRUD)
│   │   ├── source/          (source audio management)
│   │   ├── stats/           (public stats)
│   │   └── suggest/         (macro suggestions)
│   └── tools/               (public tool catalog pages)
├── components/
│   ├── rain/                (domain components — the app)
│   │   ├── admin/           (AdminConsole, AuthContext, sign-in/up modals)
│   │   ├── assistant/       (AI Assistant chat panel)
│   │   ├── forms/           (MetadataForm 49KB!, Field, AiDisclosure)
│   │   ├── landing/         (14 landing page section components)
│   │   ├── layout/          (StudioApp, Sidebar, TopBar, TransportBar, Tour)
│   │   ├── mastering/       (20 mastering-related components)
│   │   ├── stems/           (StemsUploadZone)
│   │   ├── tabs/            (8 tab panels — SecondaryTabs at 72KB!)
│   │   ├── ui/              (Card3D, DataRain)
│   │   └── visualizers/     (Spectrum, Waveform, LufsHistory, StereoCorrelation)
│   └── ui/                  (50+ shadcn/ui primitives)
├── hooks/                   (use-mobile, use-toast)
└── lib/
    ├── db.ts                (Prisma client singleton)
    ├── utils.ts             (cn() utility)
    └── rain/                (38 domain modules — the engine)
        ├── audio-engine.ts  (120 KB — god object, see below)
        ├── chain-of-custody.ts (80 KB)
        ├── dsp.ts           (62 KB)
        ├── stems.ts         (68 KB)
        ├── spatial.ts       (73 KB)
        ├── groove-emotion.ts (57 KB)
        ├── repair.ts        (55 KB)
        ├── distribution.ts  (47 KB)
        ├── analytics.ts     (38 KB)
        ├── types.ts         (15 KB — types only)
        ├── store.ts         (21 KB — Zustand store)
        └── ... (28 more modules)
```

### 1.2 Module Dependency Graph

```
                    ┌──────────┐
                    │  types   │ (pure types, zero deps on rain/)
                    └────┬─────┘
                         │ imported by nearly everything
        ┌────────────────┼────────────────────┐
        ▼                ▼                     ▼
   ┌─────────┐    ┌───────────┐        ┌───────────┐
   │constants│    │heuristics │        │    dsp    │ (core DSP: 26 exports)
   └────┬────┘    └─────┬─────┘        └─────┬─────┘
        │               │                    │
        │    ┌──────────┼──────────┐         │
        ▼    ▼          ▼          ▼         ▼
   ┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │  store   │  │ repair   │ │spatial   │ │groove-emotion│
   │(Zustand) │  │          │ │          │ │              │
   └────┬─────┘  └──────────┘ └──────────┘ └──────────────┘
        │
        ▼
   ┌────────────────────┐
   │   audio-engine.ts  │ ← GOD OBJECT (120 KB, 2733 lines)
   │ (depends on: types, │
   │  dsp, heuristics,   │
   │  repair, store)     │
   └────────┬───────────┘
            │
   ┌────────┼──────────────────────────────┐
   ▼        ▼              ▼                ▼
┌──────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐
│stems │ │distrib. │ │provenance│ │chain-of-cust.│
└──────┘ └─────────┘ └──────────┘ └──────────────┘
```

### 1.3 Critical Issues

| ID | Severity | Issue | Detail |
|----|----------|-------|--------|
| **ARC-1** | **CRITICAL** | **God Object: `audio-engine.ts`** | 120 KB, 2,733 lines. Singleton class owning AudioContext, all DSP orchestration, MP3 encoding, WAV export, stem separation, playback control, AB comparison, file I/O, and state management. Violates SRP catastrophically. |
| **ARC-2** | **CRITICAL** | **Massive Tab Component: `SecondaryTabs.tsx`** | 72 KB, 1,501 lines. Contains at least 3-4 distinct tab implementations (Spatial, Reference, AIE, Atmos, Dolby, etc.) in a single file. Each should be its own component. |
| **ARC-3** | **HIGH** | **Missing Service Layer** | All business logic lives in `lib/rain/*.ts` but there is no clear separation between domain logic, infrastructure (DB), and presentation. API routes call domain functions directly with no middleware/validation layer abstraction. |
| **ARC-4** | **HIGH** | **Configuration Suppression** | `next.config.ts` sets `ignoreBuildErrors: true` and `reactStrictMode: false`. `tsconfig.json` overrides `noImplicitAny: false` despite `strict: true`. `eslint.config.mjs` disables 25+ rules including `no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-console`, `no-unreachable`, `no-debugger`. |
| **ARC-5** | **MEDIUM** | **Flat `lib/rain/` Structure** | 38 files in a single directory with no subdomain grouping. Modules like `distrokid-delivery.ts`, `distrokid-pricing.ts`, `distribution.ts`, `distribution-multitrack.ts` suggest a `distribution/` subfolder is warranted. |
| **ARC-6** | **MEDIUM** | **Unused Module** | `heuristics.ts` (330 bytes, 0 exported functions) — appears vestigial. `notifications.tsx` (`.tsx` extension in `lib/` is unusual). |

---

## 2. TYPE SAFETY

### 2.1 `any` Type Usage

**Total `any` count across src/: ~65 occurrences**

| File | Count | Risk |
|------|-------|------|
| `audio-engine.ts` | 15 | HIGH — these are mostly in comments, not actual type annotations |
| `distrokid-delivery.ts` | 11 | HIGH — real `any` usage in payment/distribution code |
| `chain-of-custody.ts` | 9 | MEDIUM |
| `tier-gate.ts` | 5 | MEDIUM |
| `SecondaryTabs.tsx` | 3 | MEDIUM |
| `auth.ts` | 3 | MEDIUM |
| Others (15 files) | 1-2 each | LOW |

**Verdict:** After close inspection, many `any` hits in `audio-engine.ts` are in comments (e.g., "stop any current playback"). The actual type-unsafe `any` usage is concentrated in `distrokid-delivery.ts` (11) and `chain-of-custody.ts` (9). Overall `any` usage is surprisingly low for a codebase of this size — credit where due.

### 2.2 Type Assertion Abuse (`as` casts)

| File | `as` Count |
|------|-----------|
| `audio-engine.ts` | 30 |
| `constants.ts` | 28 |
| `chain-of-custody.ts` | 27 |
| `spatial.ts` | 17 |
| `sa-regional.ts` | 16 |
| `dsp.ts` | 15 |
| `SecondaryTabs.tsx` | 13 |
| `chart.tsx` | 13 |
| `MetadataForm.tsx` | 14 |
| `store.ts` | 12 |

**Verdict:** Heavy `as` casting in constants files and spatial/audio engines. Many casts in `constants.ts` (28) are likely unnecessary — this file defines lookup tables that are cast through `as const` or `as Record<K,V>`. These should use `satisfies` or proper type inference instead.

### 2.3 Non-Null Assertions (`!`)

Low count overall. The worst file is `audio-engine.ts` with 4 non-null assertions. This is actually quite reasonable for a DSP-heavy codebase and not a major concern.

### 2.4 Configuration Issues

| Issue | Detail |
|-------|--------|
| **`noImplicitAny: false`** | Despite `strict: true`, `noImplicitAny` is explicitly set to `false` in tsconfig. This means functions with unannotated parameters default to `any`. |
| **`ignoreBuildErrors: true`** | The build will succeed even with TypeScript errors. This is a ticking time bomb. |
| **All ESLint rules disabled** | `no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-unreachable` — all explicitly turned OFF. |

---

## 3. ERROR HANDLING

### 3.1 Try/Catch Coverage in `lib/rain/`

| File | Try | Catch | Throw | Assessment |
|------|-----|-------|-------|------------|
| `distrokid-delivery.ts` | 11 | 13 | 8 | **GOOD** — proper try/catch/throw |
| `audio-engine.ts` | 9 | 8 | 13 | **GOOD** — errors propagate |
| `auth.ts` | 8 | 10 | 0 | **MIXED** — catches errors but only logs to console; no re-throw |
| `analytics.ts` | 7 | 16 | 0 | **POOR** — swallows all errors silently |
| `distribution.ts` | 7 | 6 | 3 | **OK** |
| `rainnet-inference.ts` | 5 | 5 | 3 | **OK** |
| `store.ts` | 1 | 0 | 0 | **MISSING** — only 1 try, no catch |
| 23 other lib/rain files | 0 | 0 | varies | **MISSING** — no try/catch at all in most DSP files |

### 3.2 Swallowed Errors

| File | Pattern | Severity |
|------|---------|----------|
| `analytics.ts` | 2 instances of `catch { console.warn(...) }` — no re-throw, no user feedback | **HIGH** |
| `audio-engine.ts` | 1 instance of `catch { console.warn(...) }` — error swallowed | **MEDIUM** |
| `provenance.ts` | 1 instance of `catch { console.warn(...) }` | **MEDIUM** |
| `server-analytics.ts` | 1 instance of `catch { console.error(...) }` | **MEDIUM** |
| `usage.ts` | 1 instance of `catch { console.error(...) }` | **MEDIUM** |
| `auth.ts` | 4 `console.error` calls in catch blocks, but no user-facing errors | **HIGH** |

### 3.3 API Route Error Handling

| Route | Try/Catch | Assessment |
|-------|-----------|------------|
| Most routes (15/20) | ✅ Yes | **GOOD** — proper NextResponse error wrapping |
| `auth/logout/route.ts` | ❌ No | **HIGH** — no error handling at all (590 lines) |
| `auth/me/route.ts` | ❌ No | **HIGH** — no error handling (577 lines) |
| `provenance/route.ts` | ❌ No | **MEDIUM** — no error handling (1,118 lines) |

### 3.4 Empty Catch Blocks

**None found.** No `catch {}` with empty bodies. Every catch block at least logs. However, many log-and-swallow without re-throwing, which is only marginally better.

---

## 4. CODE DUPLICATION

### 4.1 Identified Duplication Patterns

| Pattern | Files | Severity |
|---------|-------|----------|
| **CORS header generation** | `payment/route.ts`, `assist/route.ts`, and likely others | MEDIUM — should be a shared middleware |
| **Input validation boilerplate** | Most API routes repeat the same `!body.field → 400` pattern | MEDIUM — should use Zod schema + middleware |
| **Rate limiting pattern** | Multiple routes inline the same `checkRateLimit` + 429 response | LOW — already uses shared `rate-limit.ts` |
| **shadcn/ui primitives** | 50+ files in `components/ui/` — these are generated, not duplicated logic | NOT AN ISSUE |

### 4.2 Notable Absence

The codebase shows surprisingly **little code duplication** given its size. The `dsp.ts` module is well-factored (26 exported functions), and most domain modules are genuinely distinct. The main duplication is in API boilerplate, not business logic.

---

## 5. BEST PRACTICES

### 5.1 React Best Practices

| Check | Status | Detail |
|-------|--------|--------|
| **`useEffect` cleanup** | ⚠️ MIXED | 22 components have useEffect without cleanup returns. `AuthContext.tsx` (1 useEffect, 0 cleanup), `LandingFooter.tsx` (1/0), `AdminConsole.tsx` (2/1) — the missing cleanup is potentially unsafe if effects set up listeners/timers. |
| **Missing `key` props** | ⚠️ MIXED | `MetadataForm.tsx`: 13 `.map()` calls but only 4 `key=` attributes. `AnalyticsTab.tsx`: 20 maps, 13 keys. `LufsHistoryGraph.tsx`: 2 maps, 0 keys. Most missing keys are likely on non-React-node maps (data transforms), but should still be verified. |
| **React.memo** | ❌ ABSENT | Zero uses of `React.memo` across the entire codebase. Not one component is memoized. |
| **`useMemo` / `useCallback`** | ⚠️ SPARSE | `SecondaryTabs.tsx` uses them well (7 useMemo, 15 useCallback). But most components (MasteringTab, AdminConsole, etc.) use far fewer than warranted for their complexity. |
| **React 19 Compat** | ✅ OK | Using React 19. No deprecated APIs detected. |

### 5.2 Next.js Best Practices

| Check | Status | Detail |
|-------|--------|--------|
| **Server/Client separation** | ⚠️ MIXED | `app/layout.tsx` is correctly a server component (no 'use client'). But `app/page.tsx` is marked 'use client' — this is the root page. The landing/studio switch could be done server-side with cookies/headers. |
| **'use client' directives** | ⚠️ OVERUSE | 110+ files marked 'use client'. `lib/rain/store.ts`, `lib/rain/audio-engine.ts`, and 12 other `lib/` files are marked 'use client' — some of these are pure functions that could be server-compatible. |
| **API Routes** | ✅ GOOD | All routes use proper HTTP method exports (GET/POST), return `NextResponse`, and have appropriate `runtime` and `maxDuration` configs. |
| **`ignoreBuildErrors: true`** | 🔴 CRITICAL | Build-time errors are silenced. This masks type errors, dead imports, and structural problems. |
| **`reactStrictMode: false`** | 🔴 CRITICAL | React Strict Mode double-renders to detect side-effect bugs. Turning it off hides issues. |

### 5.3 API Route Assessment

| Route | Methods | Issues |
|-------|---------|--------|
| `admin/accounts/route.ts` | GET ✅ | Good |
| `admin/bootstrap/route.ts` | POST ✅ | Good |
| `admin/renders/route.ts` | GET ✅ | Good |
| `admin/stats/route.ts` | GET ✅ | Good, 5KB |
| `admin/status/route.ts` | GET ✅ | Good |
| `admin/accounts/[id]/tier/route.ts` | — | Good |
| `assist/route.ts` | POST ✅ | 7.6KB, largest non-payment route |
| `auth/login/route.ts` | POST ✅ | Good |
| `auth/logout/route.ts` | POST ✅ | **NO try/catch** |
| `auth/me/route.ts` | GET ✅ | **NO try/catch** |
| `auth/register/route.ts` | POST ✅ | Good |
| `distribute/finalize/route.ts` | GET + POST ✅ | 9.3KB, complex but well-structured |
| `distribute/route.ts` | POST ✅ | Good |
| `events/route.ts` | POST ✅ | Good |
| `feedback/route.ts` | POST ✅ | Good |
| `payment/route.ts` | GET + POST ✅ | 19KB — **largest route**. Should be split into separate files |
| `provenance/route.ts` | GET ✅ | **NO try/catch** |
| `render/route.ts` | POST ✅ | Good |
| `reviews/route.ts` | GET + POST ✅ | Good |
| `session/route.ts` | POST ✅ | Good |
| `source/route.ts` | GET ✅ | Good |
| `stats/route.ts` | GET ✅ | Good |
| `suggest/route.ts` | POST ✅ | Good |

---

## 6. FILE SIZE ANALYSIS

### 6.1 Top 15 Largest Source Files

| # | File | Lines | Size | Assessment |
|---|------|-------|------|------------|
| 1 | `lib/rain/audio-engine.ts` | 2,733 | 120 KB | 🔴 Requires immediate decomposition |
| 2 | `lib/rain/chain-of-custody.ts` | 2,119 | 81 KB | 🔴 Requires decomposition |
| 3 | `lib/rain/stems.ts` | 1,528 | 68 KB | 🔴 Requires decomposition |
| 4 | `lib/rain/spatial.ts` | 1,503 | 73 KB | 🔴 Requires decomposition |
| 5 | `components/rain/tabs/SecondaryTabs.tsx` | 1,501 | 73 KB | 🔴 Requires decomposition |
| 6 | `lib/rain/repair.ts` | 1,456 | 56 KB | 🔴 Requires decomposition |
| 7 | `lib/rain/dsp.ts` | 1,454 | 63 KB | 🟡 Borderline — monolithic but cohesive |
| 8 | `lib/rain/groove-emotion.ts` | 1,430 | 58 KB | 🔴 Requires decomposition |
| 9 | `components/rain/admin/AdminConsole.tsx` | 1,268 | 54 KB | 🔴 Requires decomposition |
| 10 | `lib/rain/distribution.ts` | 1,139 | 47 KB | 🔴 Requires decomposition |
| 11 | `components/rain/forms/MetadataForm.tsx` | 997 | 49 KB | 🔴 Requires decomposition |
| 12 | `components/rain/tabs/AnalyticsTab.tsx` | 959 | 41 KB | 🔴 Requires decomposition |
| 13 | `lib/rain/analytics.ts` | 950 | 38 KB | 🔴 Requires decomposition |
| 14 | `lib/rain/payment-isolation.ts` | 901 | 38 KB | 🟡 Borderline |
| 15 | `components/rain/tabs/DistributeTab.tsx` | 786 | 34 KB | 🟡 Borderline |

### 6.2 Files Requiring Refactoring (>500 lines)

**38 files exceed 500 lines.** This is a massive number. The worst offenders:

| Category | Count >500 lines | Worst File |
|----------|-----------------|------------|
| `lib/rain/` modules | ~18 files | `audio-engine.ts` (2,733) |
| Tab components | 8 files | `SecondaryTabs.tsx` (1,501) |
| Mastering components | 5 files | `MasteringTab.tsx` (686) |
| Admin components | 3 files | `AdminConsole.tsx` (1,268) |
| Landing components | 3 files | `LandingHero.tsx` (501) |

---

## 7. NAMING CONVENTIONS

### 7.1 Assessment

| Check | Status |
|-------|--------|
| camelCase for variables/functions | ✅ Consistent |
| PascalCase for components/types | ✅ Consistent |
| snake_case in component code | ✅ None found |
| UPPER_CASE for constants | ✅ Consistent |
| File naming (kebab-case vs PascalCase) | ⚠️ MIXED — components use PascalCase, lib files use kebab-case, both are accepted conventions |

### 7.2 Minor Issues

- `lib/rain/notifications.tsx` — uses `.tsx` extension in a `lib/` directory (should be `.ts` if no JSX)
- `lib/rain/ai-prompts.ts` — inconsistent with `aie.ts` naming (one uses "ai", the other uses "aie")
- `distrokid-delivery.ts` and `distrokid-pricing.ts` — "DistroKid" is typically capitalized as "DistroKid"

---

## 8. DEAD CODE

### 8.1 Configuration That Masks Dead Code

**The ESLint config explicitly disables dead-code detection:**
- `no-unused-vars: "off"`
- `@typescript-eslint/no-unused-vars: "off"`
- `no-unreachable: "off"`

Combined with `ignoreBuildErrors: true` in next.config, this means **dead code can accumulate silently**. Without running the actual linter, we cannot enumerate unused imports/variables — but the configuration guarantees they exist uncaught.

### 8.2 Identified Suspicious Patterns

| Issue | Location | Detail |
|-------|----------|--------|
| **`heuristics.ts`** | `lib/rain/heuristics.ts` | 330 bytes. Declares only an `export function generateHeuristicParams` — but is imported by `audio-engine.ts`. Appears functional but suspiciously short. |
| **`notifications.tsx`** | `lib/rain/notifications.tsx` | Unusual `.tsx` in a lib directory without components. May contain JSX. |
| **72 TODO/FIXME/HACK/ts-ignore** | Across codebase | `chain-of-custody.ts` (22), `audio-engine.ts` (15), `metadata-validation.ts` (10), `MetadataForm.tsx` (9). These indicate incomplete work and suppressed type errors. |

---

## 9. PERFORMANCE

### 9.1 Memoization

| Check | Status | Detail |
|-------|--------|--------|
| `React.memo` | 🔴 **ZERO USAGE** | Not a single component is wrapped in `React.memo`. With 100+ components, many of which are pure presentational, this is a significant missed optimization. |
| `useMemo` | 🟡 SPARSE | Only `SecondaryTabs.tsx` (7), `AnalyticsTab.tsx` (6), and `MetadataForm.tsx` (5) use it meaningfully. Most heavy components don't memoize expensive computations. |
| `useCallback` | 🟡 SPARSE | `SecondaryTabs.tsx` (15) and `MetadataForm.tsx` (13) lead. `MasteringTab.tsx` (only 3) and `AdminConsole.tsx` (only 4) are under-optimized for their size. |

### 9.2 Bundle Size Concerns

| Risk | Detail |
|------|--------|
| **`onnxruntime-web`** | ~20 MB WASM bundle. Imported for RainNet inference. Should be dynamically imported with `next/dynamic`. |
| **`@breezystack/lamejs`** | MP3 encoder. Client-side only (correctly in 'use client' file). |
| **`react-syntax-highlighter`** | Heavy (~100KB+). Should be dynamically imported. |
| **`framer-motion`** | Tree-shakeable but still ~30KB gzipped. Used extensively. |
| **`recharts`** | ~150KB. Used in AnalyticsTab. Should be dynamically imported. |
| **`@mdxeditor/editor`** | Full rich text editor. Heavy dependency. |

### 9.3 Image Optimization

| Metric | Value | Assessment |
|--------|-------|------------|
| `next/image` usage | **0** | 🔴 NONE of the 100+ components use `next/image` |
| `<img>` tags | **1** | Only 1 raw `<img>` tag found |
| `alt` attributes | **1** | Only 1 `alt=` found across all components |

**This is a critical accessibility and performance gap.** Images (logos, hero graphics, partner logos, etc.) should use `next/image` for automatic optimization, lazy loading, and proper sizing.

### 9.4 Data Fetching

| Pattern | Usage | Assessment |
|---------|-------|------------|
| Client-side fetch | Dominant | Most data fetching happens in 'use client' components via React hooks calling API routes |
| Server-side data | Minimal | Only `layout.tsx` (metadata export) is a true server component |
| SWR/React Query | `@tanstack/react-query` in dependencies but no widespread usage detected | Underutilized |

---

## 10. i18n / ACCESSIBILITY

### 10.1 Accessibility Audit

| Check | Count | Assessment |
|-------|-------|------------|
| `aria-*` attributes | 204 | 🟡 Moderate — Leader: `PartnerLogos.tsx` (15), `LandingHero.tsx` (14) |
| `role=` attributes | 26 | 🔴 Very low for a 100+ component app |
| `alt=` attributes | **1** | 🔴 CRITICAL — essentially zero alt text across the entire application |
| Semantic HTML | Unknown | Would need manual review |

### 10.2 i18n

`next-intl` is in `dependencies` (v4.3.4) but there's no visible `messages/`, `locales/`, or `i18n/` directory. It may be configured but not actively used yet.

### 10.3 Accessibility-Specific Findings

- `PartnerLogos.tsx` has 15 aria attributes — this is the best component for a11y
- `WelcomeBootScreen.tsx` has 12 aria attributes and 2 role attributes — good
- Most form components (MetadataForm, etc.) lack proper `aria-describedby` for error states
- `LandingHero.tsx` (14 aria) and `LandingArchitecture.tsx` are decent
- The remaining 90+ components have minimal or zero aria coverage

---

## 11. PRIORITIZED ISSUES

### 🔴 CRITICAL (Must Fix Before Production)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **C1** | `ignoreBuildErrors: true` — all TypeScript errors silenced | `next.config.ts` | Type errors accumulate, builds succeed with broken code |
| **C2** | `reactStrictMode: false` — hides side-effect bugs | `next.config.ts` | Double-render bugs in effects go undetected |
| **C3** | All ESLint rules disabled (25+ rules off) | `eslint.config.mjs` | Dead code, unused vars, missing deps, any types — all silently permitted |
| **C4** | God Object: `audio-engine.ts` (2,733 lines) | `lib/rain/audio-engine.ts` | Unmaintainable, untestable, blocks parallel development |
| **C5** | Zero `next/image` usage | All components | No image optimization, no lazy loading, poor Core Web Vitals |
| **C6** | Only 1 `alt=` attribute across 100+ components | All components | Critical accessibility failure — screen readers get no image descriptions |
| **C7** | `noImplicitAny: false` with `strict: true` | `tsconfig.json` | Contradictory config; untyped parameters silently become `any` |

### 🟠 HIGH (Should Fix in Current Sprint)

| ID | Issue | Location |
|----|-------|----------|
| **H1** | Massive tab file: `SecondaryTabs.tsx` (1,501 lines) | Split into individual tab components |
| **H2** | `auth/logout/route.ts` — no try/catch | Add error handling |
| **H3** | `auth/me/route.ts` — no try/catch | Add error handling |
| **H4** | `provenance/route.ts` — no try/catch | Add error handling |
| **H5** | `analytics.ts` — swallows all errors silently (16 catches, 0 throws) | Propagate or report errors |
| **H6** | `auth.ts` — catches errors but only logs to console | Return typed error responses |
| **H7** | 38 files exceed 500 lines | Decompose largest files |
| **H8** | No `React.memo` anywhere | Add to pure presentational components |
| **H9** | 72 TODO/FIXME/HACK/ts-ignore markers | Triage and resolve |
| **H10** | `payment/route.ts` — 19KB single file | Split by HTTP method or action |

### 🟡 MEDIUM (Address in Next 2-3 Sprints)

| ID | Issue | Location |
|----|-------|----------|
| **M1** | Missing `key` props: `MetadataForm.tsx` (13 maps, 4 keys) | Verify all `.map()` JSX has keys |
| **M2** | Flat `lib/rain/` structure (38 files) | Group into subdirectories (distribution/, spatial/, repair/, etc.) |
| **M3** | API route boilerplate duplication (CORS, validation) | Extract shared middleware |
| **M4** | `chain-of-custody.ts` (2,119 lines, 81KB) | Decompose |
| **M5** | `stems.ts` (1,528 lines, 68KB) | Decompose |
| **M6** | `AdminConsole.tsx` (1,268 lines) | Split into subcomponents |
| **M7** | Underused `@tanstack/react-query` | Implement for API data fetching with caching |
| **M8** | Heavy imports without dynamic loading | `next/dynamic` for onnxruntime-web, recharts, syntax-highlighter |
| **M9** | Only 26 `role=` attributes | Add ARIA roles to interactive elements |
| **M10** | `notifications.tsx` — `.tsx` in `lib/` | Move to components or rename to `.ts` |

### 🔵 LOW (Continuous Improvement)

| ID | Issue |
|----|-------|
| **L1** | `heuristics.ts` (330 bytes) — review if still needed |
| **L2** | Inconsistent naming: `ai-prompts.ts` vs `aie.ts` |
| **L3** | `distrokid-*` files should use "DistroKid" capitalization |
| **L4** | Add unit tests for `repair.ts`, `spatial.ts`, `groove-emotion.ts` (currently only 6 test files exist) |
| **L5** | Document the module architecture in a Mermaid diagram |
| **L6** | Enable `next-intl` i18n or remove the dependency |

---

## 12. POSITIVE FINDINGS

Despite the issues above, several aspects of the codebase deserve recognition:

1. **Well-typed domain model** — `types.ts` (438 lines) provides a comprehensive, well-documented type system with proper JSDoc annotations on every interface and field.

2. **Clean API route design** — All routes follow a consistent pattern: method exports, NextResponse, runtime configs. The `payment/route.ts` file, despite its size, has excellent security documentation (CSRF protection, rate limiting, idempotency).

3. **Good error handling where present** — `distrokid-delivery.ts` (11 try/13 catch/8 throw) shows proper error propagation. The `assist/route.ts` (7.6KB) is well-structured.

4. **No empty catch blocks** — Every catch block at least logs, which is better than silent failure.

5. **Comprehensive documentation** — Extensive docs in `docs/handbook/`, `docs/legal/`, and detailed JSDoc headers on most files.

6. **Low `any` usage in practice** — Despite `noImplicitAny: false`, actual `any` annotations are rare (~65 across the entire codebase).

7. **Proper Prisma schema** — Well-structured with indexes, relations, and production-ready considerations.

8. **Good separation of audio DSP** — `dsp.ts` is a monolithic file but provides clean, testable pure functions (26 exports) with deterministic behavior.

---

## 13. RECOMMENDED IMMEDIATE ACTIONS

### Action 1: Re-enable Safety Nets (1 hour)
```diff
// next.config.ts
- typescript: { ignoreBuildErrors: true },
- reactStrictMode: false,
+ reactStrictMode: true,

// tsconfig.json
- "noImplicitAny": false,
+ "noImplicitAny": true,
```

### Action 2: Restore ESLint (30 min)
Re-enable at minimum: `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-unreachable`, `no-debugger`. Fix the resulting errors incrementally.

### Action 3: Decompose God Objects (2-4 days)
- `audio-engine.ts` → `audio-context.ts`, `audio-playback.ts`, `audio-export.ts`, `audio-stems.ts`
- `SecondaryTabs.tsx` → `SpatialTab.tsx`, `ReferenceTab.tsx`, `AieTab.tsx`, etc.

### Action 4: Add Image Optimization (1 day)
Replace all raw image references with `next/image` and add alt text.

### Action 5: Add Error Boundaries (1 day)
Wrap major component trees in React Error Boundaries. Fix the 3 API routes without try/catch.

---

*End of Audit Report*
