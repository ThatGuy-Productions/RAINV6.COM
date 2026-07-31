/**
 * RAIN V6 — Email Provider
 *
 * Sends transactional emails (password reset, etc.) via the configured
 * provider. Supports two modes:
 *
 *   1. Production: SMTP via nodemailer (configure SMTP_HOST, SMTP_PORT,
 *      SMTP_USER, SMTP_PASS in .env.production).
 *   2. Development: Logs the email content to console (no real send).
 *      Set EMAIL_PROVIDER=console to explicitly enable (default in dev).
 *
 * The password reset email includes a link with the raw token as a query
 * parameter. The token is single-use, SHA-256 hashed in the DB, and expires
 * after 1 hour.
 */


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'smtp' : 'console')
const SMTP_HOST = process.env.SMTP_HOST ?? ''
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10)
const SMTP_USER = process.env.SMTP_USER ?? ''
const SMTP_PASS = process.env.SMTP_PASS ?? ''
const SMTP_FROM = process.env.SMTP_FROM ?? 'noreply@rainv6.com'
const APP_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Email shape
// ---------------------------------------------------------------------------

interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// Console transport (development)
// ---------------------------------------------------------------------------

async function sendConsole(message: EmailMessage): Promise<void> {
  console.log('────────────────────────────────────────')
  console.log(`📧 EMAIL → ${message.to}`)
  console.log(`   Subject: ${message.subject}`)
  console.log(`   Body: ${message.text}`)
  console.log('────────────────────────────────────────')
}

// ---------------------------------------------------------------------------
// SMTP transport (production)
// ---------------------------------------------------------------------------

async function sendSmtp(message: EmailMessage): Promise<void> {
  // Dynamic import — nodemailer is an optional peer dependency (only needed in
  // production). It is intentionally NOT listed in package.json dependencies so
  // that development/test environments don't need it installed.
  let createTransport: (opts: Record<string, unknown>) => { sendMail: (opts: Record<string, unknown>) => Promise<unknown> }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nm = require('nodemailer')
    createTransport = nm.createTransport
  } catch {
    console.error('[email] nodemailer is not installed. Run: npm install nodemailer')
    throw new Error('Email provider not configured — nodemailer missing')
  }

  const transporter = createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: SMTP_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a password reset email with a time-limited, single-use token link.
 *
 * @param email  — The recipient's email address
 * @param token  — The raw reset token (not the hash — the hash is in the DB)
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`

  const message: EmailMessage = {
    to: email,
    subject: 'RAIN V6 — Reset Your Password',
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Reset Your Password</h2>
        <p>We received a request to reset your RAIN V6 password. Click the link below to set a new password:</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
        <p style="color: #666; font-size: 14px;">Or copy this link: ${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #999; font-size: 12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `Reset Your Password\n\nWe received a request to reset your RAIN V6 password.\n\nClick here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
  }

  if (EMAIL_PROVIDER === 'console') {
    await sendConsole(message)
  } else {
    await sendSmtp(message)
  }
}
