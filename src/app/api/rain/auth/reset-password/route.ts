import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/reset-password
 *
 * Completes password reset. Validates the token:
 *  1. SHA-256 hashes the provided token and compares with stored hash.
 *  2. Checks the token hasn't expired (1-hour window).
 *  3. Checks the token hasn't already been used.
 *
 * On success:
 *  - Updates the Account's passwordHash.
 *  - Marks the token as used (single-use).
 *  - Invalidates ALL existing AuthTokens for that user (force re-login
 *    on all devices — security best practice after a password reset).
 *  - Fires a `password_reset_completed` Event.
 *
 * Response:
 *   { ok: true }
 *
 * Failures return { ok: false, error: "..." } with appropriate status.
 * Token errors are deliberately generic to prevent information leakage.
 */
export async function POST(req: NextRequest) {
  let body: { token?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body' },
      { status: 400 },
    )
  }

  const rawToken = typeof body.token === 'string' ? body.token.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!rawToken) {
    return NextResponse.json(
      { ok: false, error: 'Reset token is required' },
      { status: 400 },
    )
  }

  if (!password || password.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'Password must be at least 8 characters' },
      { status: 400 },
    )
  }

  try {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    const resetToken = await db.passwordResetToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    })

    if (!resetToken) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or expired reset token' },
        { status: 400 },
      )
    }

    // Check expiry
    if (resetToken.expiresAt.getTime() < Date.now()) {
      // Mark expired token as used to clean up
      await db.passwordResetToken
        .update({ where: { id: resetToken.id }, data: { used: true } })
        .catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'Reset token has expired. Please request a new one.' },
        { status: 400 },
      )
    }

    // Check already used
    if (resetToken.used) {
      return NextResponse.json(
        { ok: false, error: 'This reset token has already been used.' },
        { status: 400 },
      )
    }

    // Mark token as used (single-use)
    await db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    })

    // Update the password hash
    await db.account.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashPassword(password) },
    })

    // Invalidate ALL AuthTokens for this user (force re-login everywhere)
    await db.authToken.deleteMany({
      where: { userId: resetToken.userId },
    })

    // Log the event
    void trackEvent({
      userId: resetToken.userId,
      type: 'password_reset_completed' as any,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[auth] reset-password error:', err)
    return NextResponse.json(
      { ok: false, error: 'An error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
