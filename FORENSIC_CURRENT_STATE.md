# RAIN V6 Beta — Forensic Current-State Assessment

**Audit date:** 2026-10-29  
**Audited ref:** `release-candidate` (read through GitHub source API); audit branch created from this ref: `forensic/current-state-audit-2026-10-29`.  
**Evidence boundary:** GitHub source inspection only. A local checkout could not be obtained in this execution environment (network DNS failure), so no fresh build, test, audio render, browser run, or deployment test was executed. Prior worklog statements are treated as historical leads, not as current proof.  
**Baseline files:** [README](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/README.md), [package.json](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/package.json), [CI workflow](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/.github/workflows/ci.yml), [Prisma schema](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/prisma/schema.prisma).

## Executive assessment

Beta has the clearest directly documented browser-first product path and the worklog records previous local browser verification and a WAV export. However, current commercial readiness is **not established**. The strongest hard finding is that the CI workflow's test job is explicitly a placeholder that always passes, and `package.json` does not define the advertised `bun test` script. The LabelGrid route also explicitly describes its `/v1/deliveries` contract as conventional/assumed rather than verified against the provider's actual API contract. This means export and packaging are promising candidates to verify first, but neither paid launch nor real distribution is proven.

## Evidence status legend

- **Verified working:** reproduced in this audit or backed by a current reproducible automated test.
- **Implemented, unverified:** source implementation exists; current runtime behaviour not demonstrated.
- **Partial / mocked / stubbed:** incomplete or fallback behaviour is visible in source.
- **Documented only:** described but implementation was not established.
- **Blocked / unknown:** unavailable to verify in this environment.

## Baseline and execution record

| Check | Result |
|---|---|
| Source ref | `release-candidate` |
| GitHub source access | Successful |
| Local checkout | Blocked: `git clone` failed because this environment could not resolve github.com |
| Fresh lint/typecheck/build | Not run |
| Fresh test suite | Not run |
| Fresh audio render / independent WAV inspection | Not run |
| Fresh browser E2E | Not run |
| Production deployment, persistence restart, backup restore | Not run |
| CI workflow definition | Inspected; test job is explicitly a passing placeholder |
| Payment/LabelGrid live sandbox | Not run; no credentials or provider access exercised |

The GitHub file URLs resolve to `release-candidate`; the current commit SHA must be pinned from the branch ref when the audit is run in a clone-enabled environment. Do not treat blob SHAs as commit SHAs.

## Findings

### BETA-P0-01 — Commercial release cannot be certified from current evidence
- **Severity:** P0 release gate; evidence limitation rather than proof that all product paths fail.
- **Status:** Blocked / unknown.
- **Evidence:** No fresh build, test run, audio render, production DB exercise or live provider test could be executed in this environment.
- **Impact:** There is no defensible basis yet to advertise a complete paid release or guaranteed delivery.
- **Exit criteria:** Run the acceptance suite in a controlled clone; attach commit SHA, logs and generated audio fixture metrics.

### BETA-P1-01 — CI test job always passes without running tests
- **Status:** Verified in source; runtime CI result not independently queried in this audit.
- **Evidence:** [CI workflow](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/.github/workflows/ci.yml) contains `test` job with `echo "No test suite yet — placeholder passes. See audit finding #6."`; package scripts in [package.json](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/package.json) include dev/build/start/lint/db commands but no `test` script despite README instructions to run `bun test`.
- **Impact:** A green test job is not evidence of test coverage; regressions in critical flows may pass CI.
- **Smallest fix:** Add a real deterministic test suite for audio export, auth/tier gate, distribution failure paths and DDEX validation; make CI fail on test failures.
- **Effort:** M; blocks any claim of verified release quality.

### BETA-P1-02 — LabelGrid endpoint/contract is assumed, not verified
- **Status:** Implemented, not verified; likely integration blocker.
- **Evidence:** [distribution route](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/app/api/rain/distribute/route.ts) defaults to `https://api.labelgrid.com/v1/deliveries` and explicitly says it uses a “conventional REST shape” because the public API contract is not standardised in the spec. The route forwards multipart `jobId`, `manifest`, and ZIP `package`.
- **Impact:** Credentials alone may not enable delivery; endpoint and payload may not match the current provider API. HTTP 2xx alone may not mean a release is accepted, validated or delivered to stores.
- **Smallest fix:** Reconcile endpoint and payload to current official LabelGrid docs; implement validation/submission/status polling and distinguish accepted, processing, rejected and delivered states.
- **Effort:** M/L; blocks automated distribution but not a clearly labelled manual-export MVP.

### BETA-P1-03 — Finalization uses regex/string checks, not full DDEX schema validation
- **Status:** Implemented, not verified.
- **Evidence:** [finalize route](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/app/api/rain/distribute/finalize/route.ts) validates required DDEX elements through string checks such as `includes('ern:NewReleaseMessage')`, `includes('<ISRC>')`, `includes('<UPC>')` and `includes('<AIInvolvement>')`.
- **Impact:** Malformed or semantically invalid XML can pass the preflight check; schema/provider rejection remains possible.
- **Smallest fix:** Validate XML parsing, namespaces and required ERN 4.3.2 XSD/contract rules; test valid and invalid fixtures.
- **Effort:** M; blocks claims of provider-ready package validation.

