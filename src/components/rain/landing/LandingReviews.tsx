'use client'

/**
 * RAIN V6 — Landing Page Live Reviews Section
 *
 * Displays REAL user reviews pulled from the database via /api/rain/reviews,
 * plus a submit form for visitors (signed-in users auto-publish; anonymous
 * submissions require admin approval).
 *
 * Replaces the static testimonials section's hardcoded quotes with live,
 * DB-backed reviews. When there are no reviews yet, shows an empty state
 * inviting the visitor to be the first.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { Star, Quote, Loader2, Send, CheckCircle2, AlertCircle, MessageSquare, Sparkles } from 'lucide-react'
import { useAuth } from '@/components/rain/admin/AuthContext'

interface Review {
  id: string
  name: string
  role: string | null
  rating: number
  title: string
  body: string
  createdAt: string
}

interface ReviewForm {
  name: string
  role: string
  rating: number
  title: string
  body: string
}

const EMPTY_FORM: ReviewForm = { name: '', role: '', rating: 5, title: '', body: '' }

export function LandingReviews() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(sectionRef, { once: true, margin: '-60px' })
  const { user } = useAuth()

  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Fetch approved reviews when scrolled into view.
  const fetchReviews = async () => {
    try {
      const res = await fetch('/api/rain/reviews?limit=20', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { reviews: Review[] }
      setReviews(data.reviews ?? [])
    } catch {
      setReviews([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isInView) return
    void fetchReviews()
  }, [isInView])

  // Compute aggregate rating from loaded reviews
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-4 border-t border-rain-border/50"
      id="reviews"
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(170,255,0,0.25)] bg-[rgba(170,255,0,0.06)] text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] mb-4">
            <MessageSquare className="w-3 h-3" />
            Live Reviews
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Real reviews, from real users.
          </h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-4">
            Every review below is stored in the RAIN V6 database and displayed
            live — no fabricated quotes.
          </p>
          {/* Aggregate rating */}
          {reviews.length > 0 && (
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-rain-border/60 bg-rain-surface-2/40">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`w-3.5 h-3.5 ${s <= Math.round(avgRating) ? 'fill-[#AAFF00] text-[#AAFF00]' : 'text-muted-foreground/40'}`}
                  />
                ))}
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                <span className="text-[#AAFF00] font-bold">{avgRating.toFixed(1)}</span>
                {' · '}
                <span className="text-foreground">{reviews.length}</span> review{reviews.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Reviews grid */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-5">
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <div key={j} className="w-3.5 h-3.5 rounded bg-white/[0.06] animate-pulse" />
                  ))}
                </div>
                <div className="h-4 w-3/4 rounded bg-white/[0.06] animate-pulse mb-2" />
                <div className="h-3 w-full rounded bg-white/[0.06] animate-pulse mb-1.5" />
                <div className="h-3 w-5/6 rounded bg-white/[0.06] animate-pulse mb-4" />
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse" />
                  <div className="flex-1">
                    <div className="h-3 w-20 rounded bg-white/[0.06] animate-pulse mb-1" />
                    <div className="h-2.5 w-16 rounded bg-white/[0.06] animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-dashed border-rain-border/60 bg-rain-surface-2/20">
            <Quote className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No reviews yet.</p>
            <p className="text-[13px] text-muted-foreground/80 mb-4">
              Be the first to share your RAIN V6 experience.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#AAFF00] text-black text-xs font-semibold hover:bg-[#c5ff4a] active:scale-95 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Write the first review
            </button>
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reviews.map((review, i) => (
                <ReviewCard key={review.id} review={review} index={i} />
              ))}
            </div>
            {/* Write a review CTA */}
            <div className="text-center mt-8">
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-[rgba(170,255,0,0.3)] bg-[rgba(170,255,0,0.06)] text-[#AAFF00] text-sm font-semibold hover:bg-[rgba(170,255,0,0.12)] hover:border-[rgba(170,255,0,0.5)] active:scale-95 transition-all"
              >
                <Send className="w-4 h-4" />
                Write a review
              </button>
              {!user && (
                <p className="mt-2 text-[11px] text-muted-foreground/70">
                  Sign in to publish instantly · anonymous reviews need approval
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Submit form modal */}
      {showForm && (
        <ReviewFormModal
          user={user}
          onClose={() => setShowForm(false)}
          onSubmitted={() => {
            setShowForm(false)
            void fetchReviews()
          }}
        />
      )}
    </section>
  )
}

// ── Review card ────────────────────────────────────────────────────────────

