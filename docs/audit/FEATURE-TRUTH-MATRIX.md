# RAINV6.COM Feature Truth Matrix — Working Audit

**Audit branch:** `codex/bring-code-to-readme-2026-10-27`  
**Baseline:** `release-candidate`  
**Rule:** The README remains the target specification. This matrix records code evidence and blockers; it does not lower the README requirements.

## Status definitions

- **Implemented; tests pass:** A repeatable automated test exercises the claimed behaviour.
- **Implemented; external validation pending:** Source and local tests pass, but a real browser, deployment, model artifact, or provider contract remains unverified.
- **Gated / unavailable:** The product UI no longer presents a stub or approximation as the advertised feature.
- **Known gap:** The implementation does not yet meet the README claim.

## Current evidence

| README / product claim | Source evidence | Current status | Remaining work |
|---|---|---|---|
| RainNet v2 ONNX inference with graceful fallback | `src/lib/rain/rainnet-inference.ts` hashes the ONNX graph and declared external-data file and verifies both against the manifest before ONNX Runtime loads them. Base/trained manifests include graph and external-data SHA-256 values matching Git LFS OIDs; CI checkout enables LFS. Tests reject placeholder, missing, and tampered hashes. | **Integrity checks implemented; actual browser inference pending** | Verify that CI and production deployment receive real LFS objects rather than pointer text; inspect actual ONNX input/output signatures; test browser inference and heuristic fallback against the real binaries. |
| RAIN-CERT Ed25519 signing and exported provenance | `src/lib/rain/provenance.ts` stores CryptoKey objects rather than exported private JWKs, rejects legacy extractable private keys, and signs the canonical output hash plus manifest. WAV/MP3 export tests verify certificate ID and signature bytes are embedded when enabled. | **Implementation and automated tests present; independent verification pending** | Test key rotation/legacy migration in a browser; independently verify signatures and tamper detection; confirm every UI export path passes the intended certificate and metadata. |
| Production-safe shared rate limiting | `src/middleware.ts` uses an atomic Upstash Redis REST counter in production and fails closed if the shared store is missing/unavailable; local Map fallback is development-only. | **Middleware path updated; whole-app route audit pending** | Search every API route for separate in-memory limiters; verify proxy/IP trust assumptions; test multi-instance behaviour and Redis outage responses. |
| BS-RoFormer neural 12-stem separation | `src/lib/rain/stems.ts` contains a TypeScript DSP approximation, not a shipped neural model. The active Stems UI disables automatic separation, and the mastering pipeline explicitly skips stages 7–9 until a licensed, verified model is bundled. Landing copy no longer markets the approximation as BS-RoFormer. | **Gated / unavailable** | Bundle a licensed model, implement and validate real inference, test separation quality and output shape, then re-enable UI and pipeline stages only after acceptance tests pass. |
| 16-stage mastering pipeline | Core DSP/render/export code exists and CI exercises DSP helpers and WAV/MP3 encoding. Stages 7–9 are now explicitly skipped because the neural model is absent. LUFS gating and compressor configuration have been corrected. | **Partial; not a complete 16-stage run** | Test real audio files through every active stage; validate LUFS/true peak/clipping/stereo metrics; finish stages 7–9; test failure propagation, unsupported inputs, and browser rendering. |
| WAV/MP3 export integrity | Automated tests verify RIFF/WAVE structure, 24-bit PCM layout, MP3 frame presence, and embedded RAIN-CERT ID/signature when enabled. Distribution integration test verifies ZIP asset sizes and SHA-256 checksums. | **Automated test coverage present; broader interoperability pending** | Decode exports with independent tools; test longer and multichannel inputs, metadata retention, encoder failures, and cross-browser behaviour. |
| DDEX ERN 4.3.2 packaging | `src/lib/rain/distribution.ts` now emits the ERN 4.3.2 namespace/schema location, official Party ID fields, ICPN for UPC/EAN, release/resource/deal structures, AI disclosure, resource URIs, and Base64 SHA-256 HashSum values. Package generation hashes actual WAV/MP3/artwork assets and includes a manifest and checksums. Structural validation uses `fast-xml-parser`. | **Structural checks and package tests implemented; official XSD/profile validation NOT implemented** | Validate against the official ERN 4.3.2 XSD/profile; confirm all mandatory sequence/cardinality/AVS values; verify assigned sender/recipient DPIDs; do not claim schema certification until this passes. |
| LabelGrid provider submission | `POST /api/rain/distribute` receives actual ZIP bytes, checks package SHA-256, embedded manifest, asset hashes, RAIN-CERT signature/embedding, DPID formats, and structural ERN fields. The endpoint URL must be explicitly configured; there is no guessed default. A 2xx response means `submitted` unless the provider explicitly reports `delivered` or `published`. | **Safer submission path implemented; live contract/credentials unverified** | Confirm LabelGrid endpoint and multipart/API contract from official account docs; test credentials, timeouts, provider rejection, retries, duplicate submissions, and authoritative final delivery status. Official ERN XSD validation remains a blocker. |
| Legacy finalize/payment-to-delivery flow | `/api/rain/distribute/finalize` is disabled because it accepted metadata/hash without package bytes. Payment confirmation no longer triggers distribution without the signed ZIP. | **False-success path disabled** | Implement a real payment-to-package handoff only after a complete verified package is available; test payment idempotency and delivery state transitions. |
| Dolby Atmos output | Spatial code generates HRTF binaural/multichannel audio and ADM BWF draft packages. Product UI and generated package README now state that these are experimental and not Dolby Atmos-certified. | **Atmos-certified output not available; spatial draft retained** | Validate ADM/BWF interoperability in a target renderer; implement/licence the required Atmos workflow and certification path before restoring any Dolby Atmos claim. |
| Testimonials and social proof | Fictional testimonials, ratings, and unverified customer logos were removed from the active testimonial component. | **Misleading surface removed** | Add testimonials only with auditable source and publication permission. |
| CI and release gates | `.github/workflows/ci.yml` runs actual Bun tests rather than an always-passing placeholder. Latest completed baseline run recorded 132 passing tests and 0 failures before the most recent distribution/UI changes. | **Real CI enabled; latest commit run pending** | Require lint, typecheck, build, tests, and browser smoke tests on release PRs; rerun after current changes and attach the final SHA/test report. |

## Still-unverified product areas

- Supported input formats: WAV, MP3, FLAC, AIFF, OGG.
- Every mastering stage and all seven macro controls.
- Eight repair modules and measurable effect.
- Eighteen-point QC correctness.
- Admin/auth/session expiry, account isolation, and route authorization.
- Startup environment validation, database migrations, health/readiness, production storage.
- DistroKid browser automation and all external provider integrations.
- Payment providers and disabled-beta payment configuration.
- Full production deployment and independent listening/quality validation.

## Evidence rule

Source presence, comments, UI labels, generated XML, mocks, and structural XML parsing are not proof of production readiness. A capability is marked complete only after repeatable tests and any required external validation pass.
