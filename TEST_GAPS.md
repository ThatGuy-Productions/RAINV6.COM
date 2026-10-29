# Beta test gaps — 2026-10-29

The repository CI workflow's test job is a placeholder. Required automated acceptance tests:

1. **Audio/export:** synthetic sine, impulse, silence, clipped and stereo-phase fixtures; assert no NaN/Inf, duration/channel/sample rate/bit depth/encoding correct, output checksum reproducible where claimed, loudness/true peak independently measured.
2. **Export failure:** unsupported, empty, oversized and malformed input; worker/browser interruption; insufficient memory; no false success toast.
3. **Authentication:** wrong password, expired/revoked session, logout, cookie flags in production, timing-safe verification.
4. **Authorization:** anonymous access to every enterprise endpoint; cross-account render/session IDs; forged headers; tier downgrade and unknown tier.
5. **DDEX:** valid ERN fixture passes; malformed XML, wrong namespace, invalid ISRC/UPC, missing required fields, mismatched package hashes fail.
6. **LabelGrid:** no key returns explicit not-submitted state; provider 400/401/429/500, timeout, malformed 2xx, duplicate request and later rejection never show delivered.
7. **Persistence:** run migrations on disposable PostgreSQL; verify cross-user isolation; restart app and DB; backup then restore and compare records/assets.
8. **Provenance:** verify Ed25519 signature; tamper with output bytes and manifest and assert verification fails; do not claim formal C2PA conformance unless external validation passes.
9. **CI:** fail the pipeline on a failing test; no placeholder success step.

Every test should include reproducible fixture/setup and expected assertion.