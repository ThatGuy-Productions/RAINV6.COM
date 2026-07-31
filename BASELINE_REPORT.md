# RAIN V6 — Baseline Certification Report

**Generated:** 2026-08-01
**Commit:** 2bd2e9d pre-hardening: snapshot current workspace state
**Branch:** hardening/production-readiness-v1
**Repository Status:** Clean (0 uncommitted changes)

---

## 1. TypeScript Compilation

| Metric | Value |
|--------|-------|
| `tsc --noEmit` errors | **0** |
| `tsc --noEmit` exit code | **0** |
| `strict` mode | **true** |
| `noImplicitAny` | **true** |
| `strictNullChecks` | **true** |
| `noUnusedLocals` | **true** |
| `noUnusedParameters` | **true** |
| Target | ES2020 |

---

## 2. ESLint

| Metric | Value |
|--------|-------|
| ESLint errors | **0** |
| ESLint warnings | **15** |
| `@typescript-eslint/no-explicit-any` | 10 warnings (distrokid-delivery.ts × 10, payment/route.ts × 1) |
| `react-hooks/exhaustive-deps` | 2 warnings (CreativeMacros.tsx, AnalyticsTab.tsx) |
| `@next/next/no-img-element` | 1 warning (DistributeTab.tsx) |
| `eqeqeq` | **error** (enforced) |
| `prefer-const` | **error** (enforced) |
| `no-debugger` | **error** (enforced) |
| `no-unreachable` | **error** (enforced) |

---

## 3. Dependency Audit

| Severity | Count |
|----------|-------|
| **Critical** | 1 (next-auth — homoglyph @ bypass) |
| **High** | 36 (next.js SSRF/DoS, lodash, sharp, postcss, minimatch, etc.) |
| **Moderate** | 29 (ajv, lodash, postcss, picomatch, prismjs, etc.) |
| **Low** | 5 (diff, @babel/core, next.js cache poisoning) |
| **Total** | **71** |

### Critical Vulnerabilities

| Package | Advisory | Severity |
|---------|----------|----------|
| `next-auth` 4.0.6–4.24.14 | GHSA-7rqj-j65f-68wh — Email normalizer validates before Unicode normalization, allowing homoglyph @ bypass | **CRITICAL** |

### High Priority Vulnerabilities

| Package | Key Advisories |
|---------|---------------|
| `next` <16.2.5 | SSRF in Server Actions, Middleware bypass, DoS via Cache Components |
| `sharp` <0.35.0 | libvips CVEs (GHSA-f88m-g3jw-g9cj) |
| `postcss` <8.5.10 | Arbitrary file read, XSS (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849) |
| `lodash` / `lodash-es` ≤4.17.22 | Code injection via template, prototype pollution |
| `next-auth` ≤4.24.14 | Uncaught exception on malformed Bearer headers |
| `minimatch` <3.1.3 | ReDoS via wildcards, extglob backtracking |
| `brace-expansion` <1.1.13 | DoS via exponential-time expansion |
| `flatted` <3.4.0 | Unbounded recursion DoS, prototype pollution |
| `defu` ≤6.1.4 | Prototype pollution via __proto__ |
| `effect` <3.20.0 | AsyncLocalStorage context loss under concurrent load |
| `js-cookie` ≤3.0.5 | Per-instance prototype hijack |
| `picomatch` <2.3.2 | ReDoS via extglob quantifiers |

---

## 4. Build

| Metric | Value |
|--------|-------|
| Build success | **Yes** |
| Build time | **~31s** |
| Build warnings | 1 (metadataBase not set) |
| `reactStrictMode` | **true** |
| `ignoreBuildErrors` | **Not present** (removed) |
| Output mode | `standalone` |

---

## 5. Bundle Size

| Metric | Value |
|--------|-------|
| `.next/` total | **493 MB** |
| `.next/static/` | **30 MB** |
| Largest chunk | **667 KB** (aca75704794a1000.js) |
| Top 5 chunks | 667K, 386K, 318K, 220K, 158K |

---

## 6. Test Results

| Metric | Value |
|--------|-------|
| Test files | **6** |
| Tests passed | **68** |
| Tests failed | **0** |
| Duration | **940ms** |
| Coverage areas | auth-hardening, dsp, sanitize, constants, sa-regional, metadata-validation |

---

## 7. File Counts

| Category | Count |
|----------|-------|
| TypeScript files (src/) | **206** |
| React components | **119** |
| API routes | **24** |
| Lib modules (src/lib/rain/) | **53** |
| Test files | **6** |

---

## 8. Code Quality Markers

| Marker | Count |
|--------|-------|
| TODO | **0** |
| FIXME | **0** |
| HACK | **0** |
| @ts-ignore | **0** |
| @ts-expect-error | **0** |
| `any` type annotations | **12** (11 in distrokid-delivery.ts, 1 in payment/route.ts) |

---

## 9. Security Posture

| Check | Status |
|-------|--------|
| `middleware.ts` | **Present** (234 lines — rate limiting, security headers, XSS sanitization) |
| `sanitize.ts` | **Present** (180 lines — encodeHtml, stripHtml, sanitizeText, field-specific sanitizers) |
| `auth-hardening.ts` | **Present** (scaffolding) |
| `api-utils.ts` | **Present** (shared API utilities) |
| Security headers (CSP, X-Frame-Options, HSTS, etc.) | **Active in middleware** |
| Rate limiting | **Active on sensitive endpoints** |
| `types/onnxruntime-web.d.ts` | **MISSING** |
| `next.config.ts` security headers | **MISSING** (only in middleware, not in headers()) |

---

## 10. Accessibility

| Metric | Value |
|--------|-------|
| `<img>` tags remaining | **1** (DistributeTab.tsx) |
| `next/image` usage | Partial |
| ARIA attributes | Present in key components |
| WCAG AA compliance | **Not verified** |

---

## 11. Performance

| Metric | Value |
|--------|-------|
| `React.memo` usage | **0** |
| `useMemo` usage | Sparse |
| `useCallback` usage | Sparse |
| Dynamic imports | Minimal |
| Heavy bundles (onnxruntime-web, recharts, syntax-highlighter) | **Not lazy-loaded** |

---

## 12. DSP / Audio Baseline

| Metric | Value |
|--------|-------|
| Audio engine architecture | Refactored into 11 modules |
| `audio-engine/engine.ts` | 1,470 lines |
| `dsp.ts` | 1,454 lines (26 exports, pure functions) |
| Mastering regression checksum | **Not yet captured** |
| LUFS reference outputs | **Not yet captured** |
| True Peak reference outputs | **Not yet captured** |
| Export hashes | **Not yet captured** |

> ⚠️ DSP regression baselines must be captured in Phase 9 before any further changes.

---

## 13. Baseline Values for Regression Protection

The following values must be preserved across all subsequent phases:

| Metric | Baseline Value |
|--------|---------------|
| `tsc --noEmit` exit code | 0 |
| ESLint errors | 0 |
| Build success | true |
| Test pass count | 68 |
| Test fail count | 0 |
| `reactStrictMode` | true |
| `ignoreBuildErrors` | absent |
| `noImplicitAny` | true |
| DSP pure functions | 26 exports (unchanged) |
| Audio engine public API | unchanged |

---

*This report is the immutable baseline. Every subsequent phase must preserve these values unless explicitly improving them.*
