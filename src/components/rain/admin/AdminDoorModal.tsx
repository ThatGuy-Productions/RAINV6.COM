'use client'

/**
 * RAIN V6 — Admin Door Modal (login / first-run setup)
 *
 * The literal "admin door". On open it probes `/api/rain/admin/status`:
 *   - If no Enterprise account exists yet → render the one-time "Set up
 *     Enterprise Admin" form (the first person through the door sets the
 *     credentials). On submit it calls the bootstrap endpoint, which
 *     creates the account AND auto-logs-in.
 *   - If an Enterprise admin already exists → render the "Login" form.
 *
 * Both paths end with an authenticated enterprise session (httpOnly cookie
 * set by the server), after which `onSuccess` fires to open the console.
 *
 * Styling matches RAIN V6's dark studio aesthetic with the lime accent.
 * The modal is deliberately understated — it's a door, not a billboard.
 */

import { useEffect, useState } from 'react'
import { Loader2, Lock, Mail, ShieldCheck, User, Eye, EyeOff, KeyRound, AlertCircle } from 'lucide-react'
import { useAuth } from './AuthContext'

interface AdminDoorModalProps {
  onClose: () => void
  onSuccess: () => void
}

type Mode = 'loading' | 'setup' | 'login'

export function AdminDoorModal({ onClose, onSuccess }: AdminDoorModalProps) {
  const { login, bootstrap } = useAuth()
  const [mode, setMode] = useState<Mode>('loading')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Probe bootstrap status on open to pick the right form.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/rain/admin/status', { cache: 'no-store' })
        const data = (await res.json()) as { bootstrapped?: boolean }
        if (!cancelled) setMode(data.bootstrapped ? 'login' : 'setup')
      } catch {
        if (!cancelled) setMode('login') // default to login on probe failure
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
    if (mode === 'setup' && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (mode === 'setup' && password.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }
    setSubmitting(true)
    const result =
      mode === 'setup'
        ? await bootstrap(email, password, name || undefined)
        : await login(email, password)
    setSubmitting(false)
    if (result.ok) {
      onSuccess()
    } else {
      setError(result.error ?? 'Something went wrong')
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
        className="relative w-full max-w-md rounded-xl border border-[rgba(170,255,0,0.18)] bg-[rgba(14,16,22,0.98)] shadow-2xl"
        style={{ boxShadow: '0 24px 80px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(170,255,0,0.05)' }}
      >
        {/* Header band */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-[#AAFF00]" />
              </div>
              <Lock className="absolute -bottom-1 -right-1 w-4 h-4 text-[#AAFF00] bg-[rgba(14,16,22,1)] rounded-full p-0.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                {mode === 'setup' ? 'Enterprise Admin Setup' : 'Enterprise Admin Door'}
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono leading-tight mt-0.5">
                {mode === 'setup'
                  ? 'First-run · create the enterprise admin account'
                  : 'Credential login · unlocks all tiers'}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {mode === 'loading' ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'setup' && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[rgba(170,255,0,0.06)] border border-[rgba(170,255,0,0.15)]">
                  <AlertCircle className="w-3.5 h-3.5 text-[#AAFF00] mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    No enterprise admin exists yet. This one-time form creates the first
                    admin account and signs you in immediately. Future access uses the login form.
                  </p>
                </div>
              )}

              {mode === 'setup' && (
                <Field
                  icon={<User className="w-3.5 h-3.5" />}
                  label="Display name (optional)"
                >
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="RAIN Enterprise Admin"
                    className="rain-input"
                    autoComplete="name"
                  />
                </Field>
              )}

              <Field icon={<Mail className="w-3.5 h-3.5" />} label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@rain.studio"
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
                    placeholder={mode === 'setup' ? 'At least 10 characters' : '••••••••••'}
                    className="rain-input pr-9"
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
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

              {mode === 'setup' && (
                <Field icon={<KeyRound className="w-3.5 h-3.5" />} label="Confirm password">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    className="rain-input"
                    autoComplete="new-password"
                  />
                </Field>
              )}

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
                    {mode === 'setup' ? 'Creating admin…' : 'Signing in…'}
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {mode === 'setup' ? 'Create & enter' : 'Enter console'}
                  </>
                )}
              </button>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px] text-muted-foreground font-mono">
                  scrypt · httpOnly · 7-day session
                </p>
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
