# RAINV6.COM Feature Truth Matrix — Working Audit

**Audit branch:** `codex/bring-code-to-readme-2026-10-27`  
**Baseline:** `release-candidate`  
**Purpose:** Track implementation against the existing README and release claims. This document does not replace or lower the README requirements.

## Status definitions

- **Verified in source:** Directly confirmed by source inspection; runtime behaviour may still require tests.
- **Known gap:** Source contains an explicit placeholder, bypass, or implementation that does not satisfy the advertised claim.
- **Not yet verified:** Requires further source tracing, executable tests, browser testing, or external-provider validation.

## Findings confirmed during initial source inspection

| README / product claim | Source evidence | Current status | Required code work |
|---|---|---|---|
| RainNet v2 ONNX inference with graceful fallback | `src/lib/rain/rainnet-inference.ts` now hashes the fetched ONNX graph and declared external-data file with SHA-256 and verifies each against its manifest before ONNX Runtime loads the model. Base and trained manifests now carry hashes matching the Git LFS pointer OIDs; CI build checkout enables Git LFS. | **Implementation updated; runtime verification pending** | Confirm CI obtains actual LFS objects (not pointer text), verify ONNX input/output signatures against the binary, and test browser inference plus heuristic fallback. |
| Model integrity manifest | `public/models/rain_base.manifest.json` and `public/models/rain_trained.manifest.json` now bind model names, expected inference tensors, 46-value parameter output, and graph/external-data SHA-256 values to Git LFS OIDs. The base manifest no longer mislabels RainNet as BS-RoFormer. | **Metadata corrected; binary/runtime validation pending** | Confirm LFS object availability and byte-for-byte hashes in CI/build; inspect actual ONNX signatures; retain a release blocker until browser inference passes. |
| BS-RoFormer 4-pass cascade producing 12 stems | `src/lib/rain/stems.ts` describes a TypeScript DSP approximation and explicitly says no PyTorch model is shipped in the browser; the README calls the feature BS-RoFormer. | **Known gap: claim/implementation mismatch** | Implement and validate a legally distributable real separation model, or ensure the advertised BS-RoFormer claim is backed by the actual shipped model. A heuristic DSP decomposition must not be labelled as inference from BS-RoFormer. |
| Ed25519 RAIN-CERT signing | `src/lib/rain/provenance.ts` uses WebCrypto Ed25519, but persists the private key as exported JWK fields in IndexedDB. | **Security gap** | Persist a non-extractable private CryptoKey where supported, retain a verifiable public key, handle legacy records safely, and add tamper/verification tests. |
| Multi-instance production rate limiting | `src/middleware.ts` and `src/lib/rain/rate-limit.ts` both use in-memory Maps. | **Known gap** | Replace production enforcement with a shared atomic store; define safe behaviour when the store is unavailable; avoid trusting client-controlled forwarded-IP headers unless the deployment proxy is trusted. |
| Distribution provider delivery | `src/lib/rain/distribution.ts` describes real provider submission; `src/app/api/rain/distribute/route.ts` checks LabelGrid credentials. | **Not yet verified end-to-end** | Validate package generation and schema, exercise missing-credential and provider-failure paths, and verify that “delivered” is based on an authoritative provider response. |
| 16-stage mastering and export | `src/lib/rain/audio-engine.ts` contains a pipeline orchestrator and real WAV/MP3 encoder code paths; the UI includes post-export verification functions. | **Not yet verified end-to-end** | Run real-file browser tests for every stage, WAV/MP3 decoding, output metrics, unsupported inputs, and explicit failure states. Source presence alone is insufficient. |
| Dolby Atmos / spatial export | `src/lib/rain/spatial.ts` contains spatial DSP, multichannel BWF/ADM XML and ZIP-export code paths. | **Not yet verified against interoperability requirements** | Validate channel layout, ADM/BWF structure and package contents using independent parsers and target-compatible tools. Do not equate a multichannel WAV or ADM XML file with Dolby certification. |

## Remaining high-priority claims requiring investigation

- Audio format support: WAV, MP3, FLAC, AIFF, OGG.
- All 16 mastering stages, their ordering, and failure propagation.
- All seven macro controls and whether each affects rendered audio.
- All eight repair modules and their measurable effect.
- 18-point QC coverage and correctness of the underlying metrics.
- 12-stem shape, reconstruction/residual behaviour, and separation quality.
- Exported provenance placement, signature scope, and independent verification.
- DDEX ERN 4.3.2 schema/profile compliance.
- LabelGrid provider request/response contract and retries.
- DistroKid browser automation, authentication handling, and completion confirmation.
- Registration/login/logout/session expiry, account isolation, and admin authorization.
- Startup environment validation, database migrations, health checks, and production storage.
- Payment providers and the claim that payments are isolated and disabled during beta.
- Automated test discovery, CI gates, and actual clean-build results.

## Evidence rule

A capability may be marked **Implemented and verified** only when source tracing and a repeatable test demonstrate its expected behaviour. Unit tests, mocks, generated metadata, UI labels, comments, and documentation alone are not enough. External delivery, production security, and audio quality require the corresponding integration, deployment, or listening evidence.
