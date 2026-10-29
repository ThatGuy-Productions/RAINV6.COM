# RAIN V6 — cross-repository decision (initial source review)

**Date:** 2026-10-29. This is a preliminary source review, not a completed runtime audit. A local clone failed because this environment could not resolve github.com, so no fresh builds/tests/audio/provider tests were executed.

## Provisional assessment
- **Beta** is the first candidate to test for a narrow manual-export MVP: it has a browser-facing mastering/export/package path, and its worklog records previous browser/export checks. But the CI test job explicitly passes without running tests; LabelGrid endpoint/payload are assumed, and current audio output was not inspected.
- **Audio Transformation** has a more explicit service architecture and CI configured for backend tests, but its master route explicitly documents process-local, non-persistent sessions; Stripe has a mock checkout fallback; LabelGrid contract/lifecycle remains unverified.

## Decision
**No winner yet; do not merge yet.** Test Beta's browser export path first for the fastest possible narrow MVP. For durable server-side multi-user processing, Audio Transformation must first replace its in-memory session store. Both need real audio-fixture tests, auth/tenant tests, current CI results and provider sandbox verification.

## Shared decision gate
1. Pin commit SHA and run fresh CI/build in both.
2. Process identical fixtures and inspect outputs independently.
3. Test auth, tier gates and cross-user IDs.
4. Prove persistence, restart and restore.
5. Verify LabelGrid release→assets→validation→distribution→delivery status.
6. Verify real Stripe test-mode lifecycle; no mock path in production.
7. Estimate remaining engineering days from observed failures, not README feature lists.

## Evidence
- Beta [CI](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/.github/workflows/ci.yml), [package.json](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/package.json), [distribution route](https://github.com/ThatGuy-Productions/RAINV6.COM/blob/release-candidate/src/app/api/rain/distribute/route.ts).
- Audio [CI](https://github.com/ThatGuy-Productions/RAIN-V6-AI-AUDIO-TRANSFORMATION-MASTERING-AND-DISTRIBUTION-INFRUSTRUCTURE/blob/main/.github/workflows/ci.yml), [master route](https://github.com/ThatGuy-Productions/RAIN-V6-AI-AUDIO-TRANSFORMATION-MASTERING-AND-DISTRIBUTION-INFRUSTRUCTURE/blob/main/backend/app/api/routes/master.py), [billing](https://github.com/ThatGuy-Productions/RAIN-V6-AI-AUDIO-TRANSFORMATION-MASTERING-AND-DISTRIBUTION-INFRUSTRUCTURE/blob/main/backend/app/api/routes/billing.py), [LabelGrid client](https://github.com/ThatGuy-Productions/RAIN-V6-AI-AUDIO-TRANSFORMATION-MASTERING-AND-DISTRIBUTION-INFRUSTRUCTURE/blob/main/backend/app/services/labelgrid.py).

No runtime pass is claimed.