'use client'

/**
 * RAIN V6 — Feedback Widget
 *
 * Simple feedback collection: free-text comment + optional email + usage
 * permission checkbox. Submits to /api/rain/feedback which stores in
 * the Prisma Feedback table.
 *
 * Designed for investor valuation — shows real engagement metrics.
 * Zero PII required. Email is optional and only used if the user opts in
 * to follow-up.
 */

import { useEffect, useState } from 'react'
import { X, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { notifySuccess, notifyError } from '@/lib/rain/notifications'

export function FeedbackModal() {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState('')
  const [allowFollowUp, setAllowFollowUp] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!comment.trim()) return
    setSending(true)
    setError(null)
    try {
      const resp = await fetch('/api/rain/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: comment.trim(),
          email: email.trim() || undefined,
          allowFollowUp,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${resp.status}`)
      }
      setSent(true)
      notifySuccess('Feedback sent', 'Thank you — your input shapes the RAIN V6 roadmap.')
      setTimeout(() => {
        setOpen(false)
        setComment('')
        setEmail('')
        setAllowFollowUp(false)
        setSent(false)
      }, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
      notifyError('Feedback failed', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  // Listen for global open events from other components
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__rainOpenFeedback = () => {
      setOpen(true)
      setSent(false)
      setError(null)
    }
    return () => {
      delete (window as unknown as Record<string, unknown>).__rainOpenFeedback
    }
  }, [])

  if (!open) return null

  return (
    <div
      id="rain-feedback-modal"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="bg-rain-surface border border-rain-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl"
        role="dialog"
        aria-label="Send feedback"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
              Free Beta Feedback
            </div>
            <div className="text-sm font-semibold">Help Us Build RAIN V6</div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-rain-surface-2 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <CheckCircle2 className="w-10 h-10 text-rain-accent" />
            <div className="text-sm font-semibold">Feedback sent!</div>
            <div className="text-xs text-muted-foreground">Thank you for helping improve RAIN.</div>
          </div>
        ) : (
          <>
            <textarea
              id="feedback-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What do you need? What's broken? What would make RAIN indispensable for your workflow?"
              className="w-full bg-rain-surface-2 border border-rain-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-rain-accent/50 focus:outline-none resize-none min-h-[100px]"
              maxLength={2000}
              aria-label="Your feedback"
            />

            <div className="mt-3 space-y-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional — only if you want a reply)"
                className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-rain-accent/50 focus:outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowFollowUp}
                  onChange={(e) => setAllowFollowUp(e.target.checked)}
                  className="rounded border-rain-border bg-rain-surface-2 accent-rain-accent"
                />
                I&apos;m okay with a one-time follow-up about my feedback
              </label>
            </div>

            {error && (
              <div className="mt-2 text-xs text-red-400">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={sending || !comment.trim()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-md bg-rain-accent text-black text-sm font-semibold hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100"
            >
              {sending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="w-4 h-4" /> Send Feedback</>
              )}
            </button>
          </>
        )}

        <div className="mt-4 text-[9px] text-muted-foreground/50 text-center leading-tight">
          Your feedback helps us prioritize features and fix bugs. No audio data is ever sent.
          Your privacy is respected — email is optional and only used if you opt in.
        </div>
      </div>
    </div>
  )
}
