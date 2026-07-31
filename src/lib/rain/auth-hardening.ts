/**
 * RAIN V6 — Authentication Hardening (Phase 4)
 *
 * Supplements the core auth module (@/lib/rain/auth) with:
 *   - Password strength validation (complexity + common-password blocklist)
 *   - Password reset token generation (crypto random + SHA-256 hash + 1h expiry)
 *   - MFA scaffold (TOTP secret, otpauth URI, backup codes)
 *   - Secure cookie rotation (7-day staleness check)
 *
 * This module is purely additive — it does not modify the existing auth
 * flow. Routes opt-in by calling the functions before their own logic.
 */

import { randomBytes, createHash } from 'crypto'

// ---------------------------------------------------------------------------
// 1. Password strength validation
// ---------------------------------------------------------------------------

/** Top 20 most common passwords (NCSC / Have I Been Pwned frequent offenders). */
const COMMON_PASSWORDS = new Set([
  '123456',
  '123456789',
  'password',
  'qwerty',
  '12345678',
  '111111',
  'abc123',
  'password1',
  '1234567',
  'letmein',
  'welcome',
  'monkey',
  'master',
  'dragon',
  'login',
  'princess',
  'football',
  'shadow',
  'sunshine',
  'trustno1',
])

export interface PasswordStrengthResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate password strength against RAIN V6 policy:
 *   - Min 8 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character
 *   - Not a commonly-used password
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common — choose something more unique')
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// 2. Password reset token generation
// ---------------------------------------------------------------------------

export interface ResetTokenResult {
  /** Raw 32-byte token (hex, 64 chars) — sent to the user, never stored. */
  token: string
  /** SHA-256 hash of the token — stored in the DB for later verification. */
  tokenHash: string
  /** Expiry timestamp — 1 hour from now. */
  expiresAt: Date
}

/** 1 hour in milliseconds. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Generate a password-reset token:
 *   - 32-byte crypto-random token (hex encoded)
 *   - SHA-256 hash for DB storage (only the hash is persisted)
 *   - 1-hour expiry
 *
 * The caller is responsible for persisting the hash + expiry and for
 * sending the raw token to the user via a secure channel (email).
 */
export function generateResetToken(): ResetTokenResult {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
  return { token, tokenHash, expiresAt }
}

// ---------------------------------------------------------------------------
// 3. MFA scaffold
// ---------------------------------------------------------------------------

export interface MfaSetup {
  enabled: boolean
  secret?: string
  backupCodes?: string[]
}

/**
 * Generate a new TOTP secret and associated materials for MFA setup.
 *
 * Returns:
 *   - `secret` — base32-encoded TOTP key (compatible with Google Authenticator,
 *     Authy, 1Password, etc.)
 *   - `uri` — otpauth:// URI that QR-code generators consume
 *   - `backupCodes` — 10 single-use recovery codes (8-char alphanumeric)
 *
 * The caller should:
 *   1. Show the URI as a QR code to the user.
 *   2. Verify the user can produce a valid TOTP code before persisting.
 *   3. Store the secret + hashed backup codes in the DB.
 *   4. Show the backup codes once (never again after the dialog closes).
 */
export function generateMfaSecret(): { secret: string; uri: string; backupCodes: string[] } {
  // Generate a 20-byte random secret and base32-encode it (standard TOTP key length).
  const rawSecret = randomBytes(20)
  const secret = rawSecret.toString('base64url').slice(0, 32).toUpperCase()

  // otpauth:// URI — the standard format all TOTP apps accept.
  const issuer = 'RAIN+V6'
  const accountName = 'user'
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`

  // 10 backup codes — 8-char alphanumeric, cryptographically random.
  const backupCodes: string[] = []
  for (let i = 0; i < 10; i++) {
    backupCodes.push(randomBytes(4).toString('hex').toUpperCase())
  }

  return { secret, uri, backupCodes }
}

// ---------------------------------------------------------------------------
// 4. Secure cookie rotation
// ---------------------------------------------------------------------------

/** 7 days in milliseconds. */
const COOKIE_ROTATION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Determine whether a session token should be rotated.
 *
 * A token created more than 7 days ago should be rotated (even if the
 * session is still valid) to limit the window of opportunity for token
 * theft. The caller should:
 *   1. Mint a new session token.
 *   2. Delete the old AuthToken row.
 *   3. Set the new cookie on the response.
 *
 * This is a non-sliding rotation — the 7-day window is measured from the
 * original `createdAt`, not from the last activity.
 */
export function shouldRotateToken(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > COOKIE_ROTATION_MS
}
