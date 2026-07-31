# Phase 4 & 5 — Authentication Hardening + API Reliability

## Summary

Implemented Phase 4 (Authentication Hardening) and Phase 5 (API Reliability) for the RAIN V6 project.

## Phase 4 — Authentication Hardening

### New file: `/home/z/my-project/src/lib/rain/auth-hardening.ts`

1. **`validatePasswordStrength(password)`** — Validates password against RAIN V6 policy:
   - Min 8 chars, uppercase, lowercase, digit, special char
   - Hardcoded top-20 common password blocklist (NCSC / Have I Been Pwned)
   - Returns `{ valid: boolean; errors: string[] }`

2. **`generateResetToken()`** — Generates password reset tokens:
   - 32-byte crypto-random token (hex)
   - SHA-256 hash for DB storage
   - 1-hour expiry
   - Returns `{ token: string; tokenHash: string; expiresAt: Date }`

3. **`MfaSetup` interface + `generateMfaSecret()`** — MFA scaffold:
   - TOTP secret (base32-encoded, 32 chars)
   - otpauth:// URI for QR code generation
   - 10 backup codes (8-char hex, cryptographically random)

4. **`shouldRotateToken(createdAt)`** — Cookie rotation check:
   - Returns `true` if token is older than 7 days
   - Non-sliding rotation policy

### Updated routes:

- **`/api/rain/auth/register/route.ts`** — Added `validatePasswordStrength()` check before registration. Rejects weak passwords with specific error messages.
- **`/api/rain/auth/login/route.ts`** — Added session validation improvements:
  - Checks for existing active session before login
  - Uses `shouldRotateToken()` to flag stale sessions
  - Logs re-authentication events with rotation metadata
  - Added `logApiRequest` for request timing

## Phase 5 — API Reliability

### New file: `/home/z/my-project/src/lib/rain/api-utils.ts`

1. **`apiSuccess<T>(data, status)`** — Structured success response with `{ ok: true, data }` envelope
2. **`apiError(error, status, stage?)`** — Structured error response with `{ ok: false, error, stage? }` envelope
3. **`apiValidationError(errors)`** — Validation error response (422) with `{ ok: false, error, errors }` envelope
4. **`validateRequest<T>(body, schema)`** — Zod-based request validation returning `{ data }` or `{ error }`
5. **`withErrorHandler(handler)`** — Wraps API route handlers with try/catch, structured 500 responses, and request logging
6. **`logApiRequest(method, path, status, durationMs)`** — In-memory request log (capped at 500 entries)
7. **`getRecentApiLogs(limit)`** — Retrieve recent API logs for admin dashboards

### Updated routes:

- **`/api/rain/feedback/route.ts`** — Added `withErrorHandler`, `logApiRequest`, `sanitizeFeedback` from `@/lib/rain/sanitize`, `apiSuccess`/`apiError` for structured responses
- **`/api/rain/reviews/route.ts`** — Added `withErrorHandler` (POST), `logApiRequest` (GET+POST), `sanitizeReview`/`sanitizeDisplayName` from `@/lib/rain/sanitize`, `apiError` for structured error responses
- **`/api/rain/session/route.ts`** — Added `withErrorHandler`, `logApiRequest`, `sanitizeMetadataField` from `@/lib/rain/sanitize`

## Lint results

All 0 errors. Only pre-existing warnings remain (unrelated to Phase 4/5 changes).
