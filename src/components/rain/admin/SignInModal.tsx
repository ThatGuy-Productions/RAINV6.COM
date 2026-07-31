'use client'

/**
 * RAIN V6 — Sign In Modal (returning free-tier users)
 *
 * Lightweight login modal for existing free-tier accounts. Calls the same
 * `/api/rain/auth/login` route as the AdminDoorModal, but without the
 * enterprise-bootstrap probe — this is purely for returning free-beta users
 * who already have an account and want to sign back in.
 *
 * After login the httpOnly session cookie is set by the server and the
 * AuthContext hydrates the user. Sessions/renders persist to the account.
 *
 * A "Create account" link at the bottom switches to the SignUpModal via the
 * `rain:signup-open` event, so the two auth modals are interconnected.
 */

import { useEffect, useState } from 'react'
import { Loader2, Mail, Eye, EyeOff, KeyRound, AlertCircle, LogIn, ArrowRight } from 'lucide-react'
import { useAuth } from './AuthContext'

interface SignInModalProps {
  onClose: () => void
}

export function SignInModal({ onClose }: SignInModalProps) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const result = await login(email, password)
    setSubmitting(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? 'Login failed')
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
        style={{ boxShadow: '0 24px 80px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(170,255,0,0.05)' }}
        role="dialog"
        aria-labelledby="signin-modal-title"
        aria-modal="true"
      >
        {/* Top accent gradient line */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#AAFF00] to-transparent opacity-60" />

        {/* Header band */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
              <LogIn className="w-5 h-5 text-[#AAFF00]" />
            </div>
            <div className="min-w-0">
              <h2 id="signin-modal-title" className="text-base font-semibold tracking-tight">Welcome back</h2>
              <p className="text-[11px] text-muted-foreground font-mono leading-tight mt-0.5">
                Sign in to your free beta account
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field icon={<Mail className="w-3.5 h-3.5" />} label="Email">
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

            <Field icon={<KeyRound className="w-3.5 h-3.5" />} label="Password">
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="rain-input pr-9"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-[#AAFF00] transition-colors"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </Field>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/25">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-md bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign in
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('rain:signup-open'))
                }}
                disabled={submitting}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[#AAFF00] transition-colors group"
              >
                No account? Create one
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
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
        </div>
      </div>

      {/* Local input styling — matches RAIN V6 dark studio theme */}
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
