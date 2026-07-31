/**
 * RAIN V6 — Forgot Password Endpoint
 *
 * POST /api/rain/auth/forgot-password
 *
 * Accepts an email address. If an account exists, generates a password-reset
 * token (SHA-256 hashed in DB, 1-hour expiry) and sends it to the user's
 * email via the configured email provider.
 *
 * Always returns 200 even if the email doesn't exist — prevents user
 * enumeration. The response body is identical either way.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateResetToken } from '@/lib/rain/auth-hardening'
import { stripHtml } from '@/lib/rain/sanitize'
import { sendPasswordResetEmail } from '@/lib/rain/email'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const email = stripHtml(typeof body.email === 'string' ? body.email.trim().toLowerCase() : '')

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 },
      )
    }

    const account = await db.account.findUnique({ where: { email } })

    if (account) {
      const { token, tokenHash, expiresAt } = generateResetToken()

      // Invalidate any previous unused reset tokens for this user
      await db.passwordResetToken.updateMany({
        where: { userId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      // Store the new token hash
      await db.passwordResetToken.create({
        data: {
          tokenHash,
          userId: account.id,
          expiresAt,
        },
      })

      // Send the reset token to the user's email via the configured provider.
      // The raw token is never included in the HTTP response — only the hash
      // is persisted in the DB. This prevents token leakage in logs, network
      // traces, and browser devtools.
      await sendPasswordResetEmail(account.email, token).catch((err) => {
        console.error('[auth/forgot-password] Email send failed:', err)
        // Intentionally swallow — we don't want to reveal whether the email
        // was sent successfully, as that would leak account existence.
      })

      return NextResponse.json({
        message: 'If an account with that email exists, a reset link has been sent.',
      })
    }

    // Always return the same message to prevent user enumeration
    return NextResponse.json({
      message: 'If an account with that email exists, a reset link has been sent.',
    })
  } catch (err) {
    console.error('[auth/forgot-password] Error:', err)
    return NextResponse.json(
      { error: 'Password reset service unavailable' },
      { status: 500 },
    )
  }
}
