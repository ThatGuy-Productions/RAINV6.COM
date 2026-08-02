'use client'

/**
 * RAIN V6 — Forgot Password Modal
 *
 * Initiated from the Sign In modal. User enters their email and clicks
 * "Send Reset Link". The server NEVER reveals whether the email exists
 * to prevent user enumeration — the success message is identical.
 *
 * In BETA mode (no email service), the raw reset token is returned in
 * the API response and displayed in the modal so the developer can
 * copy it and test the reset-password flow.
 */

import { useEffect, useState } from 'react'
import { Loader2, Mail, ArrowLeft, KeyRound, CheckCircle2, Copy, Check, Terminal } from 'lucide-react'

interface ForgotPasswordModalProps {
  onClose: () => void
  /** Called when the user wants to go back to the sign-in modal. */
  onBackToSignIn: () => void
  /** Called with the raw token so the ResetPasswordModal can be pre-filled. */
  onTokenReceived: (token: string) => void
}

export function ForgotPasswordModal({
  onClose,
  onBackToSignIn,
  onTokenReceived,
}: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [betaToken, setBetaToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/rain/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = (await res.json()) as {
        ok: boolean
        message: string
        token?: string
      }
      if (data.ok) {
        setDone(true)
        if (data.token) {
          setBetaToken(data.token)
        }
      } else {
        setDone(true)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyToken() {
    if (!betaToken) return
    try {
      await navigator.clipboard.writeText(betaToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      setCopied(false)
    }
  }

  function handleGoToReset() {
    if (!betaToken) return
    onTokenReceived(betaToken)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-[rgba(170,255,0,0.18)] bg-[rgba(14,16,22,0.98)] shadow-2xl overflow-hidden"
        style={{
          boxShadow:
            '0 24px 80px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(170,255,0,0.05)',
        }}
      >
        {/* Top accent gradient line */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#AAFF00] to-transparent opacity-60" />

        {/* Header band */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
              {done ? (
                <CheckCircle2 className="w-5 h-5 text-[#AAFF00]" />
              ) : (
                <KeyRound className="w-5 h-5 text-[#AAFF00]" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                {done ? 'Check your email' : 'Reset your password'}
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono leading-tight mt-0.5">
                {done
                  ? 'If an account exists, a reset link has been sent.'
                  : "Enter your email and we'll send a reset link."}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {done ? (
            <div className="flex flex-col items-center justify-center py-6 gap-4">
              <div className="w-14 h-14 rounded-full bg-[rgba(170,255,0,0.12)] border border-[rgba(170,255,0,0.4)] flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#AAFF00]" />
              </div>
              <p className="text-sm text-center text-muted-foreground">
                If an account with that email exists, you&apos;ll receive a
                password reset link shortly.
              </p>

              {/* BETA: show raw token for development */}
              {betaToken && (
                <div className="w-full">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Terminal className="w-3 h-3 text-[#F97316]" />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#F97316]">
                      BETA — Token visible (no email service)
                    </span>
                  </div>
                  <div className="relative">
                    <div
                      className="w-full px-3 py-2 rounded-md bg-[rgba(249,115,22,0.08)] border border-[rgba(249,115,22,0.25)] font-mono text-[11px] text-[#F97316] break-all select-all"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {betaToken}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[rgba(249,115,22,0.15)] transition-colors"
                      title={copied ? 'Copied!' : 'Copy token'}
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-[#AAFF00]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[#F97316]" />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoToReset}
                    className="mt-2 w-full h-9 rounded-md bg-[#F97316] text-white font-semibold text-xs hover:bg-[#FB923C] active:scale-[0.99] transition-all flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Open reset password form
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field icon={<Mail className="w-3.5 h-3.5" />} label="Email address">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="rain-input"
                  autoComplete="email"
                  autoFocus
                />
              </Field>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/25">
                  <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full h-10 rounded-md bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send reset link
                  </>
                )}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={onBackToSignIn}
                  disabled={submitting}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[#AAFF00] transition-colors group"
                >
                  <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                  Back to sign in
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Local input styling */}
      <style jsx>{`
        :global(.rain-input) {
          width: 100%;
          height: 2.5rem;
          padding: 0 0.75rem;
          border-radius: 0.375rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #fff;
          font-size: 0.8125rem;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        :global(.rain-input::placeholder) {
          color: rgba(255, 255, 255, 0.25);
        }
        :global(.rain-input:focus) {
          border-color: rgba(170, 255, 0, 0.5);
          box-shadow: 0 0 0 3px rgba(170, 255, 0, 0.12);
        }
      `}</style>
    </div>
  )
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <span className="text-[#AAFF00]/70">{icon}</span>
        {label}
      </span>
      {children}
    </label>
  )
}
