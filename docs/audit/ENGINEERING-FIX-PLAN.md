# RAIN V6.COM — Full-Stack Engineering Fix Plan

Status: Engineering plan and release-gate specification
Prepared: 2026-10-27
Target branch: codex/bring-code-to-readme-2026-10-27
Base branch: release-candidate
Authority: the README/product specification is the intended target. This plan does not lower requirements to match incomplete code.

## Executive decision

Do not merge or call this stack production-ready until the P0 gates below are evidenced. Work in small, reviewable commits on the existing recovery branch/PR. Keep the live beta and commercial launch distinct. Preserve browser-local audio processing where intended, while using the server for identity, entitlements, durable records, payment verification, quotas and audit events.

The order is deliberate: establish reproducible builds and a trustworthy database first; then persistent identity and projects; then entitlement/accounting and payment; then audio/export integrity; then AI/stems/spatial; then provenance and distribution; finally deployment, privacy, monitoring and release evidence.

## Product rules to implement

1. Beta users receive two free full-capability use credits.
2. After those credits are consumed, gated use requires a verified R49.00 ZAR payment/unlock.
3. Paid beta users retain full capability subject to a fair-use ceiling of 30 successful exports per defined monthly period.
4. At commercial launch, introduce the full tiered subscription model without changing account identity or losing eligible history.
5. Prior session-only beta activity is unavailable. Historical accounts, hours, saved work, exports and AIE activity must be labelled unknown, not reconstructed or presented as measured zero.
6. Audio stays in the browser unless a separately disclosed, explicit feature requires upload. Project persistence may save metadata/settings, but must clearly state when source audio must be reselected.
7. Missing models, credentials, standards compliance or untested integrations must be gated and labelled accurately.
8. No entitlement may be granted from client flags, local storage, redirect URLs or an unverified callback. Provider verification and durable, idempotent server-side state are required.

### Decisions to record before enabling paid traffic

- Credit unit: the current code appears to count successful exports, while the product requirement says two full-capability use credits. Define whether one credit means one complete mastering run, one export, or one session. Do not silently conflate these.
- R49 duration/renewal: confirm once-off unlock versus recurring/monthly payment. Keep checkout disabled until explicit.
- Monthly boundary: recommendation is calendar month in a documented timezone, with accounting in UTC and clear South African local-time display.
- Export accounting: count only completed, valid output files; failed/cancelled exports do not count; retries are idempotent. Decide whether each format output counts separately.
- Provider: select PayFast, Ozow or Stripe for the first live implementation; verify merchant access and sandbox credentials.

## Workstreams and dependency order

### W0 — Repository/build integrity (P0 prerequisite)
- Reconcile main, release-candidate, recovery branch and implementation PR. Record base/head SHAs and divergence. Do not force-push or merge over unreviewed commits.
- Clean-install from the committed lockfile. Align package manager, runtime versions and README commands.
- CI must run lint, TypeScript, unit tests, Prisma validation/client generation, production build, DB integration tests and targeted browser tests.
- Verify model files are real Git LFS objects, not pointer files, and match SHA-256 manifests. Ensure production packaging includes required artifacts.
- Record command, commit SHA, environment, outcome and logs. Source inspection is not a passing test.

Acceptance: clean install, typecheck, lint, unit tests, database integration suite, production build and artifact checks pass on the exact PR head.

### W1 — Durable accounts, sessions and projects (P0)
- PostgreSQL is the canonical production database. Use versioned migrations only; no SQLite/build-time snapshot or ephemeral filesystem DB in deployed runtime.
- Verify registration, login, logout, reset-token lifecycle, cookie flags, expiry, revocation, CSRF and ownership. Ensure persistent accounts are available to the promised beta user journey, not just an Enterprise admin door.
- Verify owner-scoped project CRUD/autosave. Document what persists (metadata/settings/status/hashes) versus what does not (source audio).
- Add appropriate constraints/indexes for ownership, event idempotency and quota queries.
- Configure deployment secrets, TLS, least-privilege DB role, backups, restore rehearsal and migration-before-rollout. Test browser restart and app redeploy.

