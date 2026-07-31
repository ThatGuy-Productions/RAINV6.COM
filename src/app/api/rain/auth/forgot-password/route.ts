/**
 * RAIN V6 — Forgot Password Endpoint
 *
 * POST /api/rain/auth/forgot-password
 *
 * Accepts an email address. If an account exists, generates a password-reset
 * token (SHA-256 hashed in DB, 1-hour expiry) and returns it in the response.
 *
 * In production, this token would be sent via email. During beta, the token
 * is returned directly so the flow can be tested without an email provider.
 *
 * Always returns 200 even if the email doesn't exist — prevents user
 * enumeration. The response body is identical either way.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateResetToken } from '@/lib/rain/auth-hardening'
import { stripHtml } from '@/lib/rain/sanitize'

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

      // In production: send email with reset link containing the token.
      // During beta: return the token directly for testing.
      return NextResponse.json({
        message: 'If an account with that email exists, a reset token has been generated.',
        // Beta only — remove before production email integration
        resetToken: token,
      })
    }

    // Always return the same message to prevent user enumeration
    return NextResponse.json({
      message: 'If an account with that email exists, a reset token has been generated.',
    })
  } catch (err) {
    console.error('[auth/forgot-password] Error:', err)
    return NextResponse.json(
      { error: 'Password reset service unavailable' },
      { status: 500 },
    )
  }
}
