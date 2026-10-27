# RAINV6.COM — Code-to-README Implementation Backlog

**Branch:** `codex/bring-code-to-readme-2026-10-27`  
**Base:** `release-candidate`

The README remains the target specification. This is a work tracker, not a proposal to reduce the requirements. Do not merge or label the repository production-ready until the release gates pass.

## P0 — Beta usage evidence and access policy

- [ ] **P0.0 Persistent accounts, work, and usage evidence:** deployed beta loses account continuity after a session and retains no reliable hours, saved work, export totals, or AIE activity. Prisma schema and CI now target PostgreSQL with an initial versioned migration and an opt-in independent-connection persistence test. Still verify production DATABASE_URL, migration deployment, backups/restore, and account/session survival across actual deployment restarts. Owner-scoped project list/read/save APIs, debounced settings autosave, and a Saved Projects settings-restore panel are in place. Still test cross-session restore end to end and verify the live production database, migrations, and backups. The build-time SQLite snapshot has been removed and production startup now applies versioned PostgreSQL migrations. Render/export events, AIE compute/export events, visible-studio heartbeats, and admin funnel cards for AIE and R49 paywall/checkout intent are now instrumented. Still validate real deployment writes, add retention/consent notices, and keep visible-studio time labelled as an estimate. Never invent historical metrics. Beta access policy: every available product capability remains open to everyone; first two successful exports are free, then present a R49.00 unlock. The current quota is a client UX gate, not tamper-proof enforcement, because audio export is local. Checkout is not live: configure a real provider, verified callback/webhook, persistent entitlement/payment records, idempotency and failure/refund handling before charging or counting paid conversions. Keep admin/security endpoints protected.

## P0 — Core product and integrity

- [ ] **P0.1 RainNet model runtime:** manifest integrity checks and backend fallback logic are implemented; tests cover graph/external-data hash validation and WebGPU-to-WASM fallback. Still verify the actual ONNX input/output signatures and real model binaries, run browser inference in supported browsers, and validate the heuristic fallback and output quality end to end.
- [ ] **P0.2 RAIN-CERT key lifecycle:** private keys are stored as non-extractable CryptoKey objects and legacy JWK records are rejected. New signatures bind all material certificate claims; independent verification, legacy signature compatibility, and tamper-rejection tests pass in CI. Still add browser tests for IndexedDB key rotation/legacy migration and verify every UI export path.
- [ ] **P0.3 Rate-limit audit:** middleware and route-level helpers now use shared atomic Upstash Redis in production and fail closed on missing configuration/outage; mocked-store tests cover allow, reject, and outage paths. Audit every API route for bypasses, verify proxy/IP trust assumptions, and test a real multi-instance deployment.
- [ ] **P0.4 Authentication/admin:** first-admin bootstrap now requires a deployment-only secret of at least 32 characters and fails closed when unconfigured; comparison is constant-time. Password-hash and session-cookie unit tests were added, session expiry is strict, and proxy protocol parsing is exact. Still test database-backed registration/login/logout/reset, session expiry/revocation, CSRF, and every sensitive route with anonymous/free/admin identities.
- [ ] **P0.5 Real mastering acceptance:** add browser fixtures for supported input formats and active stages; verify output measurements, clipping, true peak, LUFS, stereo, encoder failures, and deterministic DSP tolerances.
- [ ] **P0.6 Finish all advertised stages:** stages 7–9 are honestly gated until a licensed neural separation model is bundled. Source a suitable model, implement actual inference, test separation quality and reconstruction, then re-enable those stages.
- [ ] **P0.7 Export acceptance:** expand independent WAV/MP3 decoding and metadata/provenance tests across longer, multichannel, and cross-browser cases.

## P1 — Distribution and spatial

- [ ] **P1.1 DDEX ERN 4.3.2 XSD/profile validation:** the XML builder now emits ERN 4.3.2 structure and Base64 SHA-256 resource hashes, and local structural tests pass. Official XSD/profile validation remains unimplemented. Vendor or integrate the official schema validator and test valid/invalid fixtures before live submission.
- [ ] **P1.2 Official DDEX identifiers:** obtain and configure the actual registered sender and recipient DPIDs. Format-only validation is not proof that an ID is assigned.
- [ ] **P1.3 LabelGrid contract:** verify the official API endpoint, auth, multipart contract, accepted/rejected response shapes, timeout/retry/idempotency behaviour, and authoritative delivery confirmation using real test credentials.
- [ ] **P1.4 RAIN-CERT/package binding:** retain package signature, asset hash, ZIP integrity, embedded certificate, and tamper tests; add server-route tests for altered manifest/audio/XML/checksums.
- [ ] **P1.5 Spatial output:** validate ADM BWF drafts with independent tools. The current output is not Dolby Atmos-certified; do not restore that product claim until a licensed/validated workflow exists.
- [ ] **P1.6 Remove remaining false-success paths:** legacy finalize is disabled and payment no longer triggers delivery without a ZIP. Audit remaining payment/distribution/admin paths for optimistic status updates.

## P1 — Release engineering

- [ ] **P1.7 CI release gate:** require lint, typecheck, build, tests, and browser smoke tests for `release-candidate` and release PRs; run the latest commit and attach results.
- [ ] **P1.8 Environment validation:** fail startup safely for missing production config; require Redis, DPID, and provider endpoint configuration where applicable.
- [ ] **P1.9 Operations:** database migrations, health/readiness, structured logs, monitoring, graceful dependency failures, and production storage.
- [ ] **P1.10 Release evidence pack:** final commit SHA, clean CI, browser test report, DSP fixture report, XSD validation report, provider sandbox evidence, and known limitations.

## Completion definition

A task is complete only when the code change is committed on this branch, tests cover success and failure paths, available CI passes, and external validation is recorded. Do not claim full shippability while any P0 task remains open.
