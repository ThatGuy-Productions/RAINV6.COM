import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'
import { sanitizeHtml, sanitizeOptional } from '@/lib/rain/sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/rain/reviews
 *
 * PUBLIC — returns approved reviews, newest first. No auth required.
 * Query params:
 *   - limit: 1..50 (default 20)
 *
 * Used by the landing page's live reviews section.
 */
/**
 * POST /api/rain/reviews
 *
 * Submit a review. Auth is optional:
 *   - Signed-in users: auto-approved (we trust authenticated accounts).
 *     The review is attributed to their userId + uses their account name if
 *     no name is provided.
 *   - Anonymous users: requires manual approval (approved=false). The review
 *     won't appear until an admin approves it. This prevents spam.
 *
 * Body: { name: string, role?: string, rating: 1-5, title: string, body: string }
 */

const MAX_BODY = 1000
const MAX_TITLE = 120
const MAX_NAME = 80
const MAX_ROLE = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50)
  try {
    const reviews = await db.review.findMany({
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        role: true,
        rating: true,
        title: true,
        body: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ reviews, count: reviews.length })
  } catch (err) {
    console.error('[api/rain/reviews] GET failed:', err)
    return NextResponse.json({ reviews: [], count: 0 }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate fields
  // ── Sanitize user input to prevent stored XSS ────────────────────────
  const name =
    typeof body.name === 'string'
      ? sanitizeHtml(body.name).slice(0, MAX_NAME) || null
      : null
  const fallbackName = user?.name?.slice(0, MAX_NAME) ?? null
  const resolvedName = name || fallbackName
  if (!resolvedName) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const role = sanitizeOptional(body.role)?.slice(0, MAX_ROLE) ?? null

  const ratingNum = typeof body.rating === 'number' ? body.rating : parseInt(String(body.rating), 10)
  if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  const title =
    typeof body.title === 'string'
      ? sanitizeHtml(body.title).slice(0, MAX_TITLE) || null
      : null
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const reviewBody =
    typeof body.body === 'string'
      ? sanitizeHtml(body.body).slice(0, MAX_BODY) || null
      : null
  if (!reviewBody) {
    return NextResponse.json({ error: 'Review body is required' }, { status: 400 })
  }

  // Signed-in users auto-approve; anonymous submissions require manual approval.
  const approved = !!user

  try {
    const review = await db.review.create({
      data: {
        userId: user?.id ?? null,
        name: resolvedName,
        role,
        rating: ratingNum,
        title,
        body: reviewBody,
        approved,
      },
    })

    // Fire an event so the funnel captures review submissions.
    void trackEvent({
      userId: user?.id ?? null,
      type: 'feedback_submitted',
      metadata: { reviewId: review.id, rating: ratingNum, approved },
    })

    return NextResponse.json(
      {
        ok: true,
        id: review.id,
        approved,
        message: approved
          ? 'Review published'
          : 'Review submitted — it will appear after admin approval.',
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/rain/reviews] POST failed:', err)
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