### BETA-P1-04 — Local package “delivered” state is not equivalent to provider acceptance
- **Status:** Implemented, not verified.
- **Evidence:** [distribution subsystem](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/lib/rain/distribution.ts) documents local states including `delivered` as “Provider returned 2xx”; [API route](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/app/api/rain/distribute/route.ts) returns `ok: true` on any provider 2xx and does not show a follow-up provider acceptance/delivery-status check.
- **Impact:** A transport-level response could be misrepresented to a customer as completed distribution.
- **Smallest fix:** Rename state to `submitted` until provider validation and delivery-status endpoints confirm later states; persist provider ID and reconciliation history.
- **Effort:** S/M; blocks truthful distribution status.

### BETA-P1-05 — Production database parity and persistence remain unverified
- **Status:** Implemented, not verified.
- **Evidence:** [Prisma schema](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/prisma/schema.prisma) sets datasource provider to SQLite and comments that production PostgreSQL migrations/RLS will switch JSON columns to native JSON. README describes SQLite for dev and PostgreSQL for production.
- **Impact:** The schema alone does not prove that the production PostgreSQL migrations, tenant isolation, restart persistence or backup/restore work.
- **Smallest fix:** Execute clean PostgreSQL migrations and cross-user authorization tests; restart services and prove records/files persist; rehearse backup restore.
- **Effort:** M; blocks paid multi-user production if not already validated.

### BETA-P2-01 — Provenance/C2PA claims require artifact-level validation
- **Status:** Implemented, not verified.
- **Evidence:** README describes Ed25519 signatures and a “C2PA v2.2-style manifest (JSON)”; this is a claim to verify, not evidence of formal C2PA conformance.
- **Impact:** A custom manifest must not be marketed as a conformant C2PA credential without validation.
- **Smallest fix:** Verify signatures against output bytes, tamper-test certificates, and label custom manifests accurately unless validated by an independent C2PA implementation.
- **Effort:** M.

## Capability evidence matrix

| Capability | Status | Evidence / next proof |
|---|---|---|
| Studio UI navigation | Historical evidence only | Worklog records browser check; rerun on pinned branch |
| Browser mastering pipeline | Implemented, not verified | README/source claims; run deterministic audio fixtures |
| WAV/MP3 export | Implemented, not verified | Worklog reports a WAV export; independently inspect current artifact |
| Automated tests | Partial / stubbed | CI test job explicitly placeholder; no `test` script in package.json |
| Authentication | Implemented, not verified | [auth.ts](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/lib/rain/auth.ts); run login/session/expiry/logout tests |
| Tier gate | Implemented, not verified | [tier-gate.ts](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/lib/rain/tier-gate.ts); test anonymous and cross-account cases |
| Billing | Blocked / unknown | Current provider checkout/webhook path not located/executed in this source-only pass |
| DDEX package creation | Implemented, not verified | Inspect generated XML and assets; run XSD/provider validation |
| LabelGrid submission | Implemented, not verified | Endpoint/payload assumption explicit in route; no live contract test |
| Provider acceptance/delivery | Documented / unverified | No observed provider lifecycle evidence |
| PostgreSQL/RLS production | Blocked / unknown | Schema declares SQLite; production parity must be exercised |
| Backup/restore | Blocked / unknown | No restore evidence observed in this pass |

## Minimum safe first commercial slice

Potentially fastest MVP, **only after verification**:
1. Browser-based mastering and local WAV/MP3 export.
2. Account/tier gates only if paid features are actually sold; otherwise launch a free/limited beta.
3. Validated export metadata and clear manual distribution package download.
4. Do not promise automatic store delivery, formal C2PA conformance, or source-separation capability until those exact paths are tested.

## Required next commands/tests in a clone-enabled environment

1. `bun install --frozen-lockfile` (or the repository's lockfile-prescribed equivalent).
2. `bun run lint`, `bunx tsc --noEmit`, `bunx prisma validate`, production build.
3. Replace placeholder CI test with a real suite; execute it.
4. Generate synthetic sine, impulse, silence, stereo-phase and clipped fixtures; export WAV/MP3 and independently inspect encoding, duration, channels, sample rate, bit depth, peak/LUFS, metadata and checksum.
5. Test malformed upload, export interruption, anonymous enterprise endpoint, cross-account IDs, missing LabelGrid key, provider 4xx/5xx/timeout and malformed provider 2xx.
6. Run migrations and restart/restore tests on disposable PostgreSQL; never use production data.

## Conclusion

Beta is a plausible candidate for a **manual-export-first MVP**, because it appears to have an integrated browser-facing workflow and an export/package subsystem. That is a candidate assessment, not a launch approval. The CI placeholder, assumed LabelGrid contract, weak DDEX preflight and unverified production persistence are material blockers to calling it a complete commercial release.