Acceptance: a new user can return after closing the browser and after a deployment, sign in, restore saved projects and see durable events; backup restore succeeds.

### W2 — Entitlement ledger and beta allowance (P0 before payment)
- Add durable server-side records for entitlement state, free credits, successful uses/exports, quota period, payment references, provider event IDs and state transitions. Use transactions and unique idempotency keys.
- Centralize entitlement evaluation in one server-side policy function. Every gated API action and UI preflight must share this policy; client counters are advisory only.
- Implement two free use credits after the credit unit is confirmed. Reserve/consume atomically to prevent concurrent tabs double-spending or bypassing the gate. Release reservations on failed operations.
- Count the 30-export monthly fair-use limit only for successfully finalized output files. Persist the selected boundary/timezone; prevent retries and duplicate callbacks from double-counting.
- Design anonymous-to-account linking so users cannot reset or arbitrarily combine allowances by changing IDs. Rate-limit and protect linking.
- Until real payment verification and entitlements are complete, show checkout unavailable; never imply payment was taken.

Acceptance tests: new user, two credits, exhausted allowance, paid unlock, 30th/31st export, month boundary, concurrent requests, duplicate/replayed requests, failed export, account linking, local-storage tampering and DB outage. Server remains authoritative.

### W3 — Payment provider and financial correctness (P0; depends on W1–W2)
- Select one provider for launch. Create checkout server-side at fixed R49.00 / 4,900 cents, with currency, account reference and random order ID.
- Verify signed provider webhook/callback against the provider's current contract. A browser redirect is not payment proof.
- Persist pending, verified, failed, cancelled, refunded and disputed states. Verify amount, currency, merchant, order/account reference and event signature.
- Make callback handling idempotent and replay-safe. Never expose secrets or log sensitive payment payloads.
- Sandbox tests: success, wrong amount/currency, bad signature, replay, timeout, duplicate event, cancellation, refund and dispute.
- Count paid conversion only after verified server-to-server confirmation.
- Do not enable live charging until duration/renewal and refund rules are explicit and legal/privacy copy aligns.

Acceptance: one verified sandbox payment creates exactly one entitlement; forged/replayed callbacks cannot grant access; refunds/disputes follow documented policy.

### W4 — Usage telemetry, AIE activity and funder evidence (P0)
- Durable server-side events are the source of truth for account/export/payment metrics. Separate authenticated records, anonymous funnel events and client-local estimates.
- Correct aggregate queries so renders, exports, AIE compute/export, active accounts and last-export timestamps count the right entity/event rather than duplicate the same table count.
- Record events only after the underlying action really succeeded. An analytics request alone must not prove a file was exported; validate fields/ownership and use idempotency.
- Add event schema version, timestamps, consent/retention rules, source and failure observability. Visible-studio duration remains an estimate, not verified work hours.
- Distinguish unavailable/partial/zero in admin reporting. No fabricated metrics or unsupported historical backfill.

Acceptance: integration tests compare UI/admin metrics to durable seeded rows; failed writes show missing/unavailable, not false success; duplicates are deduplicated.

### W5 — Audio pipeline and export correctness (P0)
- Trace all 16 documented stages from action to output bytes. Record executed/skipped/fallback/error state, parameters and timing. Never mark an unexecuted stage complete.
- Test supported formats, sample rates, mono/stereo, silence, clipped input, short/long input, invalid samples, malformed files and aborts.
- Validate resampling, channel routing, LUFS/true peak, loudness target, limiter convergence, dither, bit depth, clipping, encoder failures and metadata.
- Independently decode generated WAV/MP3 and verify duration, sample rate, channel count, bit depth/bitrate, finite samples, loudness and peak tolerances.
- Hash exact exported bytes as well as any pre-encode DSP buffer; clearly name what each hash attests to.
- Finalize export atomically: encoding succeeds, validation passes, then record/quota commits once. Partial/failed exports do not count.
- Maintain browser-first target; desktop software is Enterprise-only at commercial launch. Do not claim local processing if an integration uploads audio.

