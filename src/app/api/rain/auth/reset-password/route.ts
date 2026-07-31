/**
 * RAIN V6 — Reset Password Endpoint
 *
 * POST /api/rain/auth/reset-password
 *
 * Accepts a reset token and a new password. Validates:
 *   - Token exists and has not been used
 *   - Token has not expired (1-hour window)
 *   - New password meets strength requirements
 *
 * On success: updates the password hash, marks the token as used, and
 * invalidates all active sessions for security.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/rain/auth'
import { validatePasswordStrength } from '@/lib/rain/auth-hardening'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: 'Token and new password are required' },
        { status: 400 },
      )
    }

    // Validate password strength
    const strength = validatePasswordStrength(newPassword)
    if (!strength.valid) {
      return NextResponse.json(
        { error: 'Password does not meet strength requirements', details: strength.errors },
        { status: 400 },
      )
    }

    // Hash the provided token to look it up
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const resetRecord = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!resetRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 },
      )
    }

    // Check if already used
    if (resetRecord.usedAt) {
      return NextResponse.json(
        { error: 'This reset token has already been used' },
        { status: 400 },
      )
    }

    // Check expiry
    if (resetRecord.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'This reset token has expired. Please request a new one.' },
        { status: 400 },
      )
    }

    // Update the password
    const newPasswordHash = hashPassword(newPassword)
    await db.account.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: newPasswordHash },
    })

    // Mark the reset token as used
    await db.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    })

    // Invalidate all active sessions for this user (force re-login)
    await db.authToken.deleteMany({
      where: { userId: resetRecord.userId },
    })

    return NextResponse.json({
      message: 'Password has been reset successfully. Please sign in with your new password.',
    })
  } catch (err) {
    console.error('[auth/reset-password] Error:', err)
    return NextResponse.json(
      { error: 'Password reset service unavailable' },
      { status: 500 },
    )
  }
}
