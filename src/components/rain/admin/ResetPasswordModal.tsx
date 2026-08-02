'use client'

/**
 * RAIN V6 — Reset Password Modal
 *
 * Displayed after the user navigates to the reset token page (or in
 * BETA mode, after clicking "Open reset password form" in the
 * ForgotPasswordModal). Allows the user to set a new password.
 *
 * Fields:
 *  - New password (with strength meter)
 *  - Confirm password
 *
 * On success, invalidates all existing auth tokens server-side (force
 * re-login everywhere), shows a success state, and the user can navigate
 * back to the sign-in form to log in with the new password.
 */

import { useEffect, useState } from 'react'
import {
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react'

interface ResetPasswordModalProps {
  onClose: () => void
  /** The raw reset token (from the URL or from the forgot-password flow). */
  token: string
  /** Called when the user wants to return to sign-in. */
  onBackToSignIn: () => void
}

export function ResetPasswordModal({
  onClose,
  token,
  onBackToSignIn,
}: ResetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

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

    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/rain/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (data.ok) {
        setDone(true)
      } else {
        setError(data.error ?? 'Password reset failed')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
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
                {done ? 'Password reset complete' : 'Set a new password'}
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono leading-tight mt-0.5">
                {done
                  ? 'Your password has been updated. Please sign in.'
                  : 'Choose a strong password for your account.'}
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
                Your password has been updated. All other devices have been
                signed out for security.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onBackToSignIn()
                }}
                className="w-full h-10 rounded-md bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                Sign in with new password
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field icon={<KeyRound className="w-3.5 h-3.5" />} label="New password">
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="rain-input pr-9"
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-[#AAFF00] transition-colors"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPw ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </Field>

              <Field icon={<KeyRound className="w-3.5 h-3.5" />} label="Confirm new password">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className="rain-input"
                  autoComplete="new-password"
                />
              </Field>

              {/* Password strength meter */}
              <PasswordStrength password={password} />

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/25">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !password || !confirm}
                className="w-full h-10 rounded-md bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting…
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    Reset password
                  </>
                )}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    window.dispatchEvent(new CustomEvent('rain:signin-open'))
                  }}
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

/** Live password strength meter — 4 bars + label. Visual feedback only. */
function PasswordStrength({ password }: { password: string }) {
  const score = (() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8) s++
    if (password.length >= 12) s++
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++
    if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) s++
    return Math.min(s, 4)
  })()
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['#64748B', '#EF4444', '#F59E0B', '#84CC16', '#AAFF00']
  const color = colors[score]
  const label = password ? labels[score] : ''

  return (
    <div className="flex items-center gap-2 h-3">
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: i <= score ? color : 'rgba(255,255,255,0.06)',
            }}
          />
        ))}
      </div>
      {label && (
        <span
          className="text-[9px] font-mono uppercase tracking-wider transition-colors"
          style={{ color }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