Acceptance: reproducible browser tests prove real output for each supported export path, DSP tolerances, truthful stage reporting and correct quota accounting.

### W6 — RainNet inference/model integrity (P1 feature-claim blocker)
- Verify actual model files/LFS objects and SHA-256 manifests in build and deployment.
- Inspect ONNX input/output names, shapes, types, normalization, sample-rate assumptions and output mapping against the actual model.
- Exercise WebGPU-to-WASM fallback in supported browsers with timeout, abort and memory limits. Heuristic output must never be labelled neural inference.
- Validate model outputs on real fixtures and establish quality/regression thresholds. Record model version/backend in render metadata.
- If model, compatibility or distribution rights are missing, gate the capability.

Acceptance: real browser inference runs on production model; tampering is rejected; fallback and quality checks are evidenced; licensing/provenance is documented.

### W7 — 12-stem source separation (P1 advertised-feature blocker)
- Do not relabel the existing DSP approximation as neural separation.
- Select a legally distributable model/runtime suitable for browser memory/performance limits. Verify weights and input/output signature.
- Implement preprocessing, chunking/overlap, inference, stem mapping, reconstruction checks, cancellation, memory handling and failure states.
- Test supported duration limits, genres, speech/silence, objective quality metrics and listening review.
- Re-enable UI claims only after real neural inference and complete flow pass.

Acceptance: advertised stems are generated by the actual model, not frequency masks; quality, reconstruction, performance and cancellation are evidenced.

### W8 — RAIN-CERT, hashes and key lifecycle (P1)
- Define whether certificates attest to pre-encode float audio, exact exported bytes, or both. Prefer both with named hashes and a clear transform chain.
- Bind certificates to input hash, exact output-byte hash, engine/build/model identifiers, parameters, timestamp, format and manifest using canonical serialization.
- Keep private keys non-extractable where browser CryptoKey persistence supports it; rotate legacy extractable records and test migration. Distinguish device-local self-signed identity from organisational trust.
- A JSON “C2PA-style” manifest is not necessarily standards-compliant C2PA. Implement actual C2PA container/signature requirements for conformance claims, or label the custom format accurately.
- Never claim watermarking if no watermark was applied. Gate absent AudioSeal/watermark features.
- Independently test tampered audio, manifest claims, certificate fields and signatures across all export formats.

Acceptance: independent verifier rejects tampered bytes/claims, validates signed payload and UI accurately describes trust and standards compliance.

### W9 — DDEX, distribution and providers (P1)
- Separate package-built, package-validated, submitted, provider-accepted, delivered-to-DSP and live-on-store states.
- Validate ERN XML against the applicable official XSD/profile and required metadata/assets. Local packaging or HTTP 2xx alone is not delivery proof.
- Confirm LabelGrid endpoint/auth/payload contract against provider documentation/sandbox; persist job IDs, state transitions, response codes and retries.
- Mark DistroKid browser automation as user-assisted, subject to terms/UI/auth changes; do not imply a stable public API if none exists.
- Verify exact ZIP bytes, artwork/audio/metadata/checksums. Make submission idempotent and recoverable.
- Gate routes without credentials. Keep publishing registration/royalty collection distinct from distribution metadata.

Acceptance: schema/profile validation, provider sandbox acceptance, idempotent retry, package checksum tests and end-to-end status evidence pass.

### W10 — Spatial audio, repair and ancillary features (P1/P2)
- Audit every advertised repair module, spatial renderer, ADM BWF export, QC metric, groove/emotion analysis and genre profile for real execution and correct signal path.
- Test output channels/layout, phase, clipping, loudness and metadata using independent fixtures.
- Gate unsupported Dolby Atmos/ADM BWF claims unless renderer, format and verification exist.
- Label heuristics as heuristics, not trained AI. Feature flags must reflect real capabilities and errors must not become false success.

Acceptance: every feature has source-to-output evidence; unsupported capabilities remain disabled.

