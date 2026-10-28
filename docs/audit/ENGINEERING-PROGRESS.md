# Engineering progress log — recovery branch

Branch: `codex/bring-code-to-readme-2026-10-27`  
Updated continuously while executing the engineering plan.

## Completed on this branch (2026-10-28)

### Entitlements (W2)
- [x] Pure policy `evaluateBetaEntitlement` (2 free, R49, 1500 credits, 30 exports)
- [x] Server loader `loadBetaEntitlement` with Event fallback + UsageRecord preference
- [x] `GET /api/rain/beta-access` returns full policy + payment readiness
- [x] `POST /api/rain/usage` reserve / complete / release / status
- [x] `POST /api/rain/render` preflight gate + ledger complete on success
- [x] Reserved rows count against allowance (anti double-spend)
- [x] R49 recorded as **once-off, beta-stage only**; commercial discount for holders at launch

### Payment (W3 — non-live)
- [x] Provider choice: **PayFast**
- [x] `getPaymentReadiness()` live gate (credentials + public URL + `PAYFAST_LIVE_ENABLED`)
- [x] `POST /api/rain/payment/callback/payfast` ITN (no grants while not live)
- [x] `POST /api/rain/payment/unlock` pending Payment + blocked checkout until live
- [x] Secrets policy: env only, never in repo
- [ ] Live sandbox end-to-end (blocked on confirmed public URL)
- [ ] Grant entitlement only after verified ITN in live mode (code path ready, switch off)

### Models (W6 partial)
- [x] LFS objects for rain_base / rain_trained present and size-matched

### Still open (need environment or larger feature work)
- [ ] Production PostgreSQL + migration apply evidence on real host (W1)
- [ ] Full CI green on PR head (W0)
- [ ] Browser E2E export / 16-stage gate evidence (W5)
- [ ] Real neural stems (W7) — must not claim until model path exists
- [ ] C2PA / DDEX delivery proof (W8–W9)

## Operator inputs still needed later
1. Final public HTTPS origin (`NEXT_PUBLIC_APP_URL`)
2. PayFast dashboard notify/return URL registration
3. `PAYFAST_LIVE_ENABLED=true` only after the above
4. Commercial discount amount at product launch (not beta)

## Safety defaults
- Checkout unavailable
- Live ITN returns 503 and grants nothing until readiness
- Amount fixed at 4900 cents server-side
