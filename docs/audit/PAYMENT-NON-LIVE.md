# Payment status — non-live until URL confirmed

**Date:** 2026-10-28  
**Operator rule:** Leave payment details non-live until the public URL is confirmed.

## Provider

- **PayFast** (chosen; merchant account already exists)
- Product: once-off **R49.00 ZAR** beta unlock
- Duration: beta stage only; ends at commercial launch
- Beta holders: discounted commercial fee at launch (amount TBD)

## Secrets

Merchant ID and Merchant Key must live only in **server environment variables**:

```
PAYFAST_MERCHANT_ID=...
PAYFAST_MERCHANT_KEY=...
PAYFAST_PASSPHRASE=...          # optional, if set in PayFast dashboard
NEXT_PUBLIC_APP_URL=https://... # live HTTPS origin when known
PAYFAST_LIVE_ENABLED=false      # must stay false until URLs confirmed
PAYFAST_TEST_MODE=true          # use sandbox host while testing
```

Never commit these values to Git.

## Live gate

Live charging is allowed only when **all** of the following are true:

1. `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY` are set
2. `NEXT_PUBLIC_APP_URL` is a non-localhost public HTTPS origin
3. `PAYFAST_LIVE_ENABLED=true`

Until then, `getPaymentReadiness().checkoutAvailable` is **false** and
`paymentStatus` is **`not_live`**. No real money is taken.

## Callback URLs (to confirm later)

Once the public domain is known, register with PayFast:

| Purpose | Path |
|---------|------|
| ITN / notify | `{APP_URL}/api/rain/payment/callback/payfast` |
| Return (success) | `{APP_URL}/beta/unlock/return` |
| Cancel | `{APP_URL}/beta/unlock/cancel` |

## Related code

- `src/lib/rain/payment-readiness.ts` — readiness gate
- `src/lib/rain/payment-isolation.ts` — provider adapters (existing)
- `src/app/api/rain/payment/route.ts` — session API (existing)
- Entitlement unlock still requires a **verified** server-side payment record before granting `beta_r49_unlock`