### W11 — Security, privacy and operations (P0/P1)
- Audit every API route for authentication, authorization, CSRF, rate limiting, validation, size limits, ownership and safe errors.
- Production rate limiting must use a shared atomic store and fail closed for sensitive endpoints if unavailable. Validate proxy/IP assumptions and test multi-instance behavior.
- Check secrets, admin bootstrap, password reset, cookie flags, origin handling, CORS, uploads, ZIP/XML parsing, SSRF, injection, dependencies and log redaction.
- Align privacy policy with telemetry, account retention, project metadata, payment records and any future audio upload. Add consent/deletion/export flows as applicable.
- Configure health checks, structured logs, error reporting, DB limits, backup alarms, webhook reconciliation and incident/runbook process.

Acceptance: route-by-route security matrix and automated auth/CSRF/rate-limit/ownership tests pass; production secrets/backups are verified without exposing values.

### W12 — Commercial tier migration and launch readiness (P2)
- Model tiered subscriptions separately from beta credits and R49 beta unlock. Entitlements should be capabilities/limits, not scattered UI booleans.
- Preserve account IDs, verified payment history and permitted project/usage records during beta-to-commercial transition.
- Handle checkout, renewal, failed payment, grace period, cancellation, refund, plan change and webhook idempotency.
- Test pricing and entitlements; rehearse migration. Enterprise desktop capabilities must be server-gated as well as hidden in UI.
- Finalize operations, support, privacy, legal, provider and rollback runbooks.

Acceptance: test users migrate beta → paid beta → commercial tiers without identity/history loss or privilege escalation.

## Release gates

### P0 — No merge/release until passed
1. Clean reproducible build and test suite.
2. Persistent account/session/project data verified against actual deployment DB.
3. Server-authoritative entitlement ledger and two-credit policy; exact credit unit documented.
4. Verified provider payment and durable entitlement before live charging.
5. Successful exports durably recorded, idempotent and tied to actual output.
6. Admin/funder metrics derived from verified records and distinguish missing history from zero.
7. Auth, CSRF, rate limiting, ownership and secret handling pass route-level tests.
8. Browser export path and pipeline claims have reproducible evidence.

### P1 — Block affected feature claims
- Real RainNet inference and verified production model assets.
- Real 12-stem neural separation.
- Certificate semantics and independent verification.
- DDEX validation and external provider sandbox delivery.
- Unverified spatial/repair/QC capabilities.

### P2 — Commercial readiness
- Full tiered subscription lifecycle and migration.
- Operational alerting, runbooks, retention/deletion workflow and evidence pack.
- Enterprise-only desktop path and commercial entitlement audit.

## Execution sequence

1. Freeze/record baseline SHAs, branch divergence, PR state and CI results.
2. Commit this plan and use the current implementation PR as review vehicle; keep it draft.
3. Fix build/schema/migration consistency and run clean validation.
4. Complete persistent account/session/project and production database verification.
5. Implement durable entitlements after credit-unit and payment-duration decisions are recorded.
6. Integrate provider sandbox and verify webhooks/idempotency before live charging.
7. Complete export pipeline/quota accounting and run browser E2E.
8. Resolve model/stems/provenance/distribution blockers in separate reviewable commits.
9. Complete security/privacy/deployment checks and assemble release evidence.
10. Merge only after CI, reviewer inspection and all P0 gates pass. Never force-push, overwrite branches or claim production readiness from source changes alone.

## Required evidence pack

For each gate preserve commit SHA, command/test name, environment, pass/fail, logs/artifacts, fixtures, unresolved limitations and verifier for any deployment/provider configuration. Never include credentials, private user data or user audio.

## Current confidence and limitations

This plan is grounded in the repository README, backlog/truth matrix, schema, beta-access/quota code, payment module, analytics, render endpoint, stems capability flags, provenance and rate-limit code. Source inspection cannot establish that the live database, payment provider, browser inference, deployed artifacts, backups or third-party delivery work. Those require runtime and external verification. Proceed in small increments with tests; where the available GitHub connection cannot execute code, changes must remain explicitly unverified rather than being described as tested.
