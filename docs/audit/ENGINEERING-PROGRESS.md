# Engineering progress log — recovery branch

Branch: `codex/bring-code-to-readme-2026-10-27`

## Completed (2026-10-28 continuous execution)

### W2 Entitlements
- [x] Policy, server loader, beta-access API
- [x] Usage reserve/complete/release + render gate
- [x] Anon usage attach on register
- [x] R49 once-off / beta-only / commercial discount note

### W3 Payment (non-live)
- [x] PayFast chosen; readiness gate
- [x] ITN callback (no grants when not live)
- [x] Unlock create API (pending rows only when not live)
- [x] Payment route refuses live redirect without readiness
- [x] `.env.example` documented
- [ ] Live sandbox E2E — blocked on public URL

### W0/W1 partial
- [x] CI on `codex/**`
- [x] Feature flags for stems/distribution claims
- [ ] Production DB evidence on host

### W6 partial
- [x] Model LFS objects verified earlier in session

## Safety
No live charges. Checkout requires `NEXT_PUBLIC_APP_URL` (non-localhost) + credentials + `PAYFAST_LIVE_ENABLED=true` + `RAIN_BETA_MODE=false`.

## Operator later
1. Public HTTPS URL
2. PayFast notify/return registration
3. Flip live switches only after sandbox proof

---

## Task ID: 29 — 2026-10-28 follow-up: latest-head CI and entitlement gate review

Scope: continue from the engineering fix plan without touching the live beta or merging the recovery branch.

Verified current branch head after this task's code changes:
- `34caf76c6833402480bd3a12d5e0cea39ef7d4dc`
- CI run `40641289628` was queued at the time of this note; results must be checked before acceptance.

Changes:
- Removed the readonly tuple inference from `identityWhere()` in `src/lib/rain/beta-entitlement.ts`, addressing the two Prisma where-input TypeScript diagnostics reported by the previous typecheck run.
- Hardened `POST /api/rain/render`: a supplied reservation ID no longer bypasses entitlement checks by mere presence. The route now requires a durable reservation matching the caller identity, expected usage kind, and `reserved` state; invalid, stale, completed, or foreign reservations receive HTTP 409.

Review findings that remain open:
- The ledger's check-then-create reservation sequence is not yet proven concurrency-safe. Implement database-atomic quota allocation/locking and concurrent-request tests before marking W2 complete.
- `completeUsage()` has a fallback that can create a completed row if a reservation update fails. Review all callers and make reservation-based completion fail closed instead of silently creating a new completed record.
- The render endpoint records client-reported completion and cannot independently prove a browser download; admin/funder reporting must retain that evidence label.
- The current TypeScript fix and reservation validation are not accepted until CI passes on this exact head and regression tests exercise invalid/foreign/replayed reservation IDs.

No merge, live deployment change, production database migration, or live payment enablement was performed.
