# RULE-02 — Dual-Path Architecture Acceptance Record

Status: **Target requirement; not yet verified end to end.**

This document records the non-negotiable architecture for the rebuilt RAIN V6 beta. It is an acceptance contract, not a claim that all requirements below are already implemented.

## Required invariant

- **Preview path:** browser-native Web Audio API, 32-bit floating-point audio buffers, responsive monitoring.
- **Authoritative render path:** offline rendering through the designated RainDSP C++20/WASM engine using double-precision calculations for the mastering signal path.
- **Export boundary:** convert to the requested delivery representation only after authoritative DSP processing and required QC.
- **Backend identity:** every accepted export records which renderer and exact engine build produced it. A Python or TypeScript fallback must never be silently labelled as the authoritative RainDSP render.
- **Integrity gate:** verify the exact WASM bytes against a trusted expected SHA-256 digest before execution. Missing, invalid, or mismatched expected digests must block an authoritative render (RAIN-E304).
- **Provenance:** bind the certificate to the actual rendered output and exact engine/configuration identity. If the certificate claims an output-file hash, hash the final exported bytes; if it claims a pre-encoding PCM hash, label that hash explicitly and separately.

## Required tests

1. Preview path uses the expected browser audio API and sample representation.
2. Final export demonstrably calls the designated RainDSP WASM renderer.
3. A missing WASM asset, missing expected digest, malformed digest, or digest mismatch fails closed.
4. The digest is computed over the actual binary bytes that are instantiated, not a separately supplied label.
5. Repeated renders of identical input, parameters, engine build, and runtime configuration are compared at decoded-sample level; byte identity is claimed only if the test proves it.
6. Final format conversion occurs after the authoritative render and QC.
7. Provenance verification independently checks input hash, output hash semantics, parameters, renderer/build identity, signature and public-key trust model.
8. The browser beta's local-first claim is tested by confirming raw audio is not uploaded in the free workflow; telemetry must not include audio samples.

## Current evidence and limits

- `src/lib/rain/audio-engine.ts` documents the preview path as Web Audio API and the render path as `OfflineAudioContext + custom DSP`. This is not proof of a separate C++/WASM authoritative render.
- `src/lib/rain/dsp.ts` processes `Float32Array` samples. Some analysis routines use `Float64Array` accumulators, but double-precision analysis alone does not establish double-precision processing of the final audio signal.
- `src/lib/rain/provenance.ts` currently describes hashing the processed Float32 buffer rather than the encoded WAV bytes. A certificate must state clearly which object is hashed; do not describe a pre-encoding sample hash as the hash of the final exported file.
- A setting labelled “WASM Binary Integrity” is not enforcement. RULE-02 must be mandatory in the render execution path, not user-toggleable.
- Commercial repository C++ DSP source exists separately. Its existence does not prove that this browser beta invokes it.

## Release gate

Do not mark RULE-02 compliant until the runtime call path and all required tests above have evidence attached to the release record. Preserve the existing mastering sound: use approved reference masters and regression comparisons; do not rewrite DSP solely to satisfy this audit.
