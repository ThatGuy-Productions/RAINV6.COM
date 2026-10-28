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


## RAIN-CERT sample extraction — 2026-10-28

A real WAV extraction for `TRAPPE_VAN_VERGELYKING__RAIN.wav` reports a 48 kHz, stereo, 24-bit PCM file with a `LIST/INFO` record containing a `RAIN` JSON certificate, `ISIG` signature field, `IFPR` fingerprint field and ordinary release metadata. The manifest explicitly reports that AudioSeal is unavailable and no watermark is embedded.

The extraction reports different SHA-256 values for the whole WAV, its audio `data` chunk and the certificate `outputHash`. This is compatible with a pre-encoding Float32 output hash, but the hash scheme must be labelled precisely and independently reproduced before claiming the certificate binds the final file.

### Code-confirmed limitation

- `src/lib/rain/provenance.ts` signs a canonical JSON payload containing certificate identity, input/output hashes, engine label, timestamp and manifest.
- `verifyProvenance()` can verify the Ed25519 signature against the public key carried in the certificate. That establishes mathematical signature validity for that key; it does not independently establish that the key belongs to RAIN.
- The export verification functions in `src/lib/rain/audio-engine.ts` calculate a SHA-256 of the exported Blob for the UI report, then check whether expected RIFF/ID3 fields are present. They do **not** currently parse the embedded certificate and call `verifyProvenance()`, nor do they recompute the certificate's Float32 output hash from the exported PCM/MP3.
- Consequently, the current “Signature (Ed25519)” row is a field-presence check, not cryptographic signature verification. The displayed whole-file SHA-256 identifies the exact bytes inspected, but is not itself signed or stored in a trusted reference by this verifier.
- The Export tab previously proceeded to download even when these field-presence checks failed. It now blocks WAV/MP3 delivery on a mismatch. This is a fail-closed improvement, but it is not yet a complete tamper-verification chain.
- The Export Summary previously claimed “LSB steganographic ✓” despite the certificate stating that no watermark is embedded. The label now honestly reports “Not embedded (AudioSeal unavailable).”

### Required next acceptance gate

1. Parse the actual certificate bytes from WAV LIST/INFO and MP3 ID3v2.
2. Validate certificate schema and signature with `verifyProvenance()`; report signature validity separately from trusted-issuer status.
3. Define and test the exact canonical audio-hash procedure, including sample rate, channel ordering, quantization/codec boundary and version. Do not label a Float32 pre-encoding hash as a whole-file hash.
4. Independently hash the final file bytes and bind that digest in a signed delivery manifest or a documented non-circular signing format.
5. Add tamper tests for audio samples, certificate payload, signature, ordinary metadata, and final-file bytes. The expected outcome depends on whether each field is covered by the signed manifest, but any protected-field alteration must fail validation.
6. Test WAV, MP3 and Distribution Package ZIP separately; a passing WAV field-presence check is not evidence for the other paths.

Until those tests pass, describe the current export as **embedded provenance metadata with field-presence checks**, not fully independently verified, immutable certification.
