# RAINV6.COM — Code-to-README Implementation Backlog

**Branch:** `codex/bring-code-to-readme-2026-10-27`  
**Base:** `release-candidate`

The README remains the target specification. This backlog is a work tracker, not a proposal to reduce advertised scope. Changes should be small, testable, and made on this branch. Do not merge or label the repository production-ready until release gates pass.

## P0 — Correct integrity and security gaps

- [ ] **P0.1 RainNet model integrity (in progress):** implemented SHA-256 checks for ONNX graph and declared external weights; added valid, missing/placeholder, and tamper tests; populated base/trained manifests with Git LFS OIDs and enabled LFS checkout in the CI build job. Still must confirm CI fetches actual LFS objects, validate binary input/output signatures, and pass browser inference tests.
- [ ] **P0.2 Private signing-key storage:** stop serializing the Ed25519 private key as JWK in IndexedDB. Store a non-extractable CryptoKey, retain/export the public key as required, and safely migrate or invalidate legacy key records. Test signing, verification, and tampering.
- [ ] **P0.3 Shared rate limiting:** replace in-memory production enforcement in middleware and library paths with an atomic shared store (for example Upstash Redis REST when configured); establish an explicit safe production response when no shared store is configured. Trust forwarded client IP headers only behind a known proxy.
- [ ] **P0.4 Authentication/admin review:** trace all auth and admin routes, verify server-side role checks and session expiry, and add tests for unauthenticated and non-admin access.

## P0 — Core mastering must be demonstrated

- [ ] **P0.5 Audio acceptance suite:** add repeatable fixtures and browser-level tests for supported file decoding, render completion, stage failures, valid WAV/MP3 export, independent decode, and output measurements.
- [ ] **P0.6 DSP regression:** verify LUFS, true peak, clipping, stereo/channel handling, and determinism against independently calculated reference values and documented tolerances.
- [ ] **P0.7 Stage wiring:** trace every advertised stage to executed code and confirm failures propagate rather than being swallowed or replaced by successful-looking defaults.
- [ ] **P0.8 Stem-separation truth:** the current source describes a TypeScript DSP approximation, not a shipped BS-RoFormer neural model. Implement a real, licensed model path and quality tests before asserting BS-RoFormer separation.

## P1 — Provenance and distribution

- [ ] **P1.1 RAIN-CERT:** bind the signed certificate to a canonical manifest and actual exported asset hashes; test tampering and key identity.
- [ ] **P1.2 DDEX:** validate ERN XML against the relevant schema/profile and validate required metadata and identifiers before packaging.
- [ ] **P1.3 Provider delivery:** test credentials missing, non-2xx, timeout, retry, duplicate submission, and confirmed success. Do not transition to delivered on client assumptions.
- [ ] **P1.4 Spatial package:** validate multichannel WAV/ADM BWF and ZIP contents with independent tooling; distinguish format generation from Dolby certification.

## P1 — Release engineering

- [ ] **P1.5 CI:** ensure the actual build, type check, lint, unit tests, and browser smoke tests are run and their results recorded.
- [ ] **P1.6 Configuration and deployment:** validate required environment variables, database startup/migrations, health/readiness, structured errors, and graceful dependency failures.
- [ ] **P1.7 Product gating:** remove non-functional tabs/actions from the active product surface until the backing workflow passes its acceptance tests.
- [ ] **P1.8 Release evidence pack:** attach commit SHA, test reports, feature truth matrix, known limitations, and deployment checklist.

## Completion definition

A task is complete only when the code change is committed on this branch, tests cover the failure and success paths, available CI passes, and any external validation still outstanding is explicitly recorded. Do not claim full shippability while any P0 task remains open.
