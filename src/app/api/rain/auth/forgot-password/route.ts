import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/forgot-password
 *
 * Initiates password reset. DOES NOT reveal whether the email exists —
 * the response is identical either way to prevent user enumeration.
 *
 * If the account exists:
 *  1. Generates a random 32-byte reset token.
 *  2. SHA-256 hashes it for DB storage (only the hash is persisted).
 *  3. Stores a PasswordResetToken row with a 1-hour expiry.
 *  4. Logs a `password_reset_requested` Event.
 *  5. In BETA mode (no email service), returns the RAW token in the
 *     response so the developer can use it for testing. In production
 *     this would be sent via email.
 *
 * Response (both when account exists and when it doesn't):
 *   { ok: true, message: "If an account exists, a reset link has been sent." }
 *
 * In BETA mode, also includes `token` for development/testing.
 */
export async function POST(req: NextRequest) {
  const UNAMBIGUOUS_RESPONSE = {
    ok: true,
    message: 'If an account exists, a reset link has been sent.',
  } as const

  let body: { email?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(UNAMBIGUOUS_RESPONSE)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Same response — don't reveal whether the email format matters
    return NextResponse.json(UNAMBIGUOUS_RESPONSE)
  }

  try {
    const account = await db.account.findUnique({ where: { email } })
    if (!account) {
      // Account doesn't exist — return the same response to prevent enumeration
      return NextResponse.json(UNAMBIGUOUS_RESPONSE)
    }

    // Generate a random 32-byte (256-bit) reset token
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    // 1-hour expiry
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    // Invalidate any previously unused reset tokens for this user
    // (only one active reset at a time per security best practice)
    await db.passwordResetToken.updateMany({
      where: { userId: account.id, used: false },
      data: { used: true },
    })

    await db.passwordResetToken.create({
      data: {
        userId: account.id,
        token: tokenHash,
        expiresAt,
      },
    })

    // Log the event
    void trackEvent({
      userId: account.id,
      type: 'password_reset_requested' as any,
    })

    // In BETA mode, return the raw token so the developer can test
    return NextResponse.json({
      ...UNAMBIGUOUS_RESPONSE,
      token: rawToken, // BETA: remove before production
    })
  } catch (err) {
    console.error('[auth] forgot-password error:', err)
    return NextResponse.json(UNAMBIGUOUS_RESPONSE)
  }
}
