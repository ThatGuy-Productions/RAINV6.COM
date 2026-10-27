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
| RainNet v2 ONNX inference with graceful fallback | `src/lib/rain/rainnet-inference.ts` contains ONNX session loading and parameter decoding. The model-manifest verifier only checks that a checksum field exists, returns true without hashing the model, and has no call sites in the searched source. | **Known gap** | Verify actual model bytes against a valid trusted SHA-256 manifest before inference; make missing, placeholder, or mismatched hashes fail closed; validate the shipped model and keep the documented heuristic fallback operational. |
| Model integrity manifest | `public/models/rain_base.manifest.json` contains a literal `PLACEHOLDER-...` checksum and describes the model as “RAIN V6 — BS-RoFormer 12-stem”, while the inference loader uses it as the RainNet base model. | **Known gap** | Establish which ONNX artifact this manifest belongs to; compute real checksums from the committed model artifacts; make model name, inputs, outputs, and checksum match the actual model. Do not invent hashes. |
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