function ReviewCard({ review, index }: { review: Review; index: number }) {
  const initial = review.name[0]?.toUpperCase() ?? '?'
  // Stable color from name hash
  const colors = ['#AAFF00', '#06B6D4', '#F59E0B', '#8B5CF6', '#F97316', '#10B981', '#EC4899']
  const colorIdx = review.name.split('').reduce((h, c) => h + c.charCodeAt(0), 0) % colors.length
  const color = colors[colorIdx]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="rounded-xl border border-rain-border/60 bg-rain-surface-2/40 p-5 flex flex-col hover:border-rain-border transition-colors"
    >
      {/* Stars */}
      <div className="flex items-center gap-0.5 mb-3">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`w-3.5 h-3.5 ${s <= review.rating ? 'fill-[#AAFF00] text-[#AAFF00]' : 'text-muted-foreground/30'}`}
          />
        ))}
      </div>
      {/* Title */}
      <h3 className="text-sm font-semibold mb-2 leading-tight">{review.title}</h3>
      {/* Body */}
      <p className="text-[12px] text-muted-foreground leading-relaxed flex-1 mb-4 line-clamp-4">
        {review.body}
      </p>
      {/* Author */}
      <div className="flex items-center gap-2.5 pt-3 border-t border-white/[0.04]">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">{review.name}</div>
          {review.role && (
            <div className="text-[10px] font-mono text-muted-foreground/60 truncate">{review.role}</div>
          )}
        </div>
        <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0">
          {new Date(review.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </motion.div>
  )
}

// ── Submit form modal ──────────────────────────────────────────────────────

function ReviewFormModal({
  user,
  onClose,
  onSubmitted,
}: {
  user: { name: string | null; email: string } | null
  onClose: () => void
  onSubmitted: () => void
}) {
  const [form, setForm] = useState<ReviewForm>({
    ...EMPTY_FORM,
    name: user?.name ?? '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Esc to close
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
    if (!form.name.trim()) return setError('Name is required')
    if (!form.title.trim()) return setError('Title is required')
    if (!form.body.trim()) return setError('Review body is required')
    if (form.body.length > 1000) return setError('Review is too long (max 1000 chars)')

    setSubmitting(true)
    try {
      const res = await fetch('/api/rain/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; approved?: boolean; message?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Submission failed')
        return
      }
      setSuccess(data.message ?? 'Review submitted')
      setTimeout(() => onSubmitted(), 1500)
    } catch {
      setError('Network error')
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
        className="relative w-full max-w-lg rounded-xl border border-[rgba(170,255,0,0.18)] bg-[rgba(14,16,22,0.98)] shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 24px 80px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(170,255,0,0.05)' }}
        role="dialog"
        aria-labelledby="review-form-title"
        aria-modal="true"
      >
        {/* Top accent */}
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#AAFF00] to-transparent opacity-60" />

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.3)] flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-[#AAFF00]" />
            </div>
            <div>
              <h2 id="review-form-title" className="text-base font-semibold tracking-tight">Write a review</h2>
              <p className="text-[11px] text-muted-foreground font-mono leading-tight mt-0.5">
                {user ? 'Signed in · publishes instantly' : 'Anonymous · needs approval'}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          {success ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-14 h-14 rounded-full bg-[rgba(170,255,0,0.12)] border border-[rgba(170,255,0,0.4)] flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#AAFF00]" />
              </div>
              <p className="text-sm text-center text-muted-foreground">{success}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Rating */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  <Star className="w-3.5 h-3.5 text-[#AAFF00]/70" />
                  Rating
                </label>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, rating: s }))}
                      className="p-1 hover:scale-110 transition-transform"
                      aria-label={`${s} star${s !== 1 ? 's' : ''}`}
                    >
                      <Star
                        className={`w-6 h-6 transition-colors ${s <= form.rating ? 'fill-[#AAFF00] text-[#AAFF00]' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-xs font-mono text-muted-foreground">{form.rating}/5</span>
                </div>
              </div>

              {/* Name + Role */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Your name"
                    className="rain-input"
                    maxLength={80}
                  />
                </Field>
                <Field label="Role (optional)">
                  <input
                    type="text"
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="Mastering Engineer"
                    className="rain-input"
                    maxLength={120}
                  />
                </Field>
              </div>

              {/* Title */}
              <Field label="Title">
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Finally, honest LUFS in a browser"
                  className="rain-input"
                  maxLength={120}
                />
              </Field>

              {/* Body */}
              <Field label="Review">
                <textarea
                  required
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Share your experience with RAIN V6..."
                  className="rain-input min-h-[100px] resize-y py-2"
                  maxLength={1000}
                  rows={4}
                />
                <div className="text-right text-[9px] font-mono text-muted-foreground/50 mt-0.5">
                  {form.body.length}/1000
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
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit review
                  </>
                )}
              </button>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px] text-muted-foreground font-mono">
                  {user ? 'auto-publish' : 'needs approval'}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
