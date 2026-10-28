import { createHash, timingSafeEqual } from 'node:crypto'

export type BootstrapSecretStatus = 'valid' | 'invalid' | 'disabled'

/**
 * Validate the out-of-band first-admin bootstrap secret.
 * The configured secret must be at least 32 characters. Hashing both inputs
 * to fixed-size buffers lets timingSafeEqual compare without length leakage.
 */
export function verifyBootstrapSecret(
  supplied: unknown,
  configured = process.env.RAIN_ADMIN_BOOTSTRAP_SECRET,
): BootstrapSecretStatus {
  if (!configured || configured.length < 32) return 'disabled'
  const candidate = typeof supplied === 'string' ? supplied : ''
  const expectedDigest = createHash('sha256').update(configured, 'utf8').digest()
  const suppliedDigest = createHash('sha256').update(candidate, 'utf8').digest()
  return timingSafeEqual(suppliedDigest, expectedDigest) ? 'valid' : 'invalid'
}
