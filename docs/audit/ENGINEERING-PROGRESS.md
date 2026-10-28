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
