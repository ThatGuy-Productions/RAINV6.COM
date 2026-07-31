'use client'

/**
 * RAIN V6 — Exit Review Popup
 *
 * Triggers a review prompt when the user attempts to leave the studio
 * (beforeunload / page hide). Only shows if the user has actually interacted
 * with the studio (loaded a track, ran a master, or viewed tabs) — not on
 * immediate bounces.
 *
 * The popup is a lightweight modal that calls the /api/rain/reviews POST
 * endpoint. If the user dismisses it, the exit proceeds. If they submit a
 * review, the exit proceeds after the POST resolves.
 *
 * A sessionStorage flag prevents re-showing within the same session if the
 * user already dismissed or submitted.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Send, X, MessageSquare, Loader2, CheckCircle2 } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'

const DISMISS_KEY = 'rain_exit_review_dismissed'
const INTERACTION_THRESHOLD = 3 // minimum tab views / actions to trigger

export function ExitReviewPopup() {
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const dismissedRef = useRef(false)
  const dismissTimerRef = useRef<number | null>(null)

  // Clear the dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current)
      }
    }
  }, [])

  // Check if the user has interacted enough to warrant the popup.
  const fileName = useSessionStore((s) => s.fileName)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const rainScore = useSessionStore((s) => s.rainScore)

  useEffect(() => {
    // Don't show if already dismissed this session.
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) {
        dismissedRef.current = true
        return
      }
    } catch { /* noop */ }

    const handler = (e: BeforeUnloadEvent) => {
      // Only trigger if the user has meaningfully interacted.
      const interacted = !!fileName || !!hasProcessed || !!rainScore
      if (!interacted || dismissedRef.current) return

      // Show the popup and prevent unload.
      e.preventDefault()
      e.returnValue = ''
      setShow(true)
      // Return the string for older browsers.
      return ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [fileName, hasProcessed, rainScore])

  const dismiss = () => {
    dismissedRef.current = true
    setShow(false)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* noop */ }
  }

  const submit = async () => {
    if (!body.trim() || !name.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/rain/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().slice(0, 80),
          role: 'RAIN V6 Beta User',
          rating,
          title: body.trim().slice(0, 60) || 'Quick review',
          body: body.trim().slice(0, 1000),
        }),
      })
    } catch { /* best-effort */ }
    setSubmitting(false)
    setDone(true)
    dismissTimerRef.current = window.setTimeout(() => dismiss(), 1500)
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="relative w-full max-w-md rounded-xl border border-[rgba(170,255,0,0.2)] bg-[rgba(14,16,22,0.98)] shadow-2xl overflow-hidden"
          >
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#AAFF00] to-transparent opacity-60" />

            {/* Header */}
            <div className="px-6 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-[#AAFF00]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Quick review before you go?</h2>
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    30 seconds helps us improve the beta
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              {done ? (
                <div className="flex flex-col items-center py-6 gap-3">
                  <CheckCircle2 className="w-10 h-10 text-[#AAFF00]" />
                  <p className="text-sm text-muted-foreground">Thanks for your review!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Rating */}
                  <div className="flex items-center gap-1.5 justify-center">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        onClick={() => setRating(s)}
                        className="p-0.5 hover:scale-110 transition-transform"
                      >
                        <Star
                          className={`w-6 h-6 ${s <= rating ? 'fill-[#AAFF00] text-[#AAFF00]' : 'text-muted-foreground/40'}`}
                        />
                      </button>
                    ))}
                  </div>

                  {/* Name */}
                  <label htmlFor="exit-review-name" className="sr-only">Your name</label>
                  <input
                    id="exit-review-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full h-9 px-3 rounded-md bg-white/[0.03] border border-white/[0.08] text-[13px] outline-none focus:border-[rgba(170,255,0,0.5)] focus:shadow-[0_0_0_3px_rgba(170,255,0,0.12)] transition-all"
                    maxLength={80}
                  />

                  {/* Review */}
                  <label htmlFor="exit-review-body" className="sr-only">Your review</label>
                  <textarea
                    id="exit-review-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="How was your RAIN V6 experience?"
                    className="w-full min-h-[70px] px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-[13px] outline-none focus:border-[rgba(170,255,0,0.5)] focus:shadow-[0_0_0_3px_rgba(170,255,0,0.12)] transition-all resize-y"
                    maxLength={500}
                    autoFocus
                  />

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={dismiss}
                      className="flex-1 h-9 rounded-md border border-white/[0.08] text-[12px] text-muted-foreground hover:bg-white/[0.04] transition-colors"
                    >
                      No thanks
                    </button>
                    <button
                      onClick={submit}
                      disabled={submitting || !body.trim() || !name.trim()}
                      className="flex-1 h-9 rounded-md bg-[#AAFF00] text-black text-[12px] font-semibold hover:bg-[#c5ff4a] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      {submitting ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting…</>
                      ) : (
                        <><Send className="w-3.5 h-3.5" /> Submit</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
